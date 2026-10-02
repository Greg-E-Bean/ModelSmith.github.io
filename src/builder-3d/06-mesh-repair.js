      // ── Mesh repair (weld seams + patch small holes) ─────────────────────────
      // Booleans (and the thread tool) can leave a hairline gap wherever two
      // operands met — a boundary loop of triangles that don't quite share
      // vertices, which slicers report as "open edges" / non-manifold. This is
      // a best-effort, in-house fix for exactly that: weld near-coincident
      // vertices back together, drop the degenerate slivers that welding
      // exposes, then ear-clip any remaining small boundary loops closed.
      // Unlike Bambu's own repair (an external Windows service that only
      // understands plain geometry), this runs inside our own pipeline, so
      // vertex colour rides along untouched.
      function countOpenEdges(geometry) {
        const src = geometry.index ? geometry.toNonIndexed() : geometry;
        const pos = src.attributes.position;
        const key = i => { const p = pos; return `${p.getX(i).toFixed(4)}_${p.getY(i).toFixed(4)}_${p.getZ(i).toFixed(4)}`; };
        const map = new Map(); const idx = [];
        for (let i = 0; i < pos.count; i++) { const k = key(i); let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } idx.push(id); }
        const edgeCount = new Map();
        for (let i = 0; i < idx.length; i += 3) {
          const a = idx[i], b = idx[i+1], c = idx[i+2];
          [[a,b],[b,c],[c,a]].forEach(([u,v]) => { const k = u+'_'+v; edgeCount.set(k, (edgeCount.get(k)||0)+1); });
        }
        let open = 0;
        for (const k of edgeCount.keys()) {
          const s = k.split('_'); const rev = s[1]+'_'+s[0];
          if (!edgeCount.has(rev)) open++;
        }
        return open;
      }

      // Ear-clip a boundary loop (vertex indices, in the winding order the
      // surrounding surface leaves them in) into triangles. Works in the
      // loop's own best-fit plane so slightly non-flat loops still triangulate.
      function earClipLoop(loopIdx, verts) {
        const pts3d = loopIdx.map(i => verts[i].p);
        const normal = new THREE.Vector3();
        for (let i = 0; i < pts3d.length; i++) {
          const p = pts3d[i], q = pts3d[(i+1) % pts3d.length];
          normal.x += (p.y - q.y) * (p.z + q.z);
          normal.y += (p.z - q.z) * (p.x + q.x);
          normal.z += (p.x - q.x) * (p.y + q.y);
        }
        if (normal.lengthSq() < 1e-12) return [];
        normal.normalize();
        const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
        const u = new THREE.Vector3().crossVectors(ref, normal).normalize();
        const v = new THREE.Vector3().crossVectors(normal, u);
        const centre = pts3d.reduce((s,p) => s.add(p), new THREE.Vector3()).multiplyScalar(1/pts3d.length);
        const pts2d = pts3d.map(p => { const d = p.clone().sub(centre); return { x: d.dot(u), y: d.dot(v) }; });

        const order = loopIdx.map((_, i) => i);
        const cross2 = (o,a,b) => (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
        const pointInTri = (p,a,b,c) => {
          const d1=cross2(p,a,b), d2=cross2(p,b,c), d3=cross2(p,c,a);
          const hasNeg=(d1<0)||(d2<0)||(d3<0), hasPos=(d1>0)||(d2>0)||(d3>0);
          return !(hasNeg && hasPos);
        };
        const tris = [];
        let guard = 0;
        while (order.length > 3 && guard++ < 2000) {
          let clipped = false;
          for (let i = 0; i < order.length; i++) {
            const i0 = order[(i-1+order.length)%order.length], i1 = order[i], i2 = order[(i+1)%order.length];
            const a = pts2d[i0], b = pts2d[i1], c = pts2d[i2];
            if (cross2(a,b,c) <= 0) continue; // reflex corner — not a valid ear
            let containsOther = false;
            for (const j of order) {
              if (j===i0||j===i1||j===i2) continue;
              if (pointInTri(pts2d[j], a, b, c)) { containsOther = true; break; }
            }
            if (containsOther) continue;
            tris.push([loopIdx[i0], loopIdx[i1], loopIdx[i2]]);
            order.splice(i, 1);
            clipped = true;
            break;
          }
          if (!clipped) break; // self-intersecting/degenerate loop — leave the hole
        }
        if (order.length === 3) tris.push([loopIdx[order[0]], loopIdx[order[1]], loopIdx[order[2]]]);

        // Match the surrounding surface's winding: flip any patch triangle
        // whose face normal opposes the vertex normals it borrows from.
        return tris.map(([a,b,c]) => {
          const pa=verts[a].p, pb=verts[b].p, pc=verts[c].p;
          const faceN = pb.clone().sub(pa).cross(pc.clone().sub(pa));
          const avgN = verts[a].n.clone().add(verts[b].n).add(verts[c].n);
          return faceN.dot(avgN) < 0 ? [a,c,b] : [a,b,c];
        });
      }

      function repairMeshGeometry(geometry, weldEps = 0.01) {
        const src = geometry.index ? geometry.toNonIndexed() : geometry;
        const pos = src.attributes.position;
        const nrm = src.attributes.normal;
        const col = src.attributes.color;

        // 1) Weld coincident vertices (within weldEps) back into shared vertices.
        const verts = [];
        const keyOf = p => `${Math.round(p.x/weldEps)}_${Math.round(p.y/weldEps)}_${Math.round(p.z/weldEps)}`;
        const map = new Map();
        const triIdx = [];
        for (let i = 0; i < pos.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(pos, i);
          const k = keyOf(p);
          let id = map.get(k);
          if (id === undefined) {
            id = verts.length;
            verts.push({
              p: p.clone(),
              n: nrm ? new THREE.Vector3().fromBufferAttribute(nrm, i) : new THREE.Vector3(0,0,1),
              c: col ? new THREE.Vector3(col.getX(i), col.getY(i), col.getZ(i)) : null
            });
            map.set(k, id);
          }
          triIdx.push(id);
        }

        // 2) Drop degenerate (near-zero-area) triangles that welding exposes.
        const tris = [];
        for (let i = 0; i < triIdx.length; i += 3) {
          const a = triIdx[i], b = triIdx[i+1], c = triIdx[i+2];
          if (a===b || b===c || a===c) continue;
          const area = verts[b].p.clone().sub(verts[a].p).cross(verts[c].p.clone().sub(verts[a].p)).length();
          if (area < 1e-9) continue;
          tris.push([a,b,c]);
        }

        // 3) Find boundary (open) directed edges — an edge a→b with no
        //    matching reverse b→a anywhere else in the mesh.
        const edgeCount = new Map();
        const noteEdge = (a,b) => { const k=a+'_'+b; edgeCount.set(k,(edgeCount.get(k)||0)+1); };
        tris.forEach(([a,b,c]) => { noteEdge(a,b); noteEdge(b,c); noteEdge(c,a); });
        const hasReverse = (a,b) => edgeCount.has(b+'_'+a);
        const boundaryNext = new Map();
        let openEdgeCount = 0;
        tris.forEach(([a,b,c]) => {
          [[a,b],[b,c],[c,a]].forEach(([u,v]) => {
            if (!hasReverse(u,v)) { boundaryNext.set(u, v); openEdgeCount++; }
          });
        });

        // 4) Walk each boundary loop and ear-clip small, clean ones closed.
        const visited = new Set();
        const patchTris = [];
        for (const start of boundaryNext.keys()) {
          if (visited.has(start)) continue;
          const loop = [start]; visited.add(start);
          let cur = boundaryNext.get(start), guard = 0;
          while (cur !== undefined && cur !== start && guard++ < 2000) { loop.push(cur); visited.add(cur); cur = boundaryNext.get(cur); }
          if (cur !== start || loop.length < 3 || loop.length > 200) continue; // not a clean small loop — leave it
          patchTris.push(...earClipLoop(loop, verts));
        }

        // 5) Rebuild the geometry from original + patch triangles.
        const allTris = tris.concat(patchTris);
        const outPos = [], outNrm = [], outCol = [];
        allTris.forEach(([a,b,c]) => {
          [a,b,c].forEach(idx => {
            const vv = verts[idx];
            outPos.push(vv.p.x, vv.p.y, vv.p.z);
            outNrm.push(vv.n.x, vv.n.y, vv.n.z);
            outCol.push(vv.c ? vv.c.x : 1, vv.c ? vv.c.y : 1, vv.c ? vv.c.z : 1);
          });
        });

        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
        if (col) out.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
        out.computeVertexNormals();

        return { geometry: out, before: openEdgeCount, after: countOpenEdges(out), patched: patchTris.length > 0 };
      }

      function repairModelMeshes() {
        const meshes = gatherExportMeshes();
        if (!meshes.length) return banner("⚠️ Nothing to repair.");
        let totalBefore = 0, totalAfter = 0, touched = 0;
        meshes.forEach(mesh => {
          const before = countOpenEdges(mesh.geometry);
          if (before === 0) return;
          const { geometry, after } = repairMeshGeometry(mesh.geometry);
          mesh.geometry.dispose();
          mesh.geometry = geometry;
          totalBefore += before; totalAfter += after; touched++;
        });
        if (!touched) { banner("✓ No open edges found — already watertight."); return; }
        saveHistory(); updateStatus();
        if (totalAfter === 0) banner(`✓ Repaired ${touched} object${touched>1?'s':''} — ${totalBefore} open edges closed.`);
        else banner(`Repaired ${touched} object${touched>1?'s':''} — ${totalBefore-totalAfter} of ${totalBefore} open edges closed, ${totalAfter} remain (likely a self-intersecting area — try nudging the source solids so they overlap more before cutting).`);
      }

      // Push a quad (p0,p1,p2,p3 in order around the perimeter) as two triangles,
      // automatically flipping the winding so the face renders/prints outward-facing
      // regardless of what order the caller passed the corners in.
      function pushQuadOutward(out, p0, p1, p2, p3, desiredNormal) {
        const n = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0));
        if (n.dot(desiredNormal) < 0) {
          out.push([p0.clone(), p3.clone(), p2.clone()]);
          out.push([p0.clone(), p2.clone(), p1.clone()]);
        } else {
          out.push([p0.clone(), p1.clone(), p2.clone()]);
          out.push([p0.clone(), p2.clone(), p3.clone()]);
        }
      }

      // Builds a wedge (ramp) primitive: a rectangular base that tapers from full
      // height along the back edge down to a thin edge along the front, centred on
      // the origin like the other primitives.
      function makeWedgeGeometry(width, depth, height) {
        const w = width/2, d = depth/2, h = height/2;
        const P0 = new THREE.Vector3(-w, -h, -d), P1 = new THREE.Vector3( w, -h, -d);
        const P2 = new THREE.Vector3( w, -h,  d), P3 = new THREE.Vector3(-w, -h,  d);
        const P4 = new THREE.Vector3(-w,  h, -d), P5 = new THREE.Vector3( w,  h, -d);
        const out = [];
        pushQuadOutward(out, P0, P1, P2, P3, new THREE.Vector3(0,-1,0));   // bottom
        pushQuadOutward(out, P0, P4, P5, P1, new THREE.Vector3(0,0,-1));   // back (tall) face
        pushQuadOutward(out, P4, P3, P2, P5, new THREE.Vector3(0,1,1));    // sloped ramp face
        // side triangles
        const nL = new THREE.Vector3().crossVectors(P3.clone().sub(P0), P4.clone().sub(P0));
        out.push(nL.dot(new THREE.Vector3(-1,0,0)) >= 0 ? [P0.clone(),P3.clone(),P4.clone()] : [P0.clone(),P4.clone(),P3.clone()]);
        const nR = new THREE.Vector3().crossVectors(P5.clone().sub(P1), P2.clone().sub(P1));
        out.push(nR.dot(new THREE.Vector3(1,0,0)) >= 0 ? [P1.clone(),P5.clone(),P2.clone()] : [P1.clone(),P2.clone(),P5.clone()]);

        const arr = new Float32Array(out.length * 9);
        out.forEach((t,i) => { for (let j=0;j<3;j++){ arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.computeVertexNormals();
        return g;
      }

      // Subdivides a (non-indexed) geometry by splitting any triangle whose longest
      // edge exceeds maxEdge into 4 via midpoints, repeated up to maxPasses times.
      // Extruded profiles come out with a few huge flat triangles; the sculpt brush
      // moves vertices, so without this it has nothing to grab on flat faces.
      function tessellateGeometry(geometry, maxEdge = 4, maxPasses = 6) {
        let pos = geometry.toNonIndexed().attributes.position;
        let verts = [];
        for (let i = 0; i < pos.count; i++) verts.push(new THREE.Vector3().fromBufferAttribute(pos, i));

        for (let pass = 0; pass < maxPasses; pass++) {
          let out = [];
          let didSplit = false;
          for (let i = 0; i < verts.length; i += 3) {
            const a = verts[i], b = verts[i+1], c = verts[i+2];
            const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a);
            const longest = Math.max(ab, bc, ca);
            if (longest <= maxEdge) { out.push(a, b, c); continue; }
            didSplit = true;
            // split the longest edge at its midpoint -> two triangles
            if (ab >= bc && ab >= ca) {
              const m = a.clone().add(b).multiplyScalar(0.5);
              out.push(a, m, c,  m, b, c);
            } else if (bc >= ab && bc >= ca) {
              const m = b.clone().add(c).multiplyScalar(0.5);
              out.push(a, b, m,  a, m, c);
            } else {
              const m = c.clone().add(a).multiplyScalar(0.5);
              out.push(a, b, m,  m, b, c);
            }
          }
          verts = out;
          if (!didSplit) break;
        }

        const arr = new Float32Array(verts.length * 3);
        verts.forEach((v, i) => { arr[i*3] = v.x; arr[i*3+1] = v.y; arr[i*3+2] = v.z; });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.computeVertexNormals();
        return g;
      }


      // ═══════════════════════════════════════════════════════════════════════
      //   NEW MODELING TOOLS  (shell, chamfer, array, align, smooth, revolve, loft)
      // ═══════════════════════════════════════════════════════════════════════

      // Helper: register a finished mesh in the scene as a normal solid.
      function registerSolid(mesh, selectIt) {
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); objects.push(mesh);
        if (selectIt) { objects.forEach(o => setEmissive(o, 0x000000)); selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh); }
      }

      // Helper: pull a mesh's triangles into world space as [{x,y,z}×3] arrays.
      function meshWorldTris(mesh) {
        mesh.updateMatrixWorld(true);
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = g.attributes.position, m = mesh.matrixWorld, tris = [];
        for (let i = 0; i < pos.count; i += 3) tris.push([
          V3().fromBufferAttribute(pos, i).applyMatrix4(m),
          V3().fromBufferAttribute(pos, i+1).applyMatrix4(m),
          V3().fromBufferAttribute(pos, i+2).applyMatrix4(m)
        ]);
        return tris;
      }

      // ── SHELL / HOLLOW ──────────────────────────────────────────────────────
      // Turn a solid into a wall of the given thickness by making an inner copy,
      // shrunk along its own vertex normals, then subtracting it (CSG) from the
      // original. This is the key orthotics operation — a scanned solid becomes a
      // wearable shell. Returns to the caller via CSG boolean.
      function shellSelected(thickness) {
        const mesh = selected.find(o => o.geometry && !o.userData.isSketch);
        if (!mesh) return banner("⚠️ Select a solid to shell/hollow.");
        if (!(thickness > 0)) return banner("⚠️ Enter a wall thickness > 0.");
        banner("Hollowing out — this can take a moment on detailed meshes…");
        setTimeout(() => {
          try {
            mesh.updateMatrixWorld(true);
            const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
            const pos = g.attributes.position;
            const sc = (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3;
            const t = thickness / sc;

            // Build the INNER cavity surface.
            //
            // The previous version pushed each TRIANGLE along its own face normal
            // independently. That produces a disconnected soup of triangles — the
            // shared corners come apart — and a BSP solver can't subtract a
            // non-manifold soup, which is why hollowing produced spikes and
            // fragments. The inner surface has to stay a CLOSED mesh.
            //
            // So: weld the vertices, average a normal per welded vertex, and move
            // each one inward. Connectivity is preserved exactly, so the result is
            // still closed. Sharp corners are the known weak spot — a vertex whose
            // faces disagree strongly would over-travel — so the offset is damped
            // by how much its faces agree.
            const key = (x, y, z) => Math.round(x*1e4)+'_'+Math.round(y*1e4)+'_'+Math.round(z*1e4);
            const vmap = new Map();      // key -> index into uniq
            const uniq = [];             // {p, n, w}
            const tri = [];              // triples of uniq indices
            {
              const a2 = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3();
              const fn = new THREE.Vector3();
              for (let i = 0; i < pos.count; i += 3) {
                a2.fromBufferAttribute(pos, i); b2.fromBufferAttribute(pos, i+1); c2.fromBufferAttribute(pos, i+2);
                fn.crossVectors(b2.clone().sub(a2), c2.clone().sub(a2));
                const area = fn.length() * 0.5;
                if (area < 1e-12) continue;               // skip degenerate faces
                fn.normalize();
                const ids = [a2, b2, c2].map(v => {
                  const k = key(v.x, v.y, v.z);
                  let id = vmap.get(k);
                  if (id === undefined) {
                    id = uniq.length;
                    vmap.set(k, id);
                    uniq.push({ p: v.clone(), n: new THREE.Vector3(), w: 0 });
                  }
                  // area-weighted normal accumulation
                  uniq[id].n.addScaledVector(fn, area);
                  uniq[id].w += area;
                  return id;
                });
                tri.push(ids);
              }
            }
            if (!tri.length) throw new Error('that mesh has no usable faces');
            // Offset each welded vertex inward along its averaged normal.
            const shrunk = uniq.map(v => {
              const nn = v.n.clone().normalize();
              return v.p.clone().addScaledVector(nn, -t);
            });
            const innerVerts = [];
            tri.forEach(([ia, ib, ic]) => {
              const A = shrunk[ia], B = shrunk[ib], C = shrunk[ic];
              // Reverse winding so the cavity's surface faces inward.
              innerVerts.push(A.x,A.y,A.z, C.x,C.y,C.z, B.x,B.y,B.z);
            });
            const innerGeo = new THREE.BufferGeometry();
            innerGeo.setAttribute('position', new THREE.Float32BufferAttribute(innerVerts, 3));
            innerGeo.computeVertexNormals();
            const innerMesh = new THREE.Mesh(innerGeo, mesh.material.clone());
            innerMesh.applyMatrix4(mesh.matrixWorld);
            innerMesh.updateMatrixWorld(true);

            // If the walls are thicker than the part, the offset surface turns
            // itself inside out. Catch that here rather than handing the solver
            // geometry it will turn into confetti.
            {
              const ip = innerGeo.attributes.position;
              let vol = 0;
              const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
              for (let i = 0; i < ip.count; i += 3) {
                p0.fromBufferAttribute(ip, i); p1.fromBufferAttribute(ip, i+1); p2.fromBufferAttribute(ip, i+2);
                vol += p0.dot(p1.clone().cross(p2)) / 6;
              }
              const bbox = new THREE.Box3().setFromObject(mesh);
              const s = bbox.getSize(new THREE.Vector3());
              const outerVol = s.x * s.y * s.z;
              if (Math.abs(vol) < outerVol * 0.002) {
                throw new Error('walls that thick would close the cavity — try a thinner wall');
              }
            }

            // No boolean needed. A hollow solid IS its outer surface plus an
            // inward-facing inner surface — two closed shells in one mesh, which
            // is exactly what a slicer reads as a hollow part.
            //
            // Subtracting with the BSP engine was measurably worse: with both
            // input meshes verified closed (0 open edges each), the subtract still
            // returned 3 open edges on a cube and 512 on a sphere. Concatenating
            // the two surfaces is watertight by construction and far faster.
            const outPos = [];
            {
              const op = g.attributes.position;
              for (let i2 = 0; i2 < op.count; i2++) {
                outPos.push(op.getX(i2), op.getY(i2), op.getZ(i2));
              }
              const ipos = innerGeo.attributes.position;
              for (let i2 = 0; i2 < ipos.count; i2++) {
                outPos.push(ipos.getX(i2), ipos.getY(i2), ipos.getZ(i2));
              }
            }
            const outGeo = new THREE.BufferGeometry();
            outGeo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
            // The whole hollowing pass above works in the mesh's own LOCAL space
            // (matching how its vertex-welding and wall-thickness math was
            // written and verified), so outGeo's vertices are still local at
            // this point -- not yet transformed by the object's position,
            // rotation or scale. Baking matrixWorld in now, once, converts the
            // finished shell to world space before anything downstream treats
            // it as if it already were: recenterMeshTransform() computes a
            // fresh mesh's centre from whatever frame its geometry is in, and
            // without this the result would be centred in the ORIGINAL
            // object's local frame, e.g. near (0,0,0) for a primitive whose own
            // geometry starts there — moving the hollowed part to the origin
            // instead of leaving it where the solid was.
            outGeo.applyMatrix4(mesh.matrixWorld);
            outGeo.computeVertexNormals();

            // Sanity check: a valid shell has clearly MORE triangles than the solid
            // (outer walls + inner walls). If the boolean collapsed, bail cleanly
            // rather than replacing the good solid with a broken one.
            if (outGeo.attributes.position.count < pos.count) {
              banner("⚠️ Shell failed on this mesh — try a smaller thickness, or Smooth it first.");
              return;
            }

            const shelled = new THREE.Mesh(outGeo, mesh.material.clone());
            shelled.material.side = THREE.DoubleSide;
            recenterMeshTransform(shelled);
            scene.remove(mesh); objects = objects.filter(o => o !== mesh);
            transformControl.detach();
            registerSolid(shelled, true);
            saveHistory(); updateStatus(); updateFloatingHUD();
            banner(`Hollowed to a ${thickness} mm shell.`);
          } catch (e) { console.error(e); banner("⚠️ Shell failed on this mesh — try a smaller thickness or lower detail."); }
        }, 30);
      }

      // ── CHAMFER (flat bevel on picked edges) ────────────────────────────────
      // Reuses the fillet edge picker but cuts a flat bevel instead of a round.
      // Implemented as a small boolean: build a cutting prism along each picked
      // edge, angled at 45°, and subtract. For robustness we approximate by
      // scaling the fillet with a single-segment (flat) profile.
      function chamferPickedEdges(size) {
        if (!filletState.mesh) return banner("⚠️ Pick edges with the Fillet tool first, then chamfer.");
        if (filletState.picked.size === 0) return banner("⚠️ Click at least one edge to pick it.");
        // Pass chamfer=true straight through so the deferred geometry work uses the
        // flat-bevel profile (no reliance on a global that could reset early).
        filletPickedEdges(true);
      }

      // ── ARRAY / PATTERN ─────────────────────────────────────────────────────
      // Linear: N copies spaced by (dx,dy,dz) mm. Circular: N copies revolved
      // around the world Z axis through the selection centre.
      function arrayLinear(count, dx, dy, dz) {
        // Array works on solids AND baked sketch layers (so you can lay out a row or
        // grid of holes/perforations to cut later).
        const targets = selected.filter(o => o.geometry || o.userData.isSketch);
        if (!targets.length) return banner("⚠️ Select a solid or a baked sketch to array.");
        if (count < 2) return banner("⚠️ Count must be 2 or more.");
        detachGroupPivot();
        const made = [];
        targets.forEach(src => {
          for (let i = 1; i < count; i++) {
            const c = cloneObject(src, 0);
            c.position.x = src.position.x + dx * i;
            c.position.y = src.position.y + dy * i;
            c.position.z = src.position.z + dz * i;
            made.push(c);
          }
        });
        objects.forEach(o => setEmissive(o, 0x000000));
        made.forEach(c => { scene.add(c); objects.push(c); });
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Linear array — added ${made.length} cop${made.length===1?'y':'ies'}.`);
      }

      // A custom rotation centre for circular array, set by picking a point in the
      // viewport. null = use the object's own centre.
      let arrayCentrePoint = null;
      let arrayPickingCentre = false;   // true while waiting for a centre-point click

      function arrayCircular(count) {
        const targets = selected.filter(o => o.geometry || o.userData.isSketch);
        if (!targets.length) return banner("⚠️ Select a solid or a baked sketch to array.");
        if (count < 2) return banner("⚠️ Count must be 2 or more.");
        detachGroupPivot();

        // Rotation centre: the picked point if the user set one, otherwise the true
        // centre of the selected geometry's bounding box (NOT the object's transform
        // origin, which for a baked sketch sits at the plane origin, not the shape).
        let centre;
        if (arrayCentrePoint) {
          centre = arrayCentrePoint.clone();
        } else {
          const box = new THREE.Box3();
          targets.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
          centre = new THREE.Vector3(); box.getCenter(centre);
        }

        const made = [];
        targets.forEach(src => {
          // Pivot each copy about `centre` in the XY plane (around world Z). We work
          // from the copy's own bounding-box centre so the shape orbits correctly even
          // when its transform origin is elsewhere (the sketch-on-plane case).
          src.updateMatrixWorld(true);
          const srcBox = new THREE.Box3().setFromObject(src);
          const srcCentre = new THREE.Vector3(); srcBox.getCenter(srcCentre);
          const rel = srcCentre.clone().sub(centre);   // offset of the shape from the pivot
          for (let i = 1; i < count; i++) {
            const ang = (Math.PI * 2 / count) * i;
            const c = cloneObject(src, 0);
            const cos = Math.cos(ang), sin = Math.sin(ang);
            // where the copy's shape-centre should land after rotating about the pivot
            const newX = centre.x + rel.x * cos - rel.y * sin;
            const newY = centre.y + rel.x * sin + rel.y * cos;
            // shift the copy by (new shape centre − old shape centre), then spin it
            c.position.x += (newX - srcCentre.x);
            c.position.y += (newY - srcCentre.y);
            c.rotateZ(ang);   // spin the copy to match its new orientation
            made.push(c);
          }
        });
        objects.forEach(o => setEmissive(o, 0x000000));
        made.forEach(c => { scene.add(c); objects.push(c); });
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Circular array — added ${made.length} cop${made.length===1?'y':'ies'}${arrayCentrePoint ? ' around your picked point' : ''}.`);
      }

      // Enter "pick a rotation centre" mode: the next viewport click sets the point.
      function beginArrayCentrePick() {
        arrayPickingCentre = true;
        currentMode = 'array_pick_centre';
        banner("Click a point on your object to set the rotation centre.");
      }

      // ── ALIGN / DISTRIBUTE ──────────────────────────────────────────────────
      // Align the selected objects on an axis: min / centre / max face.
      function alignSelected(axis, mode) {
        const targets = selected.filter(o => o.geometry && !o.userData.isSketch);
        if (targets.length < 2) return banner("⚠️ Select 2 or more objects to align.");
        detachGroupPivot();
        const ai = axis; // 'x'|'y'|'z'
        const boxes = targets.map(o => { o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); return { o, b }; });
        let target;
        if (mode === 'min') target = Math.min(...boxes.map(x => x.b.min[ai]));
        else if (mode === 'max') target = Math.max(...boxes.map(x => x.b.max[ai]));
        else target = boxes.reduce((s,x)=>s+(x.b.min[ai]+x.b.max[ai])/2,0)/boxes.length; // centre
        boxes.forEach(({o,b}) => {
          let cur;
          if (mode === 'min') cur = b.min[ai];
          else if (mode === 'max') cur = b.max[ai];
          else cur = (b.min[ai]+b.max[ai])/2;
          o.position[ai] += (target - cur);
        });
        refreshSelectionVisual(); attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Aligned ${targets.length} objects on ${axis.toUpperCase()} (${mode}).`);
      }

      // Distribute: even spacing between object centres along an axis.
      function distributeSelected(axis) {
        const targets = selected.filter(o => o.geometry && !o.userData.isSketch);
        if (targets.length < 3) return banner("⚠️ Select 3 or more objects to distribute.");
        detachGroupPivot();
        const ai = axis;
        const items = targets.map(o => { o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); return { o, c: (b.min[ai]+b.max[ai])/2 }; });
        items.sort((p,q) => p.c - q.c);
        const first = items[0].c, last = items[items.length-1].c;
        const step = (last - first) / (items.length - 1);
        items.forEach((it, i) => { const targetC = first + step * i; it.o.position[ai] += (targetC - it.c); });
        refreshSelectionVisual(); attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Distributed ${targets.length} objects evenly on ${axis.toUpperCase()}.`);
      }

      // ── MESH SMOOTHING (Laplacian) ──────────────────────────────────────────
      // Average each vertex toward the mean of its neighbours, softening bumps and
      // scan noise. Operates on a welded copy so shared edges move together, then
      // writes the smoothed positions back to the (non-indexed) render geometry.
      function smoothSelected(iterations, strength) {
        const mesh = selected.find(o => o.geometry && !o.userData.isSketch);
        if (!mesh) return banner("⚠️ Select a solid to smooth.");
        banner("Smoothing…");
        setTimeout(() => {
          try {
            const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
            const pos = g.attributes.position;
            const n = pos.count;
            // Weld vertices by position so we can find neighbours across triangles.
            const keyOf = (i) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
            const map = new Map();     // key -> unique id
            const ids = new Int32Array(n);
            const uniq = [];           // id -> {x,y,z}
            for (let i = 0; i < n; i++) {
              const k = keyOf(i);
              let id = map.get(k);
              if (id === undefined) { id = uniq.length; map.set(k, id); uniq.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))); }
              ids[i] = id;
            }
            // adjacency from triangle edges
            const adj = uniq.map(() => new Set());
            for (let i = 0; i < n; i += 3) {
              const a = ids[i], b = ids[i+1], c = ids[i+2];
              adj[a].add(b); adj[a].add(c); adj[b].add(a); adj[b].add(c); adj[c].add(a); adj[c].add(b);
            }
            const s = Math.max(0, Math.min(1, strength));
            for (let it = 0; it < iterations; it++) {
              const next = uniq.map(v => v.clone());
              for (let u = 0; u < uniq.length; u++) {
                const nb = adj[u]; if (!nb.size) continue;
                const avg = new THREE.Vector3();
                nb.forEach(j => avg.add(uniq[j]));
                avg.multiplyScalar(1 / nb.size);
                next[u].lerp(avg, s);
              }
              for (let u = 0; u < uniq.length; u++) uniq[u].copy(next[u]);
            }
            // write back
            for (let i = 0; i < n; i++) { const v = uniq[ids[i]]; pos.setX(i, v.x); pos.setY(i, v.y); pos.setZ(i, v.z); }
            pos.needsUpdate = true;
            g.computeVertexNormals();
            if (mesh.geometry !== g) { mesh.geometry.dispose(); mesh.geometry = g; }
            saveHistory(); updateStatus();
            banner(`Smoothed (${iterations} pass${iterations>1?'es':''}).`);
          } catch (e) { console.error(e); banner("⚠️ Smoothing failed on this mesh."); }
        }, 30);
      }

      // ── REVOLVE (lathe a sketch profile around an axis) ─────────────────────
      // Takes the most recent baked sketch (or the active sketch profile) and spins
      // its 2D outline around the sketch's local V (vertical) axis to make a solid
      // of revolution — heel cups, sockets, cylindrical posts, etc.
      function revolveSketch(segmentsCount, degrees, axis, offset) {
        // find a baked sketch layer to revolve
        const sketchGrp = [...selected, ...objects].find(o => o.userData && o.userData.isSketch && o.userData.shapes);
        if (!sketchGrp) return banner("⚠️ Bake a sketch first (a closed profile), select it, then Revolve.");
        const shapes = sketchGrp.userData.shapes;
        if (!shapes || !shapes.length) return banner("⚠️ That sketch has no closed profile.");
        try {
          const seg = Math.max(3, Math.min(256, segmentsCount|0));
          const arc = THREE.MathUtils.degToRad(Math.max(10, Math.min(360, degrees)));
          const closed = degrees >= 360;
          const tf = sketchWorldMatrix(sketchGrp);   // sketch-plane → world (recenter-aware)
          const raxis = axis || 'y';
          const off = offset || 0;
          let built = 0;

          shapes.forEach(shape => {
            const pts2d = shape.getPoints(96);
            // Profile lives on the sketch plane (local x = u, y = v). We revolve each
            // point around the chosen local axis line. For a vertical axis the
            // "radius" is the point's distance from x = `off`; for horizontal it's the
            // distance from y = `off`. The axis line lies in the sketch plane, so the
            // swept 3rd dimension is the sketch-plane normal (local +Z).
            const profile = pts2d.map(p => {
              if (raxis === 'y') return { radius: p.x - off, along: p.y };  // spin about vertical line x=off
              return { radius: p.y - off, along: p.x };                     // spin about horizontal line y=off
            });

            const verts = [];
            const ringA = new THREE.Vector3(), ringB = new THREE.Vector3();
            // Build a local point from (radius, along, angle) back into sketch-local
            // 3D coords, then into world with tf.
            const localToWorld = (radius, along, ang) => {
              const cs = Math.cos(ang), sn = Math.sin(ang);
              // rotate the radius vector in the (plane-axis, normal) space
              let lx, ly, lz;
              if (raxis === 'y') { lx = off + radius * cs; ly = along; lz = radius * sn; }
              else               { lx = along;             ly = off + radius * cs; lz = radius * sn; }
              return new THREE.Vector3(lx, ly, lz).applyMatrix4(tf);
            };
            const P = profile.length;
            for (let s = 0; s < seg; s++) {
              const a0 = arc * (s / seg), a1 = arc * ((s+1) / seg);
              for (let i = 0; i < P - 1; i++) {
                const p0 = profile[i], p1 = profile[i+1];
                const v00 = localToWorld(p0.radius, p0.along, a0);
                const v01 = localToWorld(p0.radius, p0.along, a1);
                const v10 = localToWorld(p1.radius, p1.along, a0);
                const v11 = localToWorld(p1.radius, p1.along, a1);
                // two triangles per quad
                verts.push(v00.x,v00.y,v00.z, v10.x,v10.y,v10.z, v11.x,v11.y,v11.z);
                verts.push(v00.x,v00.y,v00.z, v11.x,v11.y,v11.z, v01.x,v01.y,v01.z);
              }
            }
            // Cap the two open ends when it's a partial sweep (fan each end face).
            if (!closed) {
              const capFan = (ang, flip) => {
                for (let i = 1; i < P - 1; i++) {
                  const a = localToWorld(profile[0].radius, profile[0].along, ang);
                  const b = localToWorld(profile[i].radius, profile[i].along, ang);
                  const c = localToWorld(profile[i+1].radius, profile[i+1].along, ang);
                  if (flip) verts.push(a.x,a.y,a.z, c.x,c.y,c.z, b.x,b.y,b.z);
                  else      verts.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
                }
              };
              capFan(0, false); capFan(arc, true);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(makeGeometryCSGReady(geo), new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.45, side: THREE.DoubleSide }));
            recenterMeshTransform(mesh);
            registerSolid(mesh, built === 0);
            built++;
          });
          saveHistory(); updateStatus(); updateFloatingHUD();
          banner(`Revolved ${built} profile${built>1?'s':''} (${degrees}° around ${raxis === 'y' ? 'vertical' : 'horizontal'} axis).`);
        } catch (e) { console.error(e); banner("⚠️ Revolve failed — check the profile and axis position."); }
      }

      // ── LOFT (connect two selected sketch profiles) ─────────────────────────
      // Builds a skin between two baked sketch layers by matching their outline
      // points and bridging with quads. Great for tapered transitions/struts.
      // Extract the ordered outer boundary loop of a coplanar face region as a ring
      // of world-space points — the solid-face equivalent of a sketch profile, so we
      // can loft to/from real faces, not just sketches. `pick` is {mesh, seedTri}.
      function faceBoundaryRing(mesh, seedTri) {
        const info = findCoplanarFaceTriangles(mesh, seedTri);
        if (!info) return null;
        mesh.updateMatrixWorld(true);
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const inc = info.included;
        const keyOf = (p) => `${p.x.toFixed(4)}_${p.y.toFixed(4)}_${p.z.toFixed(4)}`;
        // Count how many included triangles use each undirected edge; boundary edges
        // are used exactly once.
        const edgeCount = new Map(); const edgePts = new Map();
        const vAt = (t,k) => new THREE.Vector3().fromBufferAttribute(pos, t*3+k);
        inc.forEach(t => {
          const v = [vAt(t,0), vAt(t,1), vAt(t,2)];
          for (let e=0;e<3;e++){
            const a=v[e], b=v[(e+1)%3];
            const ka=keyOf(a), kb=keyOf(b); const k = ka<kb ? ka+'|'+kb : kb+'|'+ka;
            edgeCount.set(k, (edgeCount.get(k)||0)+1);
            if (!edgePts.has(k)) edgePts.set(k, [a, b]);
          }
        });
        const boundary = [];
        edgeCount.forEach((c,k)=>{ if (c===1) boundary.push(edgePts.get(k)); });
        if (!boundary.length) return null;
        // Chain boundary edges into an ordered loop.
        const used = new Array(boundary.length).fill(false);
        const ring = [boundary[0][0].clone(), boundary[0][1].clone()]; used[0]=true;
        let guard = 0;
        while (guard++ < boundary.length + 5) {
          const end = ring[ring.length-1];
          let found = -1, flip = false;
          for (let i=0;i<boundary.length;i++){
            if (used[i]) continue;
            if (boundary[i][0].distanceTo(end) < 1e-3) { found=i; flip=false; break; }
            if (boundary[i][1].distanceTo(end) < 1e-3) { found=i; flip=true; break; }
          }
          if (found < 0) break;
          used[found]=true;
          const next = flip ? boundary[found][0] : boundary[found][1];
          if (next.distanceTo(ring[0]) < 1e-3) break; // closed
          ring.push(next.clone());
        }
        // to world space
        return ring.map(p => p.clone().applyMatrix4(mesh.matrixWorld));
      }

      // Resample a closed ring to exactly N evenly-spaced points (arc-length).
      function resampleRing(ring, N) {
        // total perimeter
        const segs = [];
        let total = 0;
        for (let i=0;i<ring.length;i++){ const a=ring[i], b=ring[(i+1)%ring.length]; const d=a.distanceTo(b); segs.push(d); total+=d; }
        if (total < 1e-6) return ring.slice(0, N);
        const out = []; const step = total / N;
        for (let n=0;n<N;n++){
          let target = n * step;
          // walk to the right segment
          let acc = 0; let i=0;
          for (i=0;i<ring.length;i++){ if (acc + segs[i] >= target || i===ring.length-1) break; acc += segs[i]; }
          const a = ring[i], b = ring[(i+1)%ring.length];
          const f = segs[i] > 1e-9 ? (target - acc)/segs[i] : 0;
          out.push(a.clone().lerp(b, Math.max(0, Math.min(1, f))));
        }
        return out;
      }

      function loftSelectedSketches() {
        const N = 80;
        // Gather up to two loft profiles. Priority: picked push/pull faces (solid
        // faces), then selected baked sketch layers. This lets you loft face→face,
        // sketch→sketch, or face→sketch.
        const rings = [];
        // (1) any picked faces from the Push/Pull face picker
        if (pushPullFaceState.faces && pushPullFaceState.faces.length) {
          pushPullFaceState.faces.forEach(f => {
            if (rings.length >= 2) return;
            const seed = (f.included && f.included.size) ? [...f.included][0] : f.triIndex;
            const r = faceBoundaryRing(f.mesh, seed);
            if (r && r.length >= 3) rings.push(resampleRing(r, N));
          });
        }
        // (2) selected baked sketches
        const sketches = selected.filter(o => o.userData && o.userData.isSketch && o.userData.shapes && o.userData.shapes.length);
        sketches.forEach(grp => {
          if (rings.length >= 2) return;
          const shape = grp.userData.shapes[0];
          const tf = sketchWorldMatrix(grp);
          const pts = shape.getSpacedPoints(N);
          rings.push(pts.map(p => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(tf)));
        });

        if (rings.length < 2) return banner("⚠️ Loft needs two profiles — pick two solid faces (Push/Pull tool), or select two baked sketches, or one of each.");

        try {
          let A = rings[0].slice();
          let B = rings[1].slice();

          // Centroids of each ring, and the loft axis (the line joining them).
          const centroid = (r) => { const c = new THREE.Vector3(); r.forEach(p => c.add(p)); return c.multiplyScalar(1 / r.length); };
          const cA = centroid(A), cB = centroid(B);
          const axis = cB.clone().sub(cA);
          if (axis.lengthSq() < 1e-9) axis.set(0, 1, 0);
          axis.normalize();

          // Signed winding of a ring about the loft axis (viewed along +axis). We use
          // the sum of signed angles swept by successive vertices around the centroid.
          const windingSign = (r, c) => {
            // build an in-plane basis perpendicular to the axis
            let u = new THREE.Vector3(1, 0, 0);
            if (Math.abs(axis.dot(u)) > 0.9) u.set(0, 1, 0);
            u.sub(axis.clone().multiplyScalar(u.dot(axis))).normalize();
            const v = new THREE.Vector3().crossVectors(axis, u).normalize();
            let total = 0;
            for (let i = 0; i < r.length; i++) {
              const p0 = r[i].clone().sub(c), p1 = r[(i + 1) % r.length].clone().sub(c);
              const a0 = Math.atan2(p0.dot(v), p0.dot(u));
              const a1 = Math.atan2(p1.dot(v), p1.dot(u));
              let d = a1 - a0;
              while (d > Math.PI) d -= 2 * Math.PI;
              while (d < -Math.PI) d += 2 * Math.PI;
              total += d;
            }
            return total; // ~ +2π for CCW, -2π for CW about the axis
          };

          // Make both rings wind the SAME way around the axis. If they differ, reverse
          // B — this is what stops the criss-cross "bowtie" skin.
          if (windingSign(A, cA) * windingSign(B, cB) < 0) B.reverse();

          // Now rotate B so its start vertex is angularly aligned with A's start, using
          // the shared in-plane basis (angle match, not just nearest 3D point — more
          // reliable when the two faces are different sizes or offset).
          let u = new THREE.Vector3(1, 0, 0);
          if (Math.abs(axis.dot(u)) > 0.9) u.set(0, 1, 0);
          u.sub(axis.clone().multiplyScalar(u.dot(axis))).normalize();
          const v = new THREE.Vector3().crossVectors(axis, u).normalize();
          const angleOf = (p, c) => { const d = p.clone().sub(c); return Math.atan2(d.dot(v), d.dot(u)); };
          const aStart = angleOf(A[0], cA);
          let bestOff = 0, bestD = Infinity;
          for (let o = 0; o < B.length; o++) {
            let da = Math.abs(angleOf(B[o], cB) - aStart);
            if (da > Math.PI) da = 2 * Math.PI - da;
            if (da < bestD) { bestD = da; bestOff = o; }
          }
          const Bo = B.map((_, i) => B[(i + bestOff) % B.length]);

          const verts = [];
          const push = (p) => verts.push(p.x, p.y, p.z);
          for (let i = 0; i < N; i++) {
            const i2 = (i + 1) % N;
            // two triangles per quad bridging ring A → ring B
            push(A[i]); push(A[i2]); push(Bo[i2]);
            push(A[i]); push(Bo[i2]); push(Bo[i]);
          }
          // Cap both open ends so the loft is a closed solid.
          const capFan = (ring, flip) => { for (let i = 1; i < ring.length - 1; i++) { if (!flip) { push(ring[0]); push(ring[i]); push(ring[i+1]); } else { push(ring[0]); push(ring[i+1]); push(ring[i]); } } };
          capFan(A, false); capFan(Bo, true);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(makeGeometryCSGReady(geo), new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.45, side: THREE.DoubleSide }));
          recenterMeshTransform(mesh);
          registerSolid(mesh, true);
          saveHistory(); updateStatus(); updateFloatingHUD();
          banner("Lofted a skin between the two profiles.");
        } catch (e) { console.error(e); banner("⚠️ Loft failed — try two simple, similar profiles."); }
      }

      function copySelected() {
        if (!selected.length) { banner("Nothing selected to copy."); return; }
        detachGroupPivot();
        clipboard = selected.map(s => cloneObject(s, 0));
        if (selected.length > 1) attachGizmoToSelection();
        banner(clipboard.length > 1 ? `Copied ${clipboard.length} objects.` : "Copied.");
      }

      function cutSelected() {
        if (!selected.length) { banner("Nothing selected to cut."); return; }
        detachGroupPivot();
        clipboard = selected.map(s => cloneObject(s, 0));
        const n = selected.length;
        selected.forEach(s => scene.remove(s));
        objects = objects.filter(o => !selected.includes(o));
        selected = []; transformControl.detach();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(n > 1 ? `Cut ${n} objects.` : "Cut.");
      }

      function pasteClipboard() {
        if (!clipboard || !clipboard.length) { banner("Clipboard is empty."); return; }
        detachGroupPivot();
        const pasted = clipboard.map(src => {
          const c = cloneObject(src, 20);   // offset so it doesn't overlap the original
          c.position.z += 20;
          return c;
        });
        objects.forEach(o => setEmissive(o, 0x000000));
        pasted.forEach(c => { scene.add(c); objects.push(c); });
        selected = pasted;
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(pasted.length > 1 ? `Pasted ${pasted.length} objects.` : "Pasted.");
      }

      function restoreStateFromSnapshot(snapshot) {
        detachGroupPivot();
        transformControl.detach(); selected = [];
        objects.forEach(obj => scene.remove(obj));
        objects = snapshot.map(obj => {
          const res = obj.clone();
          if (obj.geometry) res.geometry = obj.geometry.clone();
          if (obj.material) {
            if (Array.isArray(obj.material)) res.material = obj.material.map(m => m.clone());
            else res.material = obj.material.clone();
          }
          res.userData = cloneUserData(obj.userData);
          res.name = obj.name;
          scene.add(res); return res;
        });
        updateStatus(); updateFloatingHUD();
      }


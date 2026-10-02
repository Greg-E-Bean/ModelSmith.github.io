      // ── Edge picking: screen-space hit test + "connected" similarity select ──
      // Picking used a fixed 4 mm world tolerance, so on a small part everything
      // was in range and on a curve (a cylinder rim is 96 tiny segments) one click
      // got one sliver. Now the hit test is in screen pixels, and — like a magic
      // wand — Connected mode grows the pick along neighbouring edges that carry
      // on smoothly and have a similar crease angle, so one click takes a whole rim.
      const filletPickOpts = { connected: true, tol: 40 };
      function filletTolerances() {
        const t = Math.max(0, Math.min(100, filletPickOpts.tol)) / 100;
        return { dihedral: 3 + t * 40, turn: 6 + t * 60 };     // degrees
      }
      const _fpA = new THREE.Vector3(), _fpB = new THREE.Vector3();
      function pickFilletEdgeUnderCursor() {
        if (!filletState.edges.length) return -1;
        const el = renderer.domElement, W = el.clientWidth, H = el.clientHeight;
        const mx = (mouse.x + 1) / 2 * W, my = (1 - mouse.y) / 2 * H;
        const tolPx = (matchMedia && matchMedia('(pointer: coarse)').matches) ? 24 : 12;
        let best = -1, bestD = tolPx, bestZ = Infinity;
        filletState.edges.forEach((e, idx) => {
          _fpA.copy(e.a).project(camera); _fpB.copy(e.b).project(camera);
          if (_fpA.z > 1 && _fpB.z > 1) return;
          const ax = (_fpA.x + 1) / 2 * W, ay = (1 - _fpA.y) / 2 * H;
          const bx = (_fpB.x + 1) / 2 * W, by = (1 - _fpB.y) / 2 * H;
          const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
          let s = L2 > 1e-9 ? ((mx - ax) * dx + (my - ay) * dy) / L2 : 0;
          s = Math.max(0, Math.min(1, s));
          const px = ax + dx * s, py = ay + dy * s;
          const d = Math.hypot(mx - px, my - py);
          const z = _fpA.z + (_fpB.z - _fpA.z) * s;
          // nearest on screen wins; among near-ties prefer the one in front
          if (d < bestD - 1.5 || (d < bestD + 1.5 && z < bestZ)) { bestD = Math.min(bestD, d); bestZ = z; best = idx; }
        });
        return best;
      }

      // Adjacency between merged feature edges, by shared endpoint.
      function filletAdjacency() {
        if (filletState._adj && filletState._adjFor === filletState.edges) return filletState._adj;
        // Cluster endpoints within 0.01 mm (checking neighbouring grid cells) so
        // boolean output whose seam points differ by a hair still connects.
        const grid = new Map(), reps = [];
        const key = p => {
          const ix = Math.round(p.x * 100), iy = Math.round(p.y * 100), iz = Math.round(p.z * 100);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
            const hit = grid.get((ix + a) + ',' + (iy + b) + ',' + (iz + c));
            if (hit !== undefined && reps[hit].distanceTo(p) < 0.01) return 'v' + hit;
          }
          const id = reps.length; reps.push(p); grid.set(ix + ',' + iy + ',' + iz, id);
          return 'v' + id;
        };
        const byPt = new Map();
        filletState.edges.forEach((e, i) => {
          e._ka = key(e.a); e._kb = key(e.b);
          [e._ka, e._kb].forEach(k => { let a = byPt.get(k); if (!a) byPt.set(k, a = []); a.push(i); });
        });
        filletState._adj = byPt; filletState._adjFor = filletState.edges;
        return byPt;
      }
      // Grow from a seed edge like a magic wand: step to neighbours that continue
      // smoothly (small turn) and have a similar crease angle to the seed.
      function filletGrowChain(seed) {
        const edges = filletState.edges;
        if (!filletPickOpts.connected || seed < 0) return [seed];
        const adj = filletAdjacency();
        const { dihedral, turn } = filletTolerances();
        const cosTurn = Math.cos(THREE.MathUtils.degToRad(turn));
        const seedAng = edges[seed].ang || 90;
        const out = new Set([seed]);
        const stack = [seed];
        while (stack.length) {
          const i = stack.pop(); const e = edges[i];
          for (const [k, here, other] of [[e._ka, e.a, e.b], [e._kb, e.b, e.a]]) {
            const dirIn = here.clone().sub(other).normalize();          // arriving at `here`
            let grew = false, sawAny = false;
            const consider = (j, from, to) => {
              const f = edges[j];
              const dirOut = to.clone().sub(from).normalize();           // leaving `here`
              if (dirIn.dot(dirOut) < cosTurn) return false;              // too sharp a turn
              if (Math.abs((f.ang || 90) - seedAng) > dihedral) return false; // different crease
              out.add(j); stack.push(j); return true;
            };
            (adj.get(k) || []).forEach(j => {
              if (j === i) return;
              sawAny = true;
              if (out.has(j)) return;
              const f = edges[j];
              if (consider(j, here, f._ka === k ? f.b : f.a)) grew = true;
            });
            // Dead end with nothing attached: boolean seams can leave a tiny gap
            // in the crease (an edge that isn't detected). Hop it if the next
            // edge carries straight on within a short distance.
            if (!grew && !sawAny) {
              const gap = Math.max(0.3, e.a.distanceTo(e.b) * 1.5);
              let bestJ = -1, bestD = gap, bestNear = null, bestFar = null;
              edges.forEach((f, j) => {
                if (out.has(j)) return;
                const da = f.a.distanceTo(here), db = f.b.distanceTo(here);
                const d = Math.min(da, db);
                if (d < bestD) { bestD = d; bestJ = j; bestNear = da < db ? f.a : f.b; bestFar = da < db ? f.b : f.a; }
              });
              if (bestJ >= 0) consider(bestJ, bestNear, bestFar);
            }
          }
        }
        return [...out];
      }

      function filletHover() {
        if (activeTool !== 'fillet' || !filletState.edges.length) return;
        const idx = pickFilletEdgeUnderCursor();
        if (idx !== filletState.hovered) {
          filletState.hovered = idx;
          filletState.hoverSet = idx >= 0 ? new Set(filletGrowChain(idx)) : null;
          renderFilletEdges();
        }
      }

      function filletClickPick() {
        if (!filletState.edges.length) return false;
        const idx = pickFilletEdgeUnderCursor();
        if (idx < 0) return false;
        const chain = filletGrowChain(idx);
        const removing = filletState.picked.has(idx);
        chain.forEach(i => removing ? filletState.picked.delete(i) : filletState.picked.add(i));
        renderFilletEdges(); updateFilletCount();
        const n = filletState.picked.size;
        document.getElementById('fillet-hint').textContent = n
          ? `${n} edge segment${n > 1 ? 's' : ''} picked${chain.length > 1 ? ` (last click took ${chain.length} connected)` : ''} — set a radius and Fillet picked.`
          : 'Click an edge to pick it.';
        return true;
      }

      // Group picked edges into connected chains, ordered end to end.
      function filletPickedChains() {
        const edges = filletState.edges; filletAdjacency();
        const left = new Set(filletState.picked); const chains = [];
        while (left.size) {
          const start = left.values().next().value; left.delete(start);
          const list = [start];
          // walk both directions
          const ptOf = {}; edges.forEach(e => { ptOf[e._ka] = e.a; ptOf[e._kb] = e.b; });
          const walk = (fromKey, toFront) => {
            let k = fromKey;
            for (;;) {
              let nxt = [...left].find(j => edges[j]._ka === k || edges[j]._kb === k);
              if (nxt === undefined) {
                // bridge a small seam gap (see filletGrowChain)
                const here = ptOf[k]; let bd = 0.6;
                left.forEach(j => { const d = Math.min(edges[j].a.distanceTo(here), edges[j].b.distanceTo(here)); if (d < bd) { bd = d; nxt = j; } });
                if (nxt === undefined) break;
                const ej = edges[nxt];
                k = ej.a.distanceTo(here) <= ej.b.distanceTo(here) ? ej._ka : ej._kb;
              }
              left.delete(nxt);
              toFront ? list.unshift(nxt) : list.push(nxt);
              k = edges[nxt]._ka === k ? edges[nxt]._kb : edges[nxt]._ka;
            }
          };
          walk(edges[start]._kb, false); walk(edges[start]._ka, true);
          // ordered points
          const pts = [];
          let cur;
          if (list.length === 1) { pts.push(edges[list[0]].a.clone(), edges[list[0]].b.clone()); }
          else {
            const e0 = edges[list[0]], e1 = edges[list[1]];
            const dB = Math.min(e0.b.distanceTo(e1.a), e0.b.distanceTo(e1.b));
            const dA = Math.min(e0.a.distanceTo(e1.a), e0.a.distanceTo(e1.b));
            cur = dB <= dA ? 'b' : 'a';
            pts.push((cur === 'b' ? e0.a : e0.b).clone(), (cur === 'b' ? e0.b : e0.a).clone());
            for (let t = 1; t < list.length; t++) {
              const e = edges[list[t]], last = pts[pts.length - 1];
              const nearA = e.a.distanceTo(last) <= e.b.distanceTo(last);
              if ((nearA ? e.a : e.b).distanceTo(last) > 1e-2) pts.push((nearA ? e.a : e.b).clone());   // gap: keep both ends
              pts.push((nearA ? e.b : e.a).clone());
            }
          }
          const closed = pts.length > 3 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-2;
          if (closed) pts.pop();
          // maximum turn along the chain decides which fillet method fits
          let maxTurn = 0;
          const n = pts.length;
          for (let i = 1; i < (closed ? n + 1 : n - 1); i++) {
            const p0 = pts[(i - 1 + n) % n], p1 = pts[i % n], p2 = pts[(i + 1) % n];
            const t = p1.clone().sub(p0).normalize().dot(p2.clone().sub(p1).normalize());
            maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, t))) * 180 / Math.PI);
          }
          chains.push({ ids: list, pts, closed, maxTurn });
        }
        return chains;
      }

      // Fillet a smoothly curving chain (a circular rim, a rounded outline) in
      // one go: sweep the rolling-ball profile along the chain as a single solid
      // and cut it away (convex edges) or add it (inside corners) with the
      // boolean engine. The straight-edge method faceted a curve into 96 separate
      // fillets with 96 corner patches; this gives one continuous round.
      function buildChainFilletSolid(chain, radius, chamfer) {
        const edges = filletState.edges;
        const { pts, closed, ids } = chain;
        const n = pts.length;
        if (n < 2) return null;
        // per-segment face data, with face 1 / face 2 kept on the same side
        const segs = [];
        for (let i = 0; i < (closed ? n : n - 1); i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          const e = edges[ids.find(j => (edges[j].a.distanceTo(a) < 0.011 && edges[j].b.distanceTo(b) < 0.011) || (edges[j].a.distanceTo(b) < 0.011 && edges[j].b.distanceTo(a) < 0.011))];
          const dirAB = b.clone().sub(a).normalize();
          if (!e || !e.c1 || !e.c2) {
            // a bridged seam gap: carry the neighbouring segment's faces across
            const pv = segs[segs.length - 1];
            if (!pv) return null;
            segs.push(Object.assign({}, pv, { dir: dirAB })); continue;
          }
          let s = { n1: e.n1.clone(), n2: e.n2.clone(), c1: e.c1, c2: e.c2 };
          const prev = segs[segs.length - 1];
          if (prev && s.n1.dot(prev.n1) + s.n2.dot(prev.n2) < s.n1.dot(prev.n2) + s.n2.dot(prev.n1)) {
            s = { n1: s.n1, n2: s.n2, c1: s.c1, c2: s.c2 };
            [s.n1, s.n2] = [s.n2, s.n1]; [s.c1, s.c2] = [s.c2, s.c1];
          }
          const dir = b.clone().sub(a).normalize();
          const inFace = (c) => { const v = c.clone().sub(a); v.addScaledVector(dir, -v.dot(dir)); return v.normalize(); };
          s.u1 = inFace(s.c1); s.u2 = inFace(s.c2); s.dir = dir;
          segs.push(s);
        }
        const convex = segs[0].u2.dot(segs[0].n1) < 0;
        const e = Math.max(0.25, radius * 0.35);
        const rings = [];
        for (let i = 0; i < n; i++) {
          const sa = segs[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
          const sb = segs[closed ? i % n : Math.min(segs.length - 1, i)];
          const t = sa.dir.clone().add(sb.dir).normalize();
          const n1 = sa.n1.clone().add(sb.n1).normalize(), n2 = sa.n2.clone().add(sb.n2).normalize();
          let d1 = new THREE.Vector3().crossVectors(n1, t).normalize(); if (d1.dot(sa.u1.clone().add(sb.u1)) < 0) d1.negate();
          let d2 = new THREE.Vector3().crossVectors(n2, t).normalize(); if (d2.dot(sa.u2.clone().add(sb.u2)) < 0) d2.negate();
          const theta = Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
          if (theta < 0.1 || theta > Math.PI - 0.05) return null;
          const P = pts[i];
          const set = radius / Math.tan(theta / 2);
          const T1 = P.clone().addScaledVector(d1, set), T2 = P.clone().addScaledVector(d2, set);
          const ring = [];
          if (convex) ring.push(T1.clone().addScaledVector(n1, e));
          ring.push(T1);
          if (!chamfer) {
            const C = P.clone().addScaledVector(d1.clone().add(d2).normalize(), radius / Math.sin(theta / 2));
            const v1 = T1.clone().sub(C), v2 = T2.clone().sub(C);
            const arc = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2) / (v1.length() * v2.length()))));
            const steps = 12;   // fixed, so every profile ring has the same point count
            const axis = new THREE.Vector3().crossVectors(v1, v2).normalize();
            for (let k = 1; k < steps; k++) ring.push(C.clone().add(v1.clone().applyAxisAngle(axis, arc * k / steps)));
          }
          ring.push(T2);
          if (convex) {
            ring.push(T2.clone().addScaledVector(n2, e));
            ring.push(P.clone().addScaledVector(n1.clone().add(n2).normalize(), e * 1.6));
          } else {
            ring.push(P.clone().addScaledVector(n1.clone().add(n2).normalize(), -e * 1.6));
          }
          rings.push(ring);
        }
        // open chains: run a hair past each end so the round doesn't stop short
        if (!closed) {
          const ext = (ring, dir) => ring.map(p => p.clone().addScaledVector(dir, e * 0.5));
          rings[0] = ext(rings[0], segs[0].dir.clone().negate());
          rings[n - 1] = ext(rings[n - 1], segs[segs.length - 1].dir);
        }
        const m = rings[0].length;
        const P = [];
        const tri = (a, b, c) => P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        const R = closed ? n : n - 1;
        for (let i = 0; i < R; i++) {
          const A = rings[i], B = rings[(i + 1) % n];
          for (let k = 0; k < m; k++) {
            const k2 = (k + 1) % m;
            tri(A[k], B[k], B[k2]); tri(A[k], B[k2], A[k2]);
          }
        }
        if (!closed) {   // cap both ends with a fan from the last (outer/inner) point
          const cap = (ring, flip) => { const o = ring[m - 1];
            for (let k = 0; k < m - 2; k++) flip ? tri(o, ring[k + 1], ring[k]) : tri(o, ring[k], ring[k + 1]); };
          cap(rings[0], false); cap(rings[n - 1], true);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        // make sure it's outward-facing (positive signed volume)
        let vol = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < P.length; i += 9) {
          a.set(P[i], P[i + 1], P[i + 2]); b.set(P[i + 3], P[i + 4], P[i + 5]); c.set(P[i + 6], P[i + 7], P[i + 8]);
          vol += a.dot(b.clone().cross(c)) / 6;
        }
        if (vol < 0) {
          const pa = g.attributes.position.array;
          for (let i = 0; i < pa.length; i += 9) for (let j = 0; j < 3; j++) { const t = pa[i + 3 + j]; pa[i + 3 + j] = pa[i + 6 + j]; pa[i + 6 + j] = t; }
        }
        g.computeVertexNormals();
        return { geo: g, convex };
      }

      function filletCurvedChains(mesh, chains, radius, chamfer) {
        const CSG = window.CSGEngine;
        let done = 0, failed = 0;
        chains.forEach(ch => {
          const sol = buildChainFilletSolid(ch, radius, chamfer);
          if (!sol) { failed++; return; }
          const cutter = new THREE.Mesh(sol.geo, new THREE.MeshStandardMaterial());
          cutter.updateMatrixWorld(true); mesh.updateMatrixWorld(true);
          try {
            const A = CSG.fromMesh(mesh), B = CSG.fromMesh(cutter);
            const res = sol.convex ? A.subtract(B) : A.union(B);
            const geo = CSG.toGeometry(res);
            if (!geo.attributes.position.count) { failed++; return; }
            const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            if (!(mat && mat.vertexColors)) geo.deleteAttribute('color');
            mesh.geometry.dispose();
            mesh.geometry = geo;
            mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.set(1, 1, 1);
            recenterMeshTransform(mesh);
            done++;
          } catch (err) { console.error(err); failed++; }
          sol.geo.dispose();
        });
        return { done, failed };
      }

      function filletPickedEdges(chamfer) {
        if (!filletState.mesh) return banner("⚠️ Select a solid and pick some edges first.");
        if (filletState.picked.size === 0) return banner("⚠️ Click at least one edge to pick it first.");
        const chamferMode = chamfer || window._chamferMode || false;
        const chains = filletPickedChains();
        const curved = chains.filter(c => c.pts.length >= 4 && c.maxTurn < 45);
        if (!curved.length) return filletStraightEdges(chamfer);
        const radius = chamferMode
          ? (parseFloat(document.getElementById('chamfer-size').value) || 2)
          : (parseFloat(document.getElementById('bld-fillet-rad').value) || 2);
        const mesh = filletState.mesh;
        // straight picks that aren't part of a curve are done afterwards with the
        // existing method, re-found on the new geometry by position
        const curvedIds = new Set(); curved.forEach(c => c.ids.forEach(i => curvedIds.add(i)));
        const straight = [...filletState.picked].filter(i => !curvedIds.has(i)).map(i => filletState.edges[i]);
        banner(`${chamferMode ? 'Chamfering' : 'Rounding'} ${curved.length} curved edge${curved.length > 1 ? 's' : ''}…`);
        setTimeout(() => {
          const undoGeo = mesh.geometry.clone();
          const undoXf = [mesh.position.clone(), mesh.rotation.clone(), mesh.scale.clone()];
          const r = filletCurvedChains(mesh, curved, radius, chamferMode);
          if (!r.done) {
            mesh.geometry.dispose(); mesh.geometry = undoGeo;
            mesh.position.copy(undoXf[0]); mesh.rotation.copy(undoXf[1]); mesh.scale.copy(undoXf[2]);
            banner(`⚠️ Couldn't round that curve at ${radius} mm — try a smaller radius.`);
            beginFilletEdgePicking(); return;
          }
          undoGeo.dispose();
          if (straight.length) {
            beginFilletEdgePicking();
            filletState.edges.forEach((e, i) => {
              if (straight.some(s => (s.a.distanceTo(e.a) < 0.05 && s.b.distanceTo(e.b) < 0.05) || (s.a.distanceTo(e.b) < 0.05 && s.b.distanceTo(e.a) < 0.05))) filletState.picked.add(i);
            });
            if (filletState.picked.size) { filletStraightEdges(chamfer); return; }
          }
          saveHistory(); updateFloatingHUD(); updateStatus();
          banner(`${chamferMode ? 'Chamfered' : 'Rounded'} ${r.done} curved edge${r.done > 1 ? 's' : ''} at ${radius} mm${r.failed ? ` (${r.failed} skipped)` : ''}.`);
          beginFilletEdgePicking();
        }, 30);
      }

      function filletStraightEdges(chamfer) {
        if (!filletState.mesh) return banner("⚠️ Select a solid and pick some edges first.");
        if (filletState.picked.size === 0) return banner("⚠️ Click at least one edge to pick it first.");
        // Chamfer and fillet share this routine; `chamfer` (or the legacy global)
        // switches the edge profile from a round to a flat bevel. Captured here so
        // the deferred work below uses the right mode regardless of timing.
        const chamferMode = chamfer || window._chamferMode || false;
        const radius = chamferMode
          ? (parseFloat(document.getElementById('chamfer-size').value) || 2)
          : (parseFloat(document.getElementById('bld-fillet-rad').value) || 2);
        const mesh = filletState.mesh;
        banner(chamferMode ? "Chamfering picked edges…" : "Filleting picked edges…");

        setTimeout(() => {
          // Re-assert the mode inside the deferred work so filletOneEdge reads it
          // correctly (a plain global could have been reset by now).
          window._chamferMode = chamferMode;
          try {
            mesh.updateMatrixWorld(true);
            // A fillet/chamfer only removes material, so the object must not grow.
            // Capture the size first; if the rebuilt mesh is bigger, the arc was
            // built on the wrong side (a known failure on awkward edges) and we roll
            // back to the saved geometry instead of leaving a ballooned solid.
            const _preBox = new THREE.Box3().setFromObject(mesh);
            const _preSize = _preBox.getSize(new THREE.Vector3());
            const _preGeom = mesh.geometry.clone();
            const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
            const pos = g.attributes.position;
            const m = mesh.matrixWorld;

            // Gather all triangles in WORLD space.
            let tris = [];
            for (let i = 0; i < pos.count; i += 3) {
              tris.push([
                V3().fromBufferAttribute(pos, i).applyMatrix4(m),
                V3().fromBufferAttribute(pos, i+1).applyMatrix4(m),
                V3().fromBufferAttribute(pos, i+2).applyMatrix4(m)
              ]);
            }

            let warned = false, done = 0;
            const pickedEdges = [...filletState.picked].map(idx => filletState.edges[idx]);

            // Find corners shared by 2+ picked edges — these get a smooth spherical
            // blend instead of flat end caps.
            const endpoints = [];
            pickedEdges.forEach(e => { endpoints.push(e.a.clone(), e.b.clone()); });
            const sharedCorners = [];
            endpoints.forEach(p => {
              const count = endpoints.filter(q => q.distanceTo(p) < 1e-3).length;
              if (count >= 2 && !sharedCorners.some(c => c.distanceTo(p) < 1e-3)) sharedCorners.push(p);
            });

            const allOpenEnds = [];
            pickedEdges.forEach(edge => {
              const res = filletOneEdge(tris, edge, radius, sharedCorners);
              if (res.ok) { tris = res.tris; done++; if (res.openEnds) allOpenEnds.push(...res.openEnds); }
              else if (!warned) { warned = true; banner("⚠️ " + res.reason + " — did a best-effort round on tricky edges."); }
              if (!res.ok && res.tris) tris = res.tris; // best effort
            });

            // Blend each shared corner with a spherical patch that seams the open arc
            // ends together, so the corner reads as one continuous rounded radius.
            sharedCorners.forEach(corner => {
              const ends = allOpenEnds.filter(e => e.corner.distanceTo(corner) < 1e-3);
              if (ends.length >= 2) buildCornerSphere(tris, corner, ends, radius);
            });

            // Rebuild geometry from world tris, recenter into the mesh.
            let arr = new Float32Array(tris.length * 9);
            tris.forEach((t, i) => { for (let j = 0; j < 3; j++) { arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
            // Stitch the seams where the new round meets the old faces (same
            // T-junction repair the booleans use) so the result stays watertight.
            try {
              let P = Array.from(arr), C = new Array(P.length).fill(1), U = new Array(P.length / 3 * 2).fill(0);
              for (let pass = 0; pass < 3; pass++) { const r = window.CSGEngine._fixTJunctions(P, C, U); P = r.P; C = r.C; U = r.U; if (!r.fixed) break; }
              arr = new Float32Array(P);
            } catch (e) { console.warn('fillet seam repair skipped', e); }
            const ng = new THREE.BufferGeometry();
            ng.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            // Filleting regenerates the topology, so the old per-vertex paint can't
            // be carried across. If the material was set up for vertex colours (the
            // mesh had been painted), a colourless geometry would make three.js read
            // every colour as black. Attach a solid-white colour buffer so the mesh
            // keeps its base material colour instead of turning black.
            const fMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            if (fMat && fMat.vertexColors) {
              ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(arr.length).fill(1), 3));
            }
            ng.computeVertexNormals();
            mesh.geometry.dispose();
            mesh.geometry = ng;
            mesh.updateMatrixWorld(true);
            // Safety check: did the fillet expand the object? Allow a tiny tolerance
            // for arc bulge, but a real growth means the operation went wrong.
            const _postSize = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
            const grew = _postSize.x > _preSize.x + radius * 0.5 + 0.5 ||
                         _postSize.y > _preSize.y + radius * 0.5 + 0.5 ||
                         _postSize.z > _preSize.z + radius * 0.5 + 0.5;
            if (grew) {
              mesh.geometry.dispose();
              mesh.geometry = _preGeom;   // roll back to the pre-fillet geometry
              mesh.updateMatrixWorld(true);
              clearFilletHighlights();
              filletState.picked = new Set(); filletState.hovered = -1;
              updateFilletCount();
              banner("⚠️ That fillet would have expanded the part — rolled back. Try a smaller radius or a different edge.");
              beginFilletEdgePicking();
              return;
            }
            _preGeom.dispose();
            // Render both sides so a mis-wound arc triangle can never show as a black
            // hole. (Solids for printing are exported watertight regardless.)
            if (mesh.material && !Array.isArray(mesh.material)) mesh.material.side = THREE.DoubleSide;
            recenterMeshTransform(mesh);

            clearFilletHighlights();
            filletState.edges = []; filletState.picked = new Set(); filletState.hovered = -1;
            updateFilletCount();
            saveHistory(); updateFloatingHUD();
            if (!warned) banner(`${chamferMode ? 'Chamfered' : 'Filleted'} ${done} edge${done>1?'s':''} at ${radius} mm.`);
            // re-detect edges on the new geometry so more can be picked
            beginFilletEdgePicking();
          } catch (err) {
            console.error(err); banner(`⚠️ ${chamferMode ? 'Chamfer' : 'Fillet'} failed on this mesh — try a smaller ${chamferMode ? 'bevel' : 'radius'}.`);
          } finally {
            window._chamferMode = false;   // always clear so the next op defaults to fillet
          }
        }, 30);
      }


      // Blend the open arc ends that meet at a shared corner into a smooth spherical
      // corner. Each arc that stops short at the corner leaves an open ring (a half-
      // circle of vertices). Those rings all lie on a common sphere of `radius`
      // centred just inside the corner; we find that centre, then fill the spherical
      // patch between the open ends with a fan of small triangles on the sphere.
      function buildCornerSphere(tris, corner, ends, radius) {
        // Sphere centre: average of the arc-end centres (each already sits at the
        // right inset distance), then refined to be equidistant from the boundary.
        let centre = new THREE.Vector3();
        ends.forEach(e => centre.add(e.centre));
        centre.multiplyScalar(1 / ends.length);

        // Gather the open ring boundary vertices, deduped.
        const boundary = [];
        ends.forEach(e => {
          e.ring.forEach(v => {
            if (!boundary.some(b => b.distanceTo(v) < 1e-4)) boundary.push(v.clone());
          });
        });
        if (boundary.length < 3) return;

        // Refine the centre so every boundary vertex is ~radius away.
        for (let iter = 0; iter < 8; iter++) {
          const target = new THREE.Vector3();
          boundary.forEach(v => {
            const dir = v.clone().sub(centre).normalize();
            target.add(v.clone().sub(dir.multiplyScalar(radius)));
          });
          target.multiplyScalar(1 / boundary.length);
          centre.copy(target);
        }

        // Corner apex on the sphere, along centre → original corner vertex.
        const apexDir = corner.clone().sub(centre).normalize();
        const apex = centre.clone().add(apexDir.clone().multiplyScalar(radius));

        // Order boundary vertices by angle around the apex axis so we can fan them.
        let uAxis = Math.abs(apexDir.x) < 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
        uAxis = uAxis.sub(apexDir.clone().multiplyScalar(uAxis.dot(apexDir))).normalize();
        const wAxis = new THREE.Vector3().crossVectors(apexDir, uAxis).normalize();
        const ordered = boundary.slice().sort((p, q) => {
          const ap = Math.atan2(p.clone().sub(centre).dot(wAxis), p.clone().sub(centre).dot(uAxis));
          const aq = Math.atan2(q.clone().sub(centre).dot(wAxis), q.clone().sub(centre).dot(uAxis));
          return ap - aq;
        });

        const onSphere = (p) => centre.clone().add(p.clone().sub(centre).normalize().multiplyScalar(radius));
        const pushOut = (a, b, c) => {
          const nrm = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
          const centroid = a.clone().add(b).add(c).multiplyScalar(1/3);
          if (nrm.dot(centroid.clone().sub(centre)) < 0) tris.push([a.clone(), c.clone(), b.clone()]);
          else tris.push([a.clone(), b.clone(), c.clone()]);
        };
        for (let i = 0; i < ordered.length; i++) {
          const b0 = ordered[i], b1 = ordered[(i + 1) % ordered.length];
          const mid = onSphere(b0.clone().add(b1).multiplyScalar(0.5));
          pushOut(apex, b0, mid);
          pushOut(mid, b0, b1);
          pushOut(apex, mid, b1);
        }
      }

      // Fillet a single straight edge shared by two flat faces. Returns
      // {ok, tris, reason}. Uses an exact triangle/plane clip (not vertex nudging)
      // so tessellated faces never leave stray triangles poking through the arc.
      function filletOneEdge(tris, edge, radius, cornerPoints) {
        const A = edge.a, B = edge.b;
        const edgeLen = A.distanceTo(B);
        if (edgeLen < 1e-4) return { ok: false, tris, reason: "Edge too short" };
        const edgeDir = B.clone().sub(A).normalize();
        const n1 = edge.n1.clone(), n2 = edge.n2.clone();

        // Interior dihedral between the two faces.
        const dotN = Math.max(-1, Math.min(1, n1.dot(n2)));
        const dihedral = Math.acos(dotN);
        const halfOpen = (Math.PI - dihedral) / 2;
        if (halfOpen < 0.05 || halfOpen > Math.PI/2 - 0.01) return { ok: false, tris, reason: "Edge angle can't take a clean fillet" };

        const setback = radius / Math.tan(halfOpen);
        // Coplanarity tolerance for deciding a triangle truly belongs to face 1/2
        // (as opposed to some other face that merely shares the same normal, e.g.
        // a parallel face elsewhere on the model).
        const planeEps = Math.max(1e-3, edgeLen * 1e-4);

        const triNormal = (t) => V3().crossVectors(t[1].clone().sub(t[0]), t[2].clone().sub(t[0])).normalize();

        // Inset direction for each face: in the face plane, perpendicular to the edge,
        // pointing away from the other face (into solid material).
        const insetDir = (faceN, otherN) => {
          let d = V3().crossVectors(faceN, edgeDir).normalize();
          if (d.dot(otherN) > 0) d.multiplyScalar(-1);
          return d;
        };
        const d1 = insetDir(n1, n2), d2 = insetDir(n2, n1);
        const bis = d1.clone().add(d2).normalize();
        const centreDist = radius / Math.sin(halfOpen);

        // Classify a triangle as belonging to face 1 or face 2: its normal must
        // align with the face normal AND every vertex must lie in that face's
        // plane (the plane through the edge with that normal). This is stricter
        // than a normal-only test, so an unrelated parallel face elsewhere on the
        // model is never mistaken for the face touching this edge.
        const faceOf = (t) => {
          const tN = triNormal(t);
          const a1 = Math.abs(tN.dot(n1)), a2 = Math.abs(tN.dot(n2));
          const onPlane1 = t.every(v => Math.abs(v.clone().sub(A).dot(n1)) < planeEps);
          const onPlane2 = t.every(v => Math.abs(v.clone().sub(A).dot(n2)) < planeEps);
          if (a1 > 0.9 && a1 >= a2 && onPlane1) return 1;
          if (a2 > 0.9 && onPlane2) return 2;
          return 0;
        };

        // Clip a triangle against the half-space (p - planePoint)·planeNormal >= 0,
        // keeping only the part on the "kept" side. Returns 0, 1, or 2 triangles —
        // an exact geometric cut, so no tessellated triangle can ever straddle the
        // setback boundary and poke through the arc.
        const clipTriangle = (t, planePoint, planeNormal) => {
          const d = t.map(v => v.clone().sub(planePoint).dot(planeNormal));
          const eps = 1e-7;
          const poly = [];
          for (let i = 0; i < 3; i++) {
            const j = (i + 1) % 3;
            const di = d[i], dj = d[j];
            if (di >= -eps) poly.push(t[i]);
            if ((di > eps && dj < -eps) || (di < -eps && dj > eps)) {
              const s = di / (di - dj);
              poly.push(t[i].clone().lerp(t[j], s));
            }
          }
          if (poly.length < 3) return [];
          if (poly.length === 3) return [[poly[0], poly[1], poly[2]]];
          const tris2 = [];
          for (let k = 1; k < poly.length - 1; k++) tris2.push([poly[0], poly[k], poly[k+1]]);
          return tris2;
        };

        // Distance from a point to the (infinite) edge line.
        const distToEdgeLine = (p) => {
          const along = p.clone().sub(A).dot(edgeDir);
          const foot = A.clone().add(edgeDir.clone().multiplyScalar(along));
          return p.clone().sub(foot).length();
        };
        // Perpendicular (in-face) distance from the edge, measured along the inset
        // direction for the given face. This is what the clip is really about.
        const perpFromEdge = (p, dir) => p.clone().sub(A).dot(dir);

        const out = [];
        let movedCount = 0;
        tris.forEach(t => {
          const f = faceOf(t);
          if (f === 0) { out.push(t); return; }
          const dir = f === 1 ? d1 : d2;
          const planePoint = A.clone().add(dir.clone().multiplyScalar(setback));
          const clipped = clipTriangle(t, planePoint, dir);
          if (!clipped.length) { movedCount++; return; } // whole tri inside band → dropped
          // Guard against clip artifacts: keep a clipped piece only if it truly sits
          // outside the setback band (its closest vertex is at/behind the tangent
          // line). Any sliver that still intrudes toward the edge is dropped so it
          // can never poke through the arc.
          clipped.forEach(ct => {
            const minPerp = Math.min(...ct.map(v => perpFromEdge(v, dir)));
            if (minPerp >= setback - 1e-3) out.push(ct);
          });
          movedCount++;
        });

        if (movedCount === 0) return { ok: false, tris: out, reason: "Couldn't find the edge's two faces" };

        // The clipped faces leave a boundary of vertices sitting on each tangent
        // line — at every tessellation step along the edge, not just the two ends.
        // If the arc only spanned end-to-end, its straight quad edges would miss
        // those intermediate points and leave cracks. So we collect every distinct
        // "along-edge" position that appears on either tangent line and build an arc
        // ring at each, so the rounded strip seams exactly to the cut faces.
        const t1AtEnd = A.clone().add(d1.clone().multiplyScalar(setback));   // tangent line 1 passes here
        const t2AtEnd = A.clone().add(d2.clone().multiplyScalar(setback));
        const onTangent1 = (p) => Math.abs(p.clone().sub(t1AtEnd).dot(d1)) < 1e-3 && Math.abs(p.clone().sub(A).dot(n1)) < planeEps;
        const onTangent2 = (p) => Math.abs(p.clone().sub(t2AtEnd).dot(d2)) < 1e-3 && Math.abs(p.clone().sub(A).dot(n2)) < planeEps;

        const alongSet = new Set([0, edgeLen]);
        out.forEach(t => t.forEach(v => {
          if (onTangent1(v) || onTangent2(v)) {
            let a = v.clone().sub(A).dot(edgeDir);
            a = Math.max(0, Math.min(edgeLen, a));
            alongSet.add(Math.round(a * 1000) / 1000);
          }
        }));

        // If an endpoint is a shared corner (where other filleted edges meet), pull
        // the arc back by `radius` there and leave that end open — a spherical corner
        // patch built afterwards will blend the meeting arcs into a smooth ball.
        const corners = cornerPoints || [];
        const aIsCorner = corners.some(c => c.distanceTo(A) < 1e-3);
        const bIsCorner = corners.some(c => c.distanceTo(B) < 1e-3);
        const startAlong = aIsCorner ? Math.min(radius, edgeLen * 0.49) : 0;
        const endAlong   = bIsCorner ? edgeLen - Math.min(radius, edgeLen * 0.49) : edgeLen;
        // keep only the along-values inside the trimmed span, plus the two trimmed ends
        let alongs = [...alongSet].filter(a => a > startAlong + 1e-4 && a < endAlong - 1e-4);
        alongs.unshift(startAlong); alongs.push(endAlong);
        alongs = [...new Set(alongs.map(a => Math.round(a * 1000) / 1000))].sort((x, y) => x - y);

        // In chamfer mode we collapse the arc to a single straight segment, giving
        // a flat 45° bevel instead of a rounded fillet.
        const arcSteps = window._chamferMode ? 1 : Math.max(6, Math.ceil(radius * 3));
        const ringAt = (along) => {
          const pEdge = A.clone().add(edgeDir.clone().multiplyScalar(along));
          const centre = pEdge.clone().add(bis.clone().multiplyScalar(centreDist));
          const t1 = pEdge.clone().add(d1.clone().multiplyScalar(setback));
          const v1 = t1.clone().sub(centre).normalize();
          const t2 = pEdge.clone().add(d2.clone().multiplyScalar(setback));
          const v2 = t2.clone().sub(centre).normalize();
          let ang = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
          let axis = V3().crossVectors(v1, v2).normalize();
          const ring = [];
          for (let s = 0; s <= arcSteps; s++) {
            const q = new THREE.Quaternion().setFromAxisAngle(axis, ang * (s/arcSteps));
            ring.push(centre.clone().add(v1.clone().applyQuaternion(q).multiplyScalar(radius)));
          }
          return { ring, centre };
        };

        const rings = alongs.map(a => ringAt(a));
        const arcCentreMid = rings[0].centre.clone().add(rings[rings.length-1].centre).multiplyScalar(0.5);

        // Emit each arc quad as two triangles, forcing OUTWARD winding.
        const pushOutward = (p, q, r) => {
          const nrm = V3().crossVectors(q.clone().sub(p), r.clone().sub(p));
          const centroid = p.clone().add(q).add(r).multiplyScalar(1/3);
          const outDir = centroid.clone().sub(arcCentreMid);
          if (nrm.dot(outDir) < 0) out.push([p.clone(), r.clone(), q.clone()]);
          else out.push([p.clone(), q.clone(), r.clone()]);
        };
        for (let k = 0; k < rings.length - 1; k++) {
          const r0 = rings[k].ring, r1 = rings[k+1].ring;
          for (let s = 0; s < r0.length - 1; s++) {
            pushOutward(r0[s], r1[s], r1[s+1]);
            pushOutward(r0[s], r1[s+1], r0[s+1]);
          }
        }

        // Cap the two ends of the arc with a flat fan — but only at a FREE end (not a
        // shared corner). A shared-corner end is left open so the spherical corner
        // patch can seam onto it, giving a smooth rounded corner instead of a flat tab.
        const capEnd = (ringData, endNormal) => {
          const ring = ringData.ring, centre = ringData.centre;
          for (let s = 0; s < ring.length - 1; s++) {
            const p = centre, q = ring[s], r = ring[s+1];
            const nrm = V3().crossVectors(q.clone().sub(p), r.clone().sub(p));
            if (nrm.dot(endNormal) < 0) out.push([p.clone(), r.clone(), q.clone()]);
            else out.push([p.clone(), q.clone(), r.clone()]);
          }
        };
        if (!aIsCorner) capEnd(rings[0], edgeDir.clone().multiplyScalar(-1));
        if (!bIsCorner) capEnd(rings[rings.length-1], edgeDir.clone());

        // Report open corner ends so the caller can blend them with a sphere patch.
        const openEnds = [];
        if (aIsCorner) openEnds.push({ corner: A.clone(), ring: rings[0].ring, centre: rings[0].centre });
        if (bIsCorner) openEnds.push({ corner: B.clone(), ring: rings[rings.length-1].ring, centre: rings[rings.length-1].centre });

        return { ok: true, tris: out, reason: "", openEnds };
      }


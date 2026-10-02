      // ═══════════════════════════════════════════════════════════════════════════
      //   SLICE / CUT TOOL
      // ═══════════════════════════════════════════════════════════════════════════
      function computeSliceNormal() {
        // The engine itself is Z-up now, so this is a direct mapping — no
        // remapping between "user axes" and "engine axes" needed any more:
        //   Tilt X (front↔back)     → rotate about X
        //   Tilt Y (left↔right)     → rotate about Y
        //   Spin Z (about vertical) → rotate about Z
        // Starting flat (all sliders at 0) gives a horizontal cut, i.e. the
        // plane's rest orientation is exactly the up/down (Z) plane.
        // If the plane has been rotated by hand with the gizmo, that wins — the
        // sliders can't express every orientation, and silently snapping back to
        // them would undo the drag. Touching any tilt slider clears this and hands
        // control back to the sliders.
        if (sliceState.customNormal) return sliceState.customNormal.clone().normalize();
        const base = new THREE.Vector3(0, 0, 1);
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(sliceState.rotX),
          THREE.MathUtils.degToRad(sliceState.rotY),
          THREE.MathUtils.degToRad(sliceState.rotZ),
          'XYZ'
        );
        return base.applyEuler(euler).normalize();
      }

      function computeSlicePoint() {
        const normal = computeSliceNormal();
        const c = new THREE.Vector3();
        if (selected.length > 0 && !selected[0].userData.isSketch) selected[0].getWorldPosition(c);
        return { point: c.addScaledVector(normal, sliceState.offset), normal };
      }

      function updateSlicePlaneHelper() {
        if (selected.length === 0 || selected[0].userData.isSketch) { sliceState.planeHelper.visible = false; return; }
        const { point, normal } = computeSlicePoint();
        const box = new THREE.Box3().setFromObject(selected[0]);
        const size = box.getSize(new THREE.Vector3()).length() * 0.8 || 60;
        // While the user is dragging the plane, don't fight them by snapping it back
        // to the object — instead read the drag back into the offset so the slider
        // stays in step and the cut happens exactly where the plane was left.
        if (sliceState.dragging) {
          // Rotating: the plane's own +Z is the cut normal, so read it straight off
          // the helper. This is what makes the rotate gizmo actually steer the cut
          // rather than just spinning the visual.
          if (transformControl.getMode && transformControl.getMode() === 'rotate') {
            const n = new THREE.Vector3(0, 0, 1).applyQuaternion(sliceState.planeHelper.quaternion).normalize();
            if (n.lengthSq() > 0.5) sliceState.customNormal = n;
          } else {
            // Moving: project the shift onto the normal to get the offset.
            const centre = new THREE.Vector3();
            selected[0].getWorldPosition(centre);
            const along = sliceState.planeHelper.position.clone().sub(centre).dot(normal);
            sliceState.offset = along;
            const off = document.getElementById('slice-off');
            if (off) {
              const lo = parseFloat(off.min), hi = parseFloat(off.max);
              off.value = Math.max(lo, Math.min(hi, along));
              const lbl = document.getElementById('slice-off-val');
              if (lbl) lbl.textContent = (Math.round(along * 10) / 10) + ' mm';
            }
          }
          // Keep the size right but leave position/orientation as dragged.
          sliceState.planeHelper.scale.set(size, size, 1);
          sliceState.planeHelper.visible = true;
          return;
        }
        sliceState.planeHelper.position.copy(point);
        sliceState.planeHelper.scale.set(size, size, 1);
        sliceState.planeHelper.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
        sliceState.planeHelper.visible = true;
      }

      function armSlice() {
        const btn = document.getElementById('bld-slice-arm');
        if (selected.length === 0 || selected[0].userData.isSketch) return banner("⚠️ Select a solid mesh, then arm the slice plane.");
        sliceState.armed = !sliceState.armed;
        btn.classList.toggle('active', sliceState.armed);
        if (!sliceState.armed) {
          sliceState.planeHelper.visible = false;
          // Hand the gizmo back to the object.
          attachGizmoToSelection();
        }
        else {
          // Size the offset slider to the actual object so large parts can be sliced
          // anywhere across their span — the old fixed ±100 mm couldn't reach the far
          // side of anything bigger than 200 mm.
          const box = new THREE.Box3();
          selected.forEach(o => { if (!o.userData.isSketch) box.expandByObject(o); });
          if (!box.isEmpty()) {
            const size = box.getSize(new THREE.Vector3());
            const reach = Math.ceil(Math.max(size.x, size.y, size.z) * 0.6 + 10);
            const off = document.getElementById('slice-off');
            off.min = -reach; off.max = reach;
            off.step = reach > 400 ? 1 : 0.5;
          }
        }
        if (sliceState.armed) {
          // Put the move gizmo on the plane itself so the cut can be positioned by
          // dragging it, not just with the offset slider. Dragging reads back into
          // the offset, so the slider and the handle always agree.
          sliceState.customNormal = null;      // start from the slider orientation
          updateSlicePlaneHelper();
          transformControl.setSpace('world');
          if (transformControl.setMode) transformControl.setMode('translate');
          moveGizmoTarget = null;              // drive the plane directly
          transformControl.attach(sliceState.planeHelper);
        }
        banner(sliceState.armed
          ? "Slice plane armed — drag to move it, or switch the gizmo to Rotate to angle the cut. Then Perform Slice."
          : "Slice disarmed.");
      }

      // Split one triangle by a plane; append resulting tris to pos/neg arrays and
      // record the cut edge so we can cap the exposed cross-section afterwards.
      // Slice vertices carry both a position and a colour so paint survives the cut.
      // Each vertex is {p: Vector3, c: Vector3|null}. At a cut point we lerp both.
      function clipTri(a, b, c, normal, planePoint, posT, negT, cutSeg) {
        const E = 1e-4;   // tolerance: vertices within this of the plane count as "on it"
        const verts = [a, b, c];
        const ds = verts.map(v => normal.dot(v.p.clone().sub(planePoint)));
        // sign per vertex: +1 above, -1 below, 0 on the plane
        const sgn = ds.map(d => d > E ? 1 : (d < -E ? -1 : 0));

        // Entirely on one side (treating on-plane as compatible with either side).
        if (sgn.every(s => s >= 0)) { posT.push([a,b,c]); 
          // if it also lies flat ON the plane, it contributes to neither cap edge
          if (!(sgn.every(s => s === 0))) maybeEdge(verts, sgn, cutSeg);
          return;
        }
        if (sgn.every(s => s <= 0)) { negT.push([a,b,c]);
          if (!(sgn.every(s => s === 0))) maybeEdge(verts, sgn, cutSeg);
          return;
        }

        // Genuinely straddles: split along the two crossing points.
        const posP = [], negP = [], cross = [];
        const lerpV = (u, w, t) => ({
          p: u.p.clone().lerp(w.p, t),
          c: (u.c && w.c) ? u.c.clone().lerp(w.c, t) : (u.c || w.c || null)
        });
        for (let i=0;i<3;i++){
          const cur=verts[i], cd=ds[i], nx=verts[(i+1)%3], nd=ds[(i+1)%3];
          const cs = sgn[i], nsg = sgn[(i+1)%3];
          if (cs >= 0) posP.push(cur);
          if (cs <= 0) negP.push(cur);
          if (cs === 0) cross.push(cur);                 // a vertex sitting on the plane is a boundary point
          else if ((cs > 0 && nsg < 0) || (cs < 0 && nsg > 0)) {
            const t = cd/(cd-nd);
            const ip = lerpV(cur, nx, t);
            posP.push(ip); negP.push(ip); cross.push(ip);
          }
        }
        for (let i=1;i<posP.length-1;i++) posT.push([posP[0], posP[i], posP[i+1]]);
        for (let i=1;i<negP.length-1;i++) negT.push([negP[0], negP[i], negP[i+1]]);
        if (cross.length >= 2) cutSeg.push([cross[0], cross[1]]);
      }

      // If exactly two of a triangle's vertices lie ON the plane, that shared edge is
      // part of the cut boundary — emit it so the cap loop closes even when the plane
      // grazes existing mesh edges (common on tessellated spheres at the equator).
      function maybeEdge(verts, sgn, cutSeg) {
        const on = [];
        for (let i=0;i<3;i++) if (sgn[i] === 0) on.push(verts[i]);
        if (on.length === 2) cutSeg.push([on[0], on[1]]);
      }

      function buildLoopsFromSegments(segs) {
        // Weld endpoints first. Cut points computed from two different triangles can
        // differ by a few nanometres, and a tight exact-ish match would then fail to
        // join them — the loop walk would stop early and the cap would be triangulated
        // from a partial boundary, leaving the gaps seen on sliced faces.
        const weld = makeWelder(1e-3);
        const S = [];
        const seen = new Set();
        segs.forEach(s => {
          const a = { p: weld(s[0].p), c: s[0].c };
          const b = { p: weld(s[1].p), c: s[1].c };
          if (a.p === b.p) return;                     // degenerate: plane grazed a vertex
          // Drop duplicate boundary edges. A triangle sitting on the plane can have
          // its shared edge reported from both the positive and negative side, and a
          // repeated segment derails the walk — it gets consumed as a "next" step that
          // leads nowhere, closing the loop early and leaving a hole in the cap.
          const ka = keyOfPoint(a.p), kb = keyOfPoint(b.p);
          const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          if (seen.has(key)) return;
          seen.add(key);
          S.push({ a, b, used: false });
        });
        const loops = [];
        // Index segments by welded endpoint so the walk is a lookup, not a linear scan.
        const at = new Map();
        const put = (pt, i) => { if (!at.has(pt)) at.set(pt, []); at.get(pt).push(i); };
        S.forEach((s, i) => { put(s.a.p, i); put(s.b.p, i); });
        const nextFrom = (pt) => {
          const list = at.get(pt) || [];
          for (const i of list) {
            if (S[i].used) continue;
            return { i, end: (S[i].a.p === pt) ? 'a' : 'b' };
          }
          return null;
        };
        for (let i = 0; i < S.length; i++) {
          if (S[i].used) continue;
          S[i].used = true;
          const loop = [S[i].a, S[i].b];
          let end = S[i].b.p;
          let guard = 0;
          while (guard++ < S.length + 2) {
            const m = nextFrom(end);
            if (!m) break;
            S[m.i].used = true;
            const nx = m.end === 'a' ? S[m.i].b : S[m.i].a;
            if (nx.p === loop[0].p) break;             // closed
            loop.push(nx);
            end = nx.p;
          }
          if (loop.length >= 3) loops.push(loop);
        }
        return loops;
      }

      function addSliceCaps(cutSeg, normal, planePoint, posT, negT, capColor) {
        if (cutSeg.length === 0) return;
        const loops = buildLoopsFromSegments(cutSeg);
        let u = new THREE.Vector3(Math.abs(normal.x)>0.9?0:1, Math.abs(normal.x)>0.9?1:0, 0);
        u.sub(normal.clone().multiplyScalar(u.dot(normal))).normalize();
        const v = new THREE.Vector3().crossVectors(normal, u).normalize();
        loops.forEach(loop => {
          // Drop consecutive duplicate points — triangulateShape silently loses
          // triangles when a loop contains repeats, which shows up as a gap.
          const clean = [];
          loop.forEach(pt => {
            const prev = clean[clean.length - 1];
            if (!prev || prev.p.distanceToSquared(pt.p) > 1e-12) clean.push(pt);
          });
          while (clean.length > 1 && clean[0].p.distanceToSquared(clean[clean.length-1].p) <= 1e-12) clean.pop();
          if (clean.length < 3) return;
          let pts2d = clean.map(pt => { const rel=pt.p.clone().sub(planePoint); return new THREE.Vector2(rel.dot(u), rel.dot(v)); });
          // triangulateShape expects a consistent winding; feed it CCW and remember
          // if we had to flip so the loop and the 2D points stay in step.
          let ring = clean;
          if (THREE.ShapeUtils.area(pts2d) < 0) { pts2d = pts2d.slice().reverse(); ring = clean.slice().reverse(); }
          let idx; try { idx = THREE.ShapeUtils.triangulateShape(pts2d, []); } catch(e){ return; }
          // If triangulation collapsed (fewer tris than an n-gon needs), fall back to
          // a fan around the centroid so the face is still solid rather than holed.
          if (!idx || idx.length < ring.length - 2) {
            const cen = { p: new THREE.Vector3(), c: capColor ? capColor.clone() : null };
            ring.forEach(pt => cen.p.add(pt.p));
            cen.p.multiplyScalar(1 / ring.length);
            idx = null;
            for (let i = 0; i < ring.length; i++) {
              const a = { p: cen.p.clone(), c: cen.c ? cen.c.clone() : null };
              const b = ring[i], c = ring[(i + 1) % ring.length];
              const mk = (pt) => ({ p: pt.p.clone(), c: capColor ? capColor.clone() : (pt.c ? pt.c.clone() : null) });
              const A = mk(a), B = mk(b), C = mk(c);
              const tn = new THREE.Vector3().crossVectors(B.p.clone().sub(A.p), C.p.clone().sub(A.p)).normalize();
              if (tn.dot(normal) > 0) { posT.push([A,C,B]); negT.push([A,B,C]); }
              else { posT.push([A,B,C]); negT.push([A,C,B]); }
            }
            return;
          }
          idx.forEach(t => {
            // cap vertices get the object's cap colour (its base paint) if present
            const mk = (pt) => ({ p: pt.p.clone(), c: capColor ? capColor.clone() : (pt.c ? pt.c.clone() : null) });
            const a=mk(ring[t[0]]), b=mk(ring[t[1]]), c=mk(ring[t[2]]);
            const tn = new THREE.Vector3().crossVectors(b.p.clone().sub(a.p), c.p.clone().sub(a.p)).normalize();
            if (tn.dot(normal) > 0) { posT.push([a,c,b]); negT.push([a,b,c]); }
            else { posT.push([a,b,c]); negT.push([a,c,b]); }
          });
        });
      }

      function trisToWorldMesh(tris, material) {
        const arr = new Float32Array(tris.length*9);
        const anyColor = tris.some(t => t.some(v => v.c));
        const cols = anyColor ? new Float32Array(tris.length*9) : null;
        tris.forEach((t,i)=>{ t.forEach((v,j)=>{
          arr[i*9+j*3]=v.p.x; arr[i*9+j*3+1]=v.p.y; arr[i*9+j*3+2]=v.p.z;
          if (cols) { const c=v.c; cols[i*9+j*3]=c?c.x:1; cols[i*9+j*3+1]=c?c.y:1; cols[i*9+j*3+2]=c?c.z:1; }
        }); });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr,3));
        // Carry paint through the cut: if any vertex had a colour, attach a colour
        // buffer (interpolated across cut edges) so the pieces keep their paint.
        if (cols) g.setAttribute('color', new THREE.BufferAttribute(cols,3));
        else if (material.vertexColors) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(arr.length).fill(1), 3));
        g.computeVertexNormals();
        // Render both sides so a freshly cut face is never a dark back-face, even at
        // grazing angles or if a boundary triangle ends up wound the other way.
        material.side = THREE.DoubleSide;
        const m = new THREE.Mesh(g, material);
        recenterMeshTransform(m);
        m.castShadow = true; m.receiveShadow = true;
        return m;
      }


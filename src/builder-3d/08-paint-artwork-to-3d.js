      // ═══════════════════════════════════════════════════════════════════════
      //   PAINT — recolour a whole object, or flood a single coplanar face region.
      //   Uses per-vertex colours so one mesh can hold many colours (a box can have
      //   six differently coloured faces) without splitting into multiple materials.
      // ═══════════════════════════════════════════════════════════════════════

      // Make a mesh ready for vertex-colour painting: switch to a non-indexed
      // geometry with a colour attribute seeded from the material's current colour,
      // and flip the material to use vertex colours (keeping white so colours show true).
      function ensureVertexColors(mesh) {
        if (mesh.userData.vcReady) return;
        let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        mesh.geometry = g;
        const pos = g.attributes.position;
        const base = (mesh.material && mesh.material.color) ? mesh.material.color.clone() : new THREE.Color(0x8a9bb8);
        if (!g.attributes.color) {
          const colors = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) { colors[i*3]=base.r; colors[i*3+1]=base.g; colors[i*3+2]=base.b; }
          g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
        if (!Array.isArray(mesh.material)) {
          mesh.material.vertexColors = true;
          mesh.material.color.setHex(0xffffff);   // white so vertex colours render at true hue
          mesh.material.needsUpdate = true;
        }
        mesh.userData.vcReady = true;
      }

      function paintWholeObject(mesh, hex) {
        ensureVertexColors(mesh);
        const col = new THREE.Color(hex);
        const c = mesh.geometry.attributes.color;
        for (let i = 0; i < c.count; i++) { c.setXYZ(i, col.r, col.g, col.b); }
        c.needsUpdate = true;
      }

      // Flood-fill one coplanar face region (all triangles reachable from the clicked
      // triangle that share an edge and lie in the same plane) with the colour.
      // ── Flat artwork → 3D ───────────────────────────────────────────────────
      // Two ways to bring a painted image across, distinct from Image → 3D (which
      // extrudes a heightmap):
      //   applyImageTexture — wrap it onto an existing object's surface as colour
      //   createImagePlane  — drop it in as a flat picture on the build plate
      function planarUV(geom) {
        // Box-planar projection: each triangle is mapped along whichever axis its
        // normal points down most. CSG'd solids lose their UVs, so this gives them
        // a sensible wrap instead of nothing.
        const pos = geom.attributes.position;
        geom.computeBoundingBox();
        const bb = geom.boundingBox;
        const size = new THREE.Vector3(); bb.getSize(size);
        const uvs = new Float32Array(pos.count * 2);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += 3) {
          a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
          n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
          const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
          for (let k = 0; k < 3; k++) {
            const p = new THREE.Vector3().fromBufferAttribute(pos, i + k);
            let u, v;
            if (ax >= ay && ax >= az)      { u = (p.y - bb.min.y) / (size.y || 1); v = (p.z - bb.min.z) / (size.z || 1); }
            else if (ay >= ax && ay >= az) { u = (p.x - bb.min.x) / (size.x || 1); v = (p.z - bb.min.z) / (size.z || 1); }
            else                           { u = (p.x - bb.min.x) / (size.x || 1); v = (p.y - bb.min.y) / (size.y || 1); }
            uvs[(i + k) * 2] = u; uvs[(i + k) * 2 + 1] = v;
          }
        }
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      }

      function applyImageTexture(dataURL, opts) {
        opts = opts || {};
        if (!window.THREE) { banner("⚠️ 3D isn't ready yet."); return false; }
        const targets = selected.filter(o => o.geometry && !o.userData.isSketch);
        if (!targets.length) { banner("Select an object first, then apply the texture."); return false; }
        const img = new Image();
        img.onload = () => {
          const tex = new THREE.Texture(img);
          tex.needsUpdate = true;
          const rep = opts.repeat || 1;
          tex.wrapS = tex.wrapT = rep > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
          if (rep > 1) tex.repeat.set(rep, rep);
          if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
          targets.forEach(mesh => {
            if (!mesh.geometry.attributes.uv) planarUV(mesh.geometry);
            const old = mesh.material;
            mesh.material = new THREE.MeshStandardMaterial({
              map: tex,
              color: 0xffffff,        // white base so the artwork shows at true hue
              roughness: (old && old.roughness != null) ? old.roughness : 0.5,
              metalness: (old && old.metalness != null) ? old.metalness : 0,
              transparent: true,
              side: THREE.DoubleSide
            });
            mesh.userData.textured = true;
          });
          saveHistory(); updateStatus();
          banner(`Texture applied to ${targets.length} object${targets.length > 1 ? 's' : ''}.`);
        };
        img.onerror = () => banner("⚠️ Couldn't read that image.");
        img.src = dataURL;
        return true;
      }

      function createImagePlane(dataURL, mm) {
        if (!window.THREE) { banner("⚠️ 3D isn't ready yet."); return false; }
        const img = new Image();
        img.onload = () => {
          const ar = img.width / Math.max(1, img.height);
          const w = mm || 40, h = w / ar;
          const geo = new THREE.PlaneGeometry(w, h);   // Z is up here, so a plane
          const tex = new THREE.Texture(img);          // already lies flat
          tex.needsUpdate = true;
          if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            map: tex, color: 0xffffff, roughness: 0.85, transparent: true, side: THREE.DoubleSide
          }));
          mesh.position.z = 0.05;      // a hair above the plate to avoid z-fighting
          mesh.name = 'Artwork';
          mesh.userData.isImagePlane = true;
          mesh.castShadow = false; mesh.receiveShadow = true;
          scene.add(mesh); objects.push(mesh);
          selected.forEach(o => setEmissive(o, 0x000000));
          selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
          saveHistory(); updateStatus(); updateFloatingHUD();
          banner(`Artwork placed as a ${w.toFixed(0)}×${h.toFixed(0)} mm image.`);
        };
        img.onerror = () => banner("⚠️ Couldn't read that image.");
        img.src = dataURL;
        return true;
      }

      window.ModelSmith3D = Object.assign(window.ModelSmith3D || {}, { applyImageTexture, createImagePlane });

      // Expose the 3D timeline to the shared history panel. That panel's script
      // runs after this one, so registrations go into a queue it drains on load.
      (window.__historyPending = window.__historyPending || []).push(['model', {
        list: () => historyTimeline,
        index: () => historyIndex,
        jump: (i) => jumpToHistory(i),
        limit: HISTORY_LIMIT
      }]);

      function paintFaceRegion(mesh, faceIndex, hex) {
        ensureVertexColors(mesh);
        const g = mesh.geometry;
        const pos = g.attributes.position;
        const col = g.attributes.color;
        const triCount = pos.count / 3;
        if (faceIndex == null || faceIndex < 0 || faceIndex >= triCount) return;

        // Triangle normal helper (local space is fine — we compare within one mesh).
        const triN = (ti) => {
          const a = new THREE.Vector3().fromBufferAttribute(pos, ti*3);
          const b = new THREE.Vector3().fromBufferAttribute(pos, ti*3+1);
          const c = new THREE.Vector3().fromBufferAttribute(pos, ti*3+2);
          return new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).normalize();
        };
        const triVerts = (ti) => [0,1,2].map(k => new THREE.Vector3().fromBufferAttribute(pos, ti*3+k));

        // Build a shared-edge adjacency by matching vertex positions (rounded key).
        const key = (v) => `${v.x.toFixed(2)}_${v.y.toFixed(2)}_${v.z.toFixed(2)}`;
        const edgeMap = new Map();
        for (let ti = 0; ti < triCount; ti++) {
          const vs = triVerts(ti).map(key);
          for (let e = 0; e < 3; e++) {
            const k = [vs[e], vs[(e+1)%3]].sort().join('|');
            if (!edgeMap.has(k)) edgeMap.set(k, []);
            edgeMap.get(k).push(ti);
          }
        }

        const startN = triN(faceIndex);
        const visited = new Set([faceIndex]);
        const stack = [faceIndex];
        while (stack.length) {
          const ti = stack.pop();
          const vs = triVerts(ti).map(key);
          for (let e = 0; e < 3; e++) {
            const k = [vs[e], vs[(e+1)%3]].sort().join('|');
            (edgeMap.get(k) || []).forEach(nb => {
              if (visited.has(nb)) return;
              if (triN(nb).dot(startN) > 0.995) { visited.add(nb); stack.push(nb); } // same plane
            });
          }
        }

        const c = new THREE.Color(hex);
        visited.forEach(ti => { for (let k = 0; k < 3; k++) col.setXYZ(ti*3+k, c.r, c.g, c.b); });
        col.needsUpdate = true;
        return visited.size;
      }

      // Paint every vertex within the brush radius of a world-space hit point. Used
      // for freehand brushing — colours blend toward the target so overlapping
      // strokes build up smoothly. Auto-densifies a too-coarse mesh once so the
      // brush has vertices fine enough to leave a clean mark.
      function paintBrushAt(mesh, worldPoint, hex, worldRadius, opacity) {
        ensureVertexColors(mesh);
        // densify once if the surface is too coarse for the brush (like sculpt does)
        if (!mesh.userData._paintDensified) {
          const pos0 = mesh.geometry.attributes.position;
          const scale = (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3;
          let sum = 0, cnt = 0;
          const a = new THREE.Vector3(), b = new THREE.Vector3();
          for (let i = 0; i < Math.min(pos0.count, 300); i += 3) { a.fromBufferAttribute(pos0, i); b.fromBufferAttribute(pos0, i+1); sum += a.distanceTo(b); cnt++; }
          const avgEdge = (cnt ? sum/cnt : 1) * scale;
          let passes = 0, edge = avgEdge;
          while (edge > worldRadius / 2.5 && passes < 3 && (mesh.geometry.attributes.position.count/3) < 400000) { passes++; edge /= 2; }
          if (passes > 0) { const s = subdivideGeometry(mesh.geometry, passes); mesh.geometry.dispose(); mesh.geometry = s; }
          mesh.userData._paintDensified = true;
        }

        const g = mesh.geometry;
        const pos = g.attributes.position;
        const col = g.attributes.color;
        const target = new THREE.Color(hex);
        const flow = (opacity == null ? 1 : opacity);   // 0..1 — how strongly this dab tints
        // work in local space: convert the world hit point and radius into the mesh
        const localPt = mesh.worldToLocal(worldPoint.clone());
        const localRadius = worldRadius / ((mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3);
        const r2 = localRadius * localRadius;
        let painted = 0;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const dx = v.x - localPt.x, dy = v.y - localPt.y, dz = v.z - localPt.z;
          const d2 = dx*dx + dy*dy + dz*dz;
          if (d2 <= r2) {
            const t = 1 - Math.sqrt(d2) / localRadius;      // 1 at centre → 0 at edge
            const w = Math.min(1, t * 1.6) * flow;          // soft edge × opacity
            col.setX(i, col.getX(i) * (1-w) + target.r * w);
            col.setY(i, col.getY(i) * (1-w) + target.g * w);
            col.setZ(i, col.getZ(i) * (1-w) + target.b * w);
            painted++;
          }
        }
        if (painted) col.needsUpdate = true;
        return painted;
      }

      // Paint a continuous smear from `fromWorld` to `toWorld` by stamping overlapping
      // dabs along the segment. This is what makes a fast drag read as a solid line
      // instead of a dotted trail of separate dabs. Spacing is a fraction of the brush
      // radius so consecutive stamps overlap. To avoid double-darkening where stamps
      // overlap within one stroke (which would make the line patchy at low opacity),
      // we paint each spanned vertex only once per call at the strongest weight.
      function paintBrushSmear(mesh, fromWorld, toWorld, hex, worldRadius, opacity) {
        ensureVertexColors(mesh);
        // (densify handled by paintBrushAt's first call, but ensure it here too)
        if (!mesh.userData._paintDensified) { paintBrushAt(mesh, toWorld, hex, worldRadius, 0); }

        const g = mesh.geometry;
        const pos = g.attributes.position;
        const col = g.attributes.color;
        const target = new THREE.Color(hex);
        const flow = (opacity == null ? 1 : opacity);

        const scale = (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3;
        const localRadius = worldRadius / scale;
        const A = mesh.worldToLocal(fromWorld.clone());
        const B = mesh.worldToLocal(toWorld.clone());
        const seg = B.clone().sub(A);
        const segLen = seg.length();
        const r2 = localRadius * localRadius;

        // For each vertex, find its distance to the segment (not just the endpoint),
        // so the whole swept capsule gets painted evenly in one pass.
        const v = new THREE.Vector3(), ap = new THREE.Vector3();
        let painted = 0;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          ap.copy(v).sub(A);
          let tt = segLen > 1e-9 ? ap.dot(seg) / (segLen*segLen) : 0;
          tt = Math.max(0, Math.min(1, tt));
          const cx = A.x + seg.x*tt, cy = A.y + seg.y*tt, cz = A.z + seg.z*tt;
          const dx = v.x-cx, dy = v.y-cy, dz = v.z-cz;
          const d2 = dx*dx + dy*dy + dz*dz;
          if (d2 <= r2) {
            const dist = Math.sqrt(d2);
            const t = 1 - dist / localRadius;
            const w = Math.min(1, t * 1.6) * flow;
            col.setX(i, col.getX(i) * (1-w) + target.r * w);
            col.setY(i, col.getY(i) * (1-w) + target.g * w);
            col.setZ(i, col.getZ(i) * (1-w) + target.b * w);
            painted++;
          }
        }
        if (painted) col.needsUpdate = true;
        return painted;
      }

      // Reset a mesh back to the default grey solid (drops vertex colours).
      function resetObjectColor(mesh) {        if (mesh.geometry.attributes.color) mesh.geometry.deleteAttribute('color');
        if (!Array.isArray(mesh.material)) {
          mesh.material.vertexColors = false;
          mesh.material.color.setHex(0x8a9bb8);
          mesh.material.needsUpdate = true;
        }
        mesh.userData.vcReady = false;
      }

      // Click handler while the Paint tool is active.
      function handlePaintClick() {
        const targets = objects.filter(o => o.visible && !o.userData.isSketch && o.geometry);
        const hits = raycaster.intersectObjects(targets, true);
        if (!hits.length) return false;
        let mesh = hits[0].object;
        while (mesh.parent && mesh.parent !== scene && !mesh.geometry) mesh = mesh.parent;
        if (!mesh.geometry) return false;

        if (paintMode === 'object') {
          paintWholeObject(mesh, paintColor);
          banner("Object painted.");
          saveHistory();
        } else if (paintMode === 'face') {
          const n = paintFaceRegion(mesh, hits[0].faceIndex, paintColor);
          banner(n ? `Painted a face (${n} triangle${n>1?'s':''}).` : "Painted.");
          saveHistory();
        } else { // brush — first dab; further dabs come from drag, one undo per stroke
          paintBrushAt(mesh, hits[0].point, paintColor, paintBrushSize, paintOpacity);
          paintStroke.active = true;
          paintStroke.mesh = mesh;
          paintStroke.lastWorld = hits[0].point.clone();
        }
        return true;
      }

      // Continue a brush stroke as the pointer drags across the surface. We paint a
      // continuous smear from the previous point to the current one so quick drags
      // draw a solid line rather than a dotted trail.
      function handlePaintStroke() {
        if (!paintStroke.active) return;
        const targets = objects.filter(o => o.visible && !o.userData.isSketch && o.geometry);
        const hits = raycaster.intersectObjects(targets, true);
        if (!hits.length) return;
        let mesh = hits[0].object;
        while (mesh.parent && mesh.parent !== scene && !mesh.geometry) mesh = mesh.parent;
        if (!mesh.geometry) return;
        const here = hits[0].point;
        // If we're still on the same mesh and have a previous point, smear between
        // them; otherwise just stamp a dab (e.g. first move, or moved onto a new mesh).
        if (paintStroke.lastWorld && mesh === paintStroke.mesh) {
          paintBrushSmear(mesh, paintStroke.lastWorld, here, paintColor, paintBrushSize, paintOpacity);
        } else {
          paintBrushAt(mesh, here, paintColor, paintBrushSize, paintOpacity);
        }
        paintStroke.mesh = mesh;
        paintStroke.lastWorld = here.clone();
      }

      // End a brush stroke (pointer up): record one history entry for the whole stroke.
      function endPaintStroke() {
        if (paintStroke.active) { paintStroke.active = false; paintStroke.mesh = null; paintStroke.lastWorld = null; saveHistory(); }
      }

      // Apply a true tangent-arc fillet to each picked edge. For a box/extrusion
      // edge (two flat faces meeting along a straight line) this builds the exact
      // rounded surface: both faces are inset by the setback and a cylindrical arc
      // of `radius` tangent to both faces is stitched across the edge.


      // ── Size box ───────────────────────────────────────────────────────────
      // A thin box around the selection with its overall W × D × H — the
      // numbers you need for an orthotic, right on the part.
      let _sizeBox = null, _sizeLabel = null, _sizeKey = '', _dragStartCentre = null;
      const _sb = new THREE.Box3(), _sbSize = new THREE.Vector3(), _sbTop = new THREE.Vector3();
      function ensureSizeBox() {
        if (_sizeBox) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
        _sizeBox = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: 0x2dd4a0, dashSize: 1.6, gapSize: 1.2, transparent: true, opacity: 0.75, depthTest: false }));
        _sizeBox.renderOrder = 998; _sizeBox.raycast = () => {}; _sizeBox.userData.isHelper = true;
        _sizeBox.frustumCulled = false;
        scene.add(_sizeBox);
        _sizeLabel = document.createElement('div');
        _sizeLabel.className = 'ms-sizetag';
        document.getElementById('bld-viewport').appendChild(_sizeLabel);
      }
      function syncSizeBox() {
        const show = display.sizebox && selected.length && activeTool === 'select' && currentMode === 'select' &&
                     !selected.some(o => o.userData.isSketch);
        if (!show) { if (_sizeBox) { _sizeBox.visible = false; _sizeLabel.style.display = 'none'; } return; }
        ensureSizeBox();
        let key = '';
        selected.forEach(o => { o.updateMatrixWorld(true); const el = o.matrixWorld.elements;
          key += o.uuid + (el[0] + el[5] * 3 + el[10] * 7 + el[12] * 11 + el[13] * 13 + el[14] * 17 + el[1] * 19 + el[4] * 23).toFixed(4);
          o.traverse(m => { if (m.geometry && m.geometry.attributes.position) key += m.geometry.attributes.position.version; }); });
        if (key !== _sizeKey) {
          _sizeKey = key;
          _sb.makeEmpty(); selected.forEach(o => _sb.expandByObject(o));
          if (_sb.isEmpty()) { _sizeBox.visible = false; _sizeLabel.style.display = 'none'; return; }
          const n = _sb.min, x = _sb.max;
          const P = [[n.x,n.y,n.z],[x.x,n.y,n.z],[x.x,x.y,n.z],[n.x,x.y,n.z],[n.x,n.y,x.z],[x.x,n.y,x.z],[x.x,x.y,x.z],[n.x,x.y,x.z]];
          const E = [0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7];
          const arr = _sizeBox.geometry.attributes.position.array;
          E.forEach((vi, i) => { arr[i * 3] = P[vi][0]; arr[i * 3 + 1] = P[vi][1]; arr[i * 3 + 2] = P[vi][2]; });
          _sizeBox.geometry.attributes.position.needsUpdate = true;
          _sizeBox.geometry.computeBoundingSphere();
          _sizeBox.computeLineDistances();
          _sb.getSize(_sbSize);
          const mode = transformControl.getMode ? transformControl.getMode() : 'translate';
          const f = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
          if (transformControl.dragging && mode === 'translate' && _dragStartCentre) {
            const c = _sb.getCenter(new THREE.Vector3()).sub(_dragStartCentre);
            _sizeLabel.innerHTML = 'Δ X <b>' + f(c.x) + '</b> Y <b>' + f(c.y) + '</b> Z <b>' + f(c.z) + '</b> mm';
          } else if (transformControl.dragging && mode === 'rotate' && transformControl.object) {
            const r = transformControl.object.rotation, d = THREE.MathUtils.radToDeg;
            _sizeLabel.innerHTML = 'X <b>' + Math.round(d(r.x)) + '°</b> Y <b>' + Math.round(d(r.y)) + '°</b> Z <b>' + Math.round(d(r.z)) + '°</b>' + (shiftHeld ? ' · 15° snap' : '');
          } else {
            _sizeLabel.innerHTML = '<b>' + _sbSize.x.toFixed(1) + '</b> × <b>' + _sbSize.y.toFixed(1) + '</b> × <b>' + _sbSize.z.toFixed(1) + '</b> mm';
          }
        }
        _sizeBox.visible = true;
        // pin the label just above the top of the box, following the camera
        _sbTop.set((_sb.min.x + _sb.max.x) / 2, (_sb.min.y + _sb.max.y) / 2, _sb.max.z).project(camera);
        const vp = renderer.domElement;
        if (_sbTop.z > 1 || Math.abs(_sbTop.x) > 1.1 || Math.abs(_sbTop.y) > 1.1) { _sizeLabel.style.display = 'none'; return; }
        _sizeLabel.style.display = 'block';
        _sizeLabel.style.transform = 'translate(' + Math.round((_sbTop.x + 1) / 2 * vp.clientWidth) + 'px,' +
                                     Math.round((1 - _sbTop.y) / 2 * vp.clientHeight) + 'px) translate(-50%, calc(-100% - 10px))';
      }

      // ── Frame scheduling ───────────────────────────────────────────────────
      function renderFrame(now) {
        _needsRender = false;
        stepCameraTween(now);
        if (controls) controls.update();
        fitCameraClipping();
        resolveHover(now);
        scene.updateMatrixWorld();
        syncEdges(now);
        syncSizeBox();
        syncViewCube();
        syncEmptyState();
        if (section.on) syncSection();
        if (_plate.userData.size !== currentGridSize) {      // follow the grid as it grows
          _plate.userData.size = currentGridSize;
          _plate.scale.set(currentGridSize, currentGridSize, 1);
          _shadowCatcher.scale.set(currentGridSize, currentGridSize, 1);
        }
        _plate.visible = !!(grid && grid.visible);
        if (renderer.shadowMap.enabled && (_shadowsDirty || now - _lastShadowAt > 400)) {
          fitShadowCamera();
          renderer.shadowMap.needsUpdate = true;
          _shadowsDirty = false; _lastShadowAt = now;
        }
        renderer.render(scene, camera);
        _lastRender = now;
        serviceThumbQueue();
      }

      // Adaptive resolution: if continuous frames are slow, drop the pixel ratio
      // a notch; if they're comfortably fast, creep back up to the tier's max.
      function adaptResolution(now) {
        if (display.quality !== 'auto') return;
        if (_lastFrameAt && now - _lastFrameAt < 120) _frameTimes.push(now - _lastFrameAt);
        _lastFrameAt = now;
        if (_frameTimes.length < 45) return;
        const s = _frameTimes.slice().sort((p, q) => p - q);
        const med = s[s.length >> 1];
        _frameTimes.length = 0;
        if (med > 30 && _dpr > 1) applyPixelRatio(_dpr - 0.25);
        else if (med < 17 && _dpr < qualityCfg().dprMax) applyPixelRatio(_dpr + 0.25);
      }

      // Frame the camera to a set of objects (or all of them), so nothing gets lost
      // off-screen after an operation moves or creates geometry far from the origin.
      function frameObjects(objs) {
        const list = (objs && objs.length ? objs : objects).filter(o => o.visible && o.geometry && !o.userData.isSketch);
        if (!list.length) { banner('Nothing to frame.'); return; }
        const box = new THREE.Box3();
        list.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
        if (box.isEmpty()) return;
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = size.length() * 0.5 || 10;   // bounding sphere, so corners never clip
        // distance so the sphere fits the vertical FOV with a little margin
        // Fit whichever way is tighter — on a portrait iPad the width is.
        const vfov = camera.fov * Math.PI / 180;
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
        const fov = Math.min(vfov, hfov);
        const dist = (radius / Math.sin(fov / 2)) * 1.12;
        // keep the current view direction, just reposition along it
        const dir = camera.position.clone().sub(controls.target).normalize();
        if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.9, 0.7).normalize();
        flyCamera(centre.clone().addScaledVector(dir, dist), centre, 420);
      }

      // Strip zero-area triangles while leaving every other attribute — crucially
      // the normals — untouched. Degenerate slivers are what break the boolean
      // solver; recomputing normals is not needed and actively harms curved shapes.
      function dropDegenerateTriangles(geometry) {
        const src = geometry.index ? geometry.toNonIndexed() : geometry;
        const pos = src.attributes.position;
        const keep = [];
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += 3) {
          a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i+1); c.fromBufferAttribute(pos, i+2);
          if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() >= 1e-16) keep.push(i);
        }
        if (keep.length * 3 === pos.count) return src;   // nothing to drop
        const out = new THREE.BufferGeometry();
        const copy = (name, size) => {
          const at = src.attributes[name];
          if (!at) return;
          const arr = new Float32Array(keep.length * 3 * size);
          let o = 0;
          keep.forEach(i => {
            for (let j = 0; j < 3; j++) {
              for (let k = 0; k < size; k++) arr[o++] = at.array[(i + j) * size + k];
            }
          });
          out.setAttribute(name, new THREE.BufferAttribute(arr, size));
        };
        copy('position', 3); copy('normal', 3); copy('color', 3); copy('uv', 2);
        return out;
      }

      function makeGeometryCSGReady(geometry) {
        let cleanGeo = geometry.toNonIndexed();
        for (let attr in cleanGeo.attributes) {
          if (attr !== 'position' && attr !== 'normal' && attr !== 'color' && attr !== 'uv') {
            cleanGeo.deleteAttribute(attr);
          }
        }
        cleanGeo.computeVertexNormals();
        return cleanGeo;
      }

      // Midpoint-subdivide a triangle-soup geometry: every triangle becomes four by
      // splitting each edge at its midpoint. This raises mesh resolution so large
      // shapes look smooth and the sculpt brush has fine vertices to push around.
      // Vertex colours (if present) are interpolated so paint survives.
      function subdivideGeometry(geometry, iterations = 1) {
        let geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
        for (let iter = 0; iter < iterations; iter++) {
          const pos = geo.attributes.position;
          const col = geo.attributes.color;
          const outPos = [];
          const outCol = col ? [] : null;
          const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
          const mid = (p, q) => [(p.x+q.x)/2, (p.y+q.y)/2, (p.z+q.z)/2];
          const midC = (i, j) => [
            (col.getX(i)+col.getX(j))/2, (col.getY(i)+col.getY(j))/2, (col.getZ(i)+col.getZ(j))/2
          ];
          for (let i = 0; i < pos.count; i += 3) {
            A.fromBufferAttribute(pos, i); B.fromBufferAttribute(pos, i+1); C.fromBufferAttribute(pos, i+2);
            const a = [A.x,A.y,A.z], b = [B.x,B.y,B.z], c = [C.x,C.y,C.z];
            const ab = mid(A,B), bc = mid(B,C), ca = mid(C,A);
            // four sub-triangles
            outPos.push(...a,...ab,...ca, ...ab,...b,...bc, ...ca,...bc,...c, ...ab,...bc,...ca);
            if (outCol) {
              const ca_i=col.getX(i), cai=[col.getX(i),col.getY(i),col.getZ(i)];
              const cb=[col.getX(i+1),col.getY(i+1),col.getZ(i+1)];
              const cc=[col.getX(i+2),col.getY(i+2),col.getZ(i+2)];
              const cab=midC(i,i+1), cbc=midC(i+1,i+2), cca=midC(i+2,i);
              outCol.push(...cai,...cab,...cca, ...cab,...cb,...cbc, ...cca,...cbc,...cc, ...cab,...cbc,...cca);
            }
          }
          const ng = new THREE.BufferGeometry();
          ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPos), 3));
          if (outCol) ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(outCol), 3));
          ng.computeVertexNormals();
          geo = ng;
        }
        return geo;
      }

      // Raise the resolution of the selected mesh(es) by one subdivision pass.
      function subdivideSelected() {
        const targets = selected.filter(o => o.geometry && !o.userData.isSketch);
        if (!targets.length) { banner("Select a solid first to increase its resolution."); return; }
        let totalTris = 0;
        targets.forEach(m => {
          const before = m.geometry.attributes.position.count / 3;
          if (before > 300000) { banner("That mesh is already very dense — skipping to keep things responsive."); return; }
          const sub = subdivideGeometry(m.geometry, 1);
          m.geometry.dispose();
          m.geometry = sub;
          totalTris += sub.attributes.position.count / 3;
        });
        saveHistory(); updateStatus();
        banner(`Resolution increased — now ${Math.round(totalTris/1000)}k triangles.`);
      }


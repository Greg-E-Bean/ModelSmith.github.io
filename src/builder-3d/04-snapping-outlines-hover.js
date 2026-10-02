      // ── Snapping ────────────────────────────────────────────────────────────
      const snap = { move: 0, rotate: 0 };
      function setMoveSnap(mm) {
        snap.move = mm; transformControl.setTranslationSnap(mm || null);
        banner(mm ? `Moves snap to a ${mm} mm grid.` : 'Move snapping off.');
      }
      function setRotateSnap(deg) {
        snap.rotate = deg; transformControl.setRotationSnap(deg ? THREE.MathUtils.degToRad(deg) : null);
        banner(deg ? `Rotation snaps to ${deg}° steps.` : 'Rotation snapping off.');
      }
      window.msTools3D = {
        view: setStandardView, layFlat: armLayFlat, section: openSectionPanel, info: openModelInfo,
        moveSnap: setMoveSnap, rotateSnap: setRotateSnap, snapState: () => Object.assign({}, snap)
      };

      let _emptyCard = null;
      function syncEmptyState() {
        if (!_emptyCard) return;
        const empty = !objects.length && currentMode !== 'sketching';
        if (_emptyCard._shown !== empty) { _emptyCard._shown = empty; _emptyCard.classList.toggle('show', empty); }
      }
      function setupTools3D() {
        const vp0 = document.getElementById('bld-viewport');
        _emptyCard = document.createElement('div');
        _emptyCard.className = 'ms-empty';
        _emptyCard.innerHTML = '<div class="me-card"><b>Start a model</b><span>Add a shape, bring in a scan, or sketch a profile.</span>' +
          '<div class="me-row"><button data-me="box">Cube</button><button data-me="cylinder">Cylinder</button><button data-me="sphere">Sphere</button></div>' +
          '<div class="me-row"><button data-me="import">Import STL / OBJ…</button><button data-me="sketch" class="me-adv">Sketch</button></div>' +
          '<div class="me-tip">Tip: press <kbd>Ctrl K</kbd> to search every command.</div></div>';
        _emptyCard.addEventListener('pointerdown', e => e.stopPropagation());
        _emptyCard.querySelectorAll('button').forEach(b => b.onclick = () => {
          const k = b.dataset.me;
          if (k === 'import') { const z = document.getElementById('bld-dropzone'); if (z) z.click(); }
          else if (k === 'sketch') { const t = document.getElementById('tool-sketch'); if (t) t.click(); }
          else { const pb = document.querySelector('.bld-prim[data-prim="' + k + '"]'); if (pb) pb.click(); }
        });
        vp0.appendChild(_emptyCard);
        const sp = document.createElement('div');
        sp.id = 'sec-view-panel'; sp.className = 'ms-float-panel';
        sp.innerHTML = '<div class="mfp-head"><b>Section view</b><button class="mfp-x" id="sv-close" aria-label="Close section view">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
          '<div class="toggle-group" id="sv-axis"><button class="toggle-btn" data-axis="x">X</button><button class="toggle-btn" data-axis="y">Y</button><button class="toggle-btn active" data-axis="z">Z</button></div>' +
          '<div class="param-label" style="margin-top:8px;">Cut at <span class="val" id="sv-pos-val">0 mm</span></div>' +
          '<input type="range" id="sv-pos" min="0" max="20" step="0.1" value="10">' +
          '<button class="mini-btn" id="sv-flip" style="width:100%;margin-top:6px;">Show other side</button>';
        vp0.appendChild(sp);
        const md = document.createElement('div');
        md.innerHTML = '<div class="mask-backdrop" id="mi-backdrop"></div>' +
          '<div class="mask-dialog mi-dialog" id="mi-dialog" role="dialog" aria-label="Model info">' +
          '<div class="mask-head"><b>Model info</b><button class="mask-close" id="mi-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
          '<div class="mask-body"><div id="mi-out"></div>' +
          '<div class="param-label" style="margin-top:12px;">Material</div><select id="mi-mat" class="ms-select"></select>' +
          '<div class="param-label" style="margin-top:8px;">Infill <span class="val" id="mi-infill-val">20%</span></div><input type="range" id="mi-infill" min="0" max="100" step="5" value="20">' +
          '<div class="param-label">Wall + top/bottom thickness <span class="val" id="mi-wall-val">1.2 mm</span></div><input type="range" id="mi-wall" min="0.4" max="4" step="0.1" value="1.2">' +
          '<div class="hint" style="text-align:left;margin-top:6px;">Estimate for 1.75 mm filament. Your slicer will be more exact (supports, brim and purge are not included).</div>' +
          '<div class="btn-grid" style="grid-template-columns:1fr;margin-top:10px;"><button class="mini-btn primary" id="mi-done">Done</button></div></div></div>';
        while (md.firstChild) document.body.appendChild(md.firstChild);
        buildViewCube();
        wireSectionPanel();
        wireModelInfo();
        const vp = document.getElementById('bld-viewport');
        vp.addEventListener('pointerdown', onLayFlatPointer, { capture: true });
        window.addEventListener('keydown', e => {
          if (e.key === 'Escape' && _layFlatArmed) { disarmLayFlat('Lay flat cancelled.'); return; }
          const t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
          const pa = document.getElementById('paint-app');
          if (pa && pa.style.display !== 'none') return;
          if (!window.Keys || currentMode === 'sketching') return;
          const map = { viewFront: 'front', viewRight: 'right', viewTop: 'top', viewIso: 'iso' };
          for (const id in map) if (Keys.is('model', id, e)) { e.preventDefault(); setStandardView(map[id]); return; }
          if (Keys.is('model', 'sectionView', e)) { e.preventDefault(); openSectionPanel(); }
        });
      }

      // Display settings dialog (View → Display…)
      function setupDisplayDialog() {
        const $d = id => document.getElementById(id);
        const HINTS = {
          auto: IS_TABLET ? 'Auto picks Balanced on this tablet and lowers resolution briefly if frames drop.'
                          : 'Auto picks High on this computer and lowers resolution briefly if frames drop.',
          high: 'Sharpest image and 2048 px shadows. Best on a desktop GPU.',
          balanced: 'Slightly softer image and lighter shadows. Good for iPad.',
          saver: 'Native resolution, no shadows. Longest battery life.'
        };
        function sync() {
          const d = msDisplay.get();
          document.querySelectorAll('#ds-quality .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.q === d.quality));
          document.querySelectorAll('#ds-dialog [data-ds]').forEach(cb => { cb.checked = !!d[cb.dataset.ds]; });
          const sh = document.querySelector('#ds-dialog [data-ds="shadows"]');
          if (sh) sh.disabled = msDisplay.tier() === 'saver';
          $d('ds-qhint').textContent = HINTS[d.quality] || '';
        }
        function open() { sync(); $d('ds-backdrop').classList.add('open'); $d('ds-dialog').classList.add('open'); }
        function close() { $d('ds-backdrop').classList.remove('open'); $d('ds-dialog').classList.remove('open'); }
        window.openDisplaySettings = open;
        document.querySelectorAll('#ds-quality .toggle-btn').forEach(b => b.onclick = () => { msDisplay.set('quality', b.dataset.q); sync(); });
        document.querySelectorAll('#ds-dialog [data-ds]').forEach(cb => cb.onchange = () => { msDisplay.set(cb.dataset.ds, cb.checked); sync(); });
        ['ds-close', 'ds-done', 'ds-backdrop'].forEach(id => { const el = $d(id); if (el) el.onclick = close; });
      }

      // Fit the key light's shadow camera tightly around whatever is on the
      // plate — a tight frustum is what keeps shadow edges crisp.
      const _shBox = new THREE.Box3(), _shC = new THREE.Vector3(), _shS = new THREE.Vector3();
      const _keyDir = new THREE.Vector3(0.55, -0.45, 0.85).normalize();
      function fitShadowCamera() {
        _shBox.makeEmpty();
        objects.forEach(o => { if (o.visible && !o.userData.isSketch) _shBox.expandByObject(o); });
        if (_shBox.isEmpty()) _shBox.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 20));
        _shBox.getCenter(_shC); _shBox.getSize(_shS);
        const r = Math.max(10, _shS.length() * 0.5) * 1.15;
        _keyLight.target.position.copy(_shC);
        _keyLight.position.copy(_shC).addScaledVector(_keyDir, r * 3);
        const cam = _keyLight.shadow.camera;
        cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
        cam.near = r * 0.5; cam.far = r * 5;
        cam.updateProjectionMatrix();
        _keyLight.target.updateMatrixWorld();
        _keyLight.updateMatrixWorld();
      }

      // Keep the depth range proportional to how far away the camera is. A huge
      // near/far ratio is what made edges and coplanar faces shimmer.
      function fitCameraClipping() {
        const d = camera.position.distanceTo(controls.target);
        const near = Math.max(0.05, d / 250);
        const far = Math.max(2000, d * 60);
        if (Math.abs(camera.near - near) / near > 0.05 || camera.far !== far) {
          camera.near = near; camera.far = far; camera.updateProjectionMatrix();
        }
      }

      // ── Feature-edge outlines ──────────────────────────────────────────────
      // Stock EdgesGeometry draws every unmatched edge — after a boolean that
      // includes the T-junction seams the solver leaves across flat faces, which
      // showed as stray dashed lines. This version pairs unmatched edges with the
      // collinear edges they overlap, so only genuine creases get a line.
      function featureEdgePositions(geo, angleDeg) {
        const pos = geo.attributes.position; if (!pos) return new Float32Array(0);
        const idx = geo.index;
        const triN = idx ? idx.count / 3 : pos.count / 3;
        const cosT = Math.cos(THREE.MathUtils.degToRad(angleDeg));
        const Q = 1e4;
        const vid = new Map(); const vx = [];
        const vIndex = (i) => {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const k = Math.round(x * Q) + ',' + Math.round(y * Q) + ',' + Math.round(z * Q);
          let id = vid.get(k);
          if (id === undefined) { id = vx.length / 3; vid.set(k, id); vx.push(x, y, z); }
          return id;
        };
        const tn = new Float32Array(triN * 3); const tv = new Int32Array(triN * 3);
        const valid = new Uint8Array(triN);
        const thin = new Uint8Array(triN);   // needle-thin slivers have unreliable normals
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < triN; t++) {
          const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          const v0 = vIndex(i0), v1 = vIndex(i1), v2 = vIndex(i2);
          tv[t * 3] = v0; tv[t * 3 + 1] = v1; tv[t * 3 + 2] = v2;
          if (v0 === v1 || v1 === v2 || v0 === v2) continue;
          a.set(vx[v0 * 3], vx[v0 * 3 + 1], vx[v0 * 3 + 2]);
          b.set(vx[v1 * 3], vx[v1 * 3 + 1], vx[v1 * 3 + 2]);
          c.set(vx[v2 * 3], vx[v2 * 3 + 1], vx[v2 * 3 + 2]);
          b.sub(a); c.sub(a);
          const e2 = Math.max(b.lengthSq(), c.lengthSq(), b.distanceToSquared(c));
          b.cross(c);
          const L = b.length(); if (L < 1e-10) continue;
          if (L / e2 < 2e-3) thin[t] = 1;
          b.divideScalar(L); tn[t * 3] = b.x; tn[t * 3 + 1] = b.y; tn[t * 3 + 2] = b.z; valid[t] = 1;
        }
        const out = [];
        const dotT = (p, q) => tn[p * 3] * tn[q * 3] + tn[p * 3 + 1] * tn[q * 3 + 1] + tn[p * 3 + 2] * tn[q * 3 + 2];
        const edges = new Map();
        for (let t = 0; t < triN; t++) {
          if (!valid[t]) continue;
          for (let e = 0; e < 3; e++) {
            const p = tv[t * 3 + e], q = tv[t * 3 + (e + 1) % 3];
            const k = p < q ? p * 4194304 + q : q * 4194304 + p;   // unique numeric key
            const hit = edges.get(k);
            if (hit === undefined) edges.set(k, t);
            else if (hit >= 0) {
              if (!thin[hit] && !thin[t] && dotT(hit, t) < cosT) out.push(p, q);
              edges.set(k, -1);        // paired
            }
          }
        }
        // Unpaired edges: group by the infinite line they lie on, then pair up
        // overlapping stretches from different triangles.
        const lines = new Map();
        const d = new THREE.Vector3(), o = new THREE.Vector3(), P = new THREE.Vector3();
        edges.forEach((t, k) => {
          if (t < 0) return;
          const p = Math.floor(k / 4194304), q = k - p * 4194304;
          P.set(vx[p * 3], vx[p * 3 + 1], vx[p * 3 + 2]);
          d.set(vx[q * 3] - P.x, vx[q * 3 + 1] - P.y, vx[q * 3 + 2] - P.z);
          const len = d.length(); if (len < 1e-9) return;
          d.divideScalar(len);
          // canonical direction (first significant component positive)
          if (d.x < -1e-6 || (Math.abs(d.x) <= 1e-6 && (d.y < -1e-6 || (Math.abs(d.y) <= 1e-6 && d.z < 0)))) d.negate();
          const t0 = P.dot(d);
          o.copy(P).addScaledVector(d, -t0);    // closest point on the line to the origin
          const key = Math.round(d.x * 500) + ',' + Math.round(d.y * 500) + ',' + Math.round(d.z * 500) + '|' +
                      Math.round(o.x * 50) + ',' + Math.round(o.y * 50) + ',' + Math.round(o.z * 50);
          const t1 = t0 + (vx[q * 3] - P.x) * d.x + (vx[q * 3 + 1] - P.y) * d.y + (vx[q * 3 + 2] - P.z) * d.z;
          let arr = lines.get(key); if (!arr) { arr = []; lines.set(key, arr); }
          arr.push({ s: Math.min(t0, t1), e: Math.max(t0, t1), tri: t, dx: d.x, dy: d.y, dz: d.z, ox: o.x, oy: o.y, oz: o.z, used: false });
        });
        const seg = [];
        const pushSeg = (L, s, e) => seg.push(L.ox + L.dx * s, L.oy + L.dy * s, L.oz + L.dz * s, L.ox + L.dx * e, L.oy + L.dy * e, L.oz + L.dz * e);
        lines.forEach(arr => {
          arr.sort((m, n) => m.s - n.s);
          for (let i = 0; i < arr.length; i++) {
            const A = arr[i];
            for (let j = i + 1; j < arr.length && arr[j].s < A.e - 1e-6; j++) {
              const B = arr[j];
              if (B.tri === A.tri) continue;
              const s = Math.max(A.s, B.s), e = Math.min(A.e, B.e);
              if (e - s < 1e-6) continue;
              A.used = B.used = true;
              if (!thin[A.tri] && !thin[B.tri] && dotT(A.tri, B.tri) < cosT) pushSeg(A, s, e);
            }
            if (!A.used) {
              // Might still be covered later by an edge that started earlier —
              // only a truly open border stays unused after the full sweep.
            }
          }
          for (const A of arr) if (!A.used) pushSeg(A, A.s, A.e);   // open boundary
        });
        const f = new Float32Array(out.length * 3 + seg.length);
        for (let i = 0; i < out.length; i++) { const v = out[i]; f[i * 3] = vx[v * 3]; f[i * 3 + 1] = vx[v * 3 + 1]; f[i * 3 + 2] = vx[v * 3 + 2]; }
        f.set(seg, out.length * 3);
        return f;
      }
      window.__featureEdges = featureEdgePositions;

      const edgeGroup = new THREE.Group(); edgeGroup.userData.isHelper = true;
      const _edgeMat      = new THREE.LineBasicMaterial({ color: 0x07080a, transparent: true, opacity: 0.55 });
      const _edgeMatSel   = new THREE.LineBasicMaterial({ color: 0x2dd4a0, transparent: true, opacity: 1.0 });
      const _edgeMatHover = new THREE.LineBasicMaterial({ color: 0x9cc4ff, transparent: true, opacity: 0.9 });
      const _edgeCache = new Map();   // mesh uuid -> { lines, key, seenKey, since }
      let _edgeBuildsThisFrame = 0;

      function meshTriCount(m) { const g = m.geometry; return g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0); }

      function syncEdges(now) {
        if (!edgeGroup.parent) scene.add(edgeGroup);
        edgeGroup.visible = !!display.edges;
        if (!display.edges) return;
        _edgeBuildsThisFrame = 0;
        const limit = qualityCfg().edgeTriLimit;
        const seen = new Set();
        const selSet = new Set(); selected.forEach(s => s.traverse(c => selSet.add(c)));
        const hovSet = new Set(); if (_hovered) _hovered.traverse(c => hovSet.add(c));
        objects.forEach(root => {
          if (!root.visible || root.userData.isSketch || !root.parent) return;
          root.traverse(m => {
            if (!m.isMesh || !m.geometry || !m.visible) return;
            const mat = Array.isArray(m.material) ? m.material[0] : m.material;
            if (!mat || mat.wireframe) return;           // x-rayed / wire display
            const pa = m.geometry.attributes.position; if (!pa) return;
            if (meshTriCount(m) > limit) return;
            // Nudge the surface back a hair so the outline wins the depth test.
            if (!mat.polygonOffset) { mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 1; mat.needsUpdate = true; }
            const key = m.geometry.uuid + ':' + pa.version + ':' + (m.geometry.index ? m.geometry.index.version : 0);
            let e = _edgeCache.get(m.uuid);
            if (!e) { e = { lines: null, key: null, seenKey: null, since: 0 }; _edgeCache.set(m.uuid, e); }
            if (e.key !== key) {
              if (e.seenKey !== key) { e.seenKey = key; e.since = now; }
              // Geometry being actively reshaped (sculpt, live scale edits):
              // wait until it has been still for a moment before re-outlining.
              const stable = !e.lines || now - e.since > 220;
              if (stable && _edgeBuildsThisFrame < 1) {
                _edgeBuildsThisFrame++;
                const arr = featureEdgePositions(m.geometry, 32);
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
                if (e.lines) { e.lines.geometry.dispose(); e.lines.geometry = g; }
                else {
                  e.lines = new THREE.LineSegments(g, _edgeMat);
                  e.lines.matrixAutoUpdate = false; e.lines.raycast = () => {};
                  edgeGroup.add(e.lines);
                }
                e.key = key;
              } else {
                if (e.lines) e.lines.visible = false;
                _needsRender = true;     // come back next frame to finish
                seen.add(m.uuid);
                return;
              }
            }
            if (!e.lines) return;
            e.lines.visible = true;
            e.lines.matrix.copy(m.matrixWorld);
            e.lines.material = selSet.has(m) ? _edgeMatSel : (hovSet.has(m) ? _edgeMatHover : _edgeMat);
            seen.add(m.uuid);
          });
        });
        _edgeCache.forEach((e, id) => {
          if (seen.has(id)) return;
          if (e.lines) { edgeGroup.remove(e.lines); e.lines.geometry.dispose(); }
          _edgeCache.delete(id);
        });
      }

      // ── Hover highlight ────────────────────────────────────────────────────
      let _hovered = null, _hoverPending = null, _hoverAt = 0;
      const _hoverRay = new THREE.Raycaster(), _hoverNdc = new THREE.Vector2();
      function hoverRoot(obj) {
        let o = obj;
        while (o && !objects.includes(o)) o = o.parent;
        if (o && o.parent === groupPivot) return o;
        return o;
      }
      function setHovered(o) {
        if (o === _hovered) return;
        const prev = _hovered; _hovered = o;
        if (prev && !selected.includes(prev) && prev.parent) setEmissive(prev, 0x000000);
        if (o && !selected.includes(o) && !_xrayOrig.has(o.uuid)) setEmissive(o, 0x10202c);
        renderer.domElement.style.cursor = o ? 'pointer' : '';
        _needsRender = true;
      }
      function onHoverMove(e) {
        if (!display.hover || e.pointerType === 'touch' || e.buttons) return;
        if (activeTool !== 'select' || currentMode !== 'select') { if (_hovered) setHovered(null); return; }
        if (transformControl && (transformControl.dragging || transformControl.axis)) { if (_hovered) setHovered(null); return; }
        _hoverPending = e;
        _needsRender = true;     // resolved in the render loop, at most once a frame
      }
      function resolveHover(now) {
        if (!_hoverPending || now - _hoverAt < 40) return;
        const e = _hoverPending; _hoverPending = null; _hoverAt = now;
        const r = renderer.domElement.getBoundingClientRect();
        _hoverNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        _hoverRay.setFromCamera(_hoverNdc, camera);
        const targets = objects.filter(o => o.visible && !o.userData.isSketch);
        let total = 0; targets.forEach(o => o.traverse(m => { if (m.isMesh && m.geometry) total += meshTriCount(m); }));
        if (total > 600000) return;          // too heavy to test every mouse move
        const hit = _hoverRay.intersectObjects(targets, true)[0];
        const h = hit ? hoverRoot(hit.object) : null;
        // A selection change resets highlights, so re-assert the hover tint.
        if (h && h === _hovered && !selected.includes(h) && !_xrayOrig.has(h.uuid)) setEmissive(h, 0x10202c);
        setHovered(h);
      }

      // Double-click an object to glide the camera onto it; double-click empty
      // space to frame the whole build.
      function onViewportDoubleClick(e) {
        if (activeTool !== 'select' || currentMode !== 'select') return;
        const r = renderer.domElement.getBoundingClientRect();
        _hoverNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        _hoverRay.setFromCamera(_hoverNdc, camera);
        const hit = _hoverRay.intersectObjects(objects.filter(o => o.visible && !o.userData.isSketch), true)[0];
        frameObjects(hit ? [hoverRoot(hit.object)] : null);
      }

      // ── Smooth camera moves ────────────────────────────────────────────────
      let _camTween = null;
      function flyCamera(toPos, toTarget, ms) {
        _camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: toPos.clone(), t1: toTarget.clone(),
                      start: performance.now(), dur: ms || 420 };
        kickActive(_camTween.dur + 200);
      }
      function stepCameraTween(now) {
        if (!_camTween) return;
        const k = Math.min(1, (now - _camTween.start) / _camTween.dur);
        const s = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(_camTween.p0, _camTween.p1, s);
        controls.target.lerpVectors(_camTween.t0, _camTween.t1, s);
        if (k >= 1) _camTween = null;
        _needsRender = true;
      }
      // Cancel a glide the moment the user grabs the camera themselves.
      window.addEventListener('pointerdown', () => { _camTween = null; }, { capture: true });
      window.addEventListener('wheel', () => { _camTween = null; }, { capture: true, passive: true });


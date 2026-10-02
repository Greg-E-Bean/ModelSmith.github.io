      // ══ Extra 3D tools (v1.10) ══════════════════════════════════════════════
      // ── View cube + standard views ──────────────────────────────────────────
      // A small cube in the corner that turns with the camera. Click a face to
      // look straight at that side; the button underneath goes back to 3/4 view.
      const VIEW_DIRS = {
        top: [0, -0.0015, 1], bottom: [0, -0.0015, -1], front: [0, -1, 0], back: [0, 1, 0],
        right: [1, 0, 0], left: [-1, 0, 0], iso: [0.78, -1, 0.72]
      };
      function setStandardView(name) {
        const d = VIEW_DIRS[name]; if (!d) return;
        const dist = camera.position.distanceTo(controls.target) || 150;
        const dir = new THREE.Vector3(...d).normalize();
        flyCamera(controls.target.clone().addScaledVector(dir, dist), controls.target.clone(), 450);
        banner(name === 'iso' ? '3/4 view.' : name.charAt(0).toUpperCase() + name.slice(1) + ' view.');
      }
      window.msSetView = setStandardView;
      let _cubeFaces = null, _cubeHost = null;
      const CUBE_FACES = [   // name, right axis, up axis (world); normal = right × up
        ['top',    [1, 0, 0],  [0, 1, 0]],  ['bottom', [1, 0, 0], [0, -1, 0]],
        ['front',  [1, 0, 0],  [0, 0, 1]],  ['back',  [-1, 0, 0], [0, 0, 1]],
        ['right',  [0, 1, 0],  [0, 0, 1]],  ['left',  [0, -1, 0], [0, 0, 1]]
      ];
      function buildViewCube() {
        const vp = document.getElementById('bld-viewport');
        _cubeHost = document.createElement('div');
        _cubeHost.className = 'ms-viewcube';
        _cubeHost.innerHTML = '<div class="vc-stage"></div><button class="vc-home" title="3/4 view">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg></button>';
        vp.appendChild(_cubeHost);
        const stage = _cubeHost.querySelector('.vc-stage');
        _cubeFaces = CUBE_FACES.map(([name, r, u]) => {
          const el = document.createElement('button');
          el.className = 'vc-face'; el.textContent = name.toUpperCase(); el.title = name.charAt(0).toUpperCase() + name.slice(1) + ' view';
          el.onclick = (e) => { e.stopPropagation(); setStandardView(name); };
          stage.appendChild(el);
          const R = new THREE.Vector3(...r), U = new THREE.Vector3(...u);
          return { el, R, U, N: new THREE.Vector3().crossVectors(R, U) };
        });
        _cubeHost.querySelector('.vc-home').onclick = (e) => { e.stopPropagation(); setStandardView('iso'); };
        ['pointerdown', 'dblclick'].forEach(ev => _cubeHost.addEventListener(ev, e => e.stopPropagation()));
      }
      const _vcM = new THREE.Matrix4();
      function syncViewCube() {
        if (!_cubeFaces) return;
        const H = 26;   // half size in px
        _vcM.extractRotation(camera.matrixWorldInverse);
        const e = _vcM.elements;   // column-major; view = R * world
        // CSS space = diag(1,-1,1) * view
        const mc = (v) => { const x = e[0] * v.x + e[4] * v.y + e[8] * v.z, y = e[1] * v.x + e[5] * v.y + e[9] * v.z, z = e[2] * v.x + e[6] * v.y + e[10] * v.z; return [x, -y, z]; };
        _cubeFaces.forEach(f => {
          const c0 = mc(f.R), c1 = mc(f.U.clone().negate()), c2 = mc(f.N), t = mc(f.N.clone().multiplyScalar(H));
          f.el.style.transform = `matrix3d(${c0[0]},${c0[1]},${c0[2]},0,${c1[0]},${c1[1]},${c1[2]},0,${c2[0]},${c2[1]},${c2[2]},0,${t[0]},${t[1]},${t[2]},1)`;
          f.el.classList.toggle('facing', c2[2] > 0.92);
        });
      }

      // ── Lay flat ────────────────────────────────────────────────────────────
      // Click the face that should sit on the build plate: the part is turned so
      // that face points straight down, then dropped onto the plate.
      let _layFlatArmed = false;
      function armLayFlat() {
        if (!objects.some(o => !o.userData.isSketch)) return banner('Nothing to lay flat yet.');
        _layFlatArmed = true;
        renderer.domElement.style.cursor = 'crosshair';
        banner('Lay flat — click the face that should sit on the build plate. Esc cancels.');
      }
      function disarmLayFlat(msg) { _layFlatArmed = false; renderer.domElement.style.cursor = ''; if (msg) banner(msg); }
      function onLayFlatPointer(e) {
        if (!_layFlatArmed || e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        const r = renderer.domElement.getBoundingClientRect();
        _hoverNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        _hoverRay.setFromCamera(_hoverNdc, camera);
        const hit = _hoverRay.intersectObjects(objects.filter(o => o.visible && !o.userData.isSketch), true)[0];
        if (!hit || !hit.face) return disarmLayFlat('No face there — Lay flat cancelled.');
        const root = hoverRoot(hit.object);
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, -1));
        root.updateMatrixWorld(true);
        const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
        root.quaternion.premultiply(q);
        root.position.sub(c).applyQuaternion(q).add(c);
        root.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(root);
        root.position.z -= b.min.z;
        root.updateMatrixWorld(true);
        disarmLayFlat();
        selected = [root]; refreshSelectionVisual(); attachGizmoToSelection(); updateFloatingHUD(); updateStatus();
        saveHistory(); invalidate();
        banner('Laid flat on that face and dropped onto the plate.');
      }

      // ── Section view ────────────────────────────────────────────────────────
      // Cut the view (not the model) with a plane to see inside: wall thickness,
      // cavities, inserts. The cut face is filled in the accent colour.
      const section = { on: false, axis: 'z', pos: 0, flip: false, plane: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0) };
      const _capMat = new THREE.MeshBasicMaterial({ color: 0xd9895a, side: THREE.BackSide, clippingPlanes: [section.plane],
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const _capGroup = new THREE.Group(); _capGroup.userData.isHelper = true;
      const _capMap = new Map();
      function sectionBounds() {
        const b = new THREE.Box3();
        objects.forEach(o => { if (o.visible && !o.userData.isSketch) b.expandByObject(o); });
        if (b.isEmpty()) b.set(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 20));
        return b;
      }
      function updateSectionPlane() {
        const n = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[section.axis];
        const s = section.flip ? 1 : -1;
        section.plane.normal.set(n[0] * s, n[1] * s, n[2] * s);
        section.plane.constant = -s * section.pos;   // keeps the side below/behind pos
        _needsRender = true; _shadowsDirty = true;
      }
      function syncSection() {
        renderer.localClippingEnabled = section.on;
        if (!_capGroup.parent) scene.add(_capGroup);
        _capGroup.visible = section.on;
        const planes = section.on ? [section.plane] : null;
        const seen = new Set();
        objects.forEach(root => {
          if (!root.visible || root.userData.isSketch) return;
          root.traverse(m => {
            if (!m.isMesh || !m.geometry || !m.material) return;
            (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => {
              const has = !!(mt.clippingPlanes && mt.clippingPlanes.length && mt.clippingPlanes[0] === section.plane);
              if (section.on && !has) { mt.clippingPlanes = [section.plane]; mt.clipShadows = true; mt.needsUpdate = true; }
              else if (!section.on && mt.clippingPlanes && mt.clippingPlanes.length) { mt.clippingPlanes = null; mt.needsUpdate = true; }
            });
            if (!section.on) return;
            let cap = _capMap.get(m.uuid);
            if (!cap || cap.geometry !== m.geometry) {
              if (cap) _capGroup.remove(cap);
              cap = new THREE.Mesh(m.geometry, _capMat); cap.matrixAutoUpdate = false; cap.raycast = () => {};
              _capMap.set(m.uuid, cap); _capGroup.add(cap);
            }
            cap.matrix.copy(m.matrixWorld); seen.add(m.uuid);
          });
        });
        _capMap.forEach((cap, id) => { if (!seen.has(id)) { _capGroup.remove(cap); _capMap.delete(id); } });
      }
      function openSectionPanel() {
        const p = document.getElementById('sec-view-panel');
        const on = !p.classList.contains('open');
        p.classList.toggle('open', on);
        section.on = on;
        if (on) {
          const b = sectionBounds();
          const a = section.axis;
          const lo = b.min[a], hi = b.max[a];
          const sl = document.getElementById('sv-pos');
          sl.min = (lo - 1).toFixed(1); sl.max = (hi + 1).toFixed(1); sl.step = Math.max(0.05, (hi - lo) / 400).toFixed(2);
          section.pos = (lo + hi) / 2; sl.value = section.pos;
          document.getElementById('sv-pos-val').textContent = section.pos.toFixed(1) + ' mm';
        }
        [_edgeMat, _edgeMatSel, _edgeMatHover].forEach(m => { m.clippingPlanes = on ? [section.plane] : null; m.needsUpdate = true; });
        updateSectionPlane(); syncSection();
        banner(on ? 'Section view on — drag the slider to move the cut. The model itself is not changed.' : 'Section view off.');
      }
      function wireSectionPanel() {
        const $s = id => document.getElementById(id);
        document.querySelectorAll('#sv-axis .toggle-btn').forEach(b => b.onclick = () => {
          document.querySelectorAll('#sv-axis .toggle-btn').forEach(x => x.classList.toggle('active', x === b));
          section.axis = b.dataset.axis;
          const bb = sectionBounds(), lo = bb.min[section.axis], hi = bb.max[section.axis];
          const sl = $s('sv-pos'); sl.min = (lo - 1).toFixed(1); sl.max = (hi + 1).toFixed(1); sl.step = Math.max(0.05, (hi - lo) / 400).toFixed(2);
          section.pos = (lo + hi) / 2; sl.value = section.pos; $s('sv-pos-val').textContent = section.pos.toFixed(1) + ' mm';
          updateSectionPlane();
        });
        $s('sv-pos').oninput = e => { section.pos = +e.target.value; $s('sv-pos-val').textContent = section.pos.toFixed(1) + ' mm'; updateSectionPlane(); kickActive(300); };
        $s('sv-flip').onclick = () => { section.flip = !section.flip; updateSectionPlane(); };
        $s('sv-close').onclick = () => { if (section.on) openSectionPanel(); };
      }

      // ── Model info ──────────────────────────────────────────────────────────
      // Volume, surface area, size and a print-weight / filament estimate for the
      // selection (or everything), so a part can be costed before slicing.
      const MATERIALS = { PLA: 1.24, PETG: 1.27, TPU: 1.21, 'Nylon PA12': 1.01, ABS: 1.04, ASA: 1.07 };
      function measureObjects(list) {
        let vol = 0, area = 0, tris = 0, open = 0;
        const box = new THREE.Box3();
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
        list.forEach(root => root.traverse(m => {
          if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
          m.updateMatrixWorld(true); box.expandByObject(m);
          const g = m.geometry, p = g.attributes.position, idx = g.index;
          const N = idx ? idx.count : p.count;
          const Q = 1e3, ids = new Map(); let nv = 0; const edge = new Map();
          const vid = (v) => { const k = Math.round(v.x * Q) + ',' + Math.round(v.y * Q) + ',' + Math.round(v.z * Q); let i = ids.get(k); if (i === undefined) { i = nv++; ids.set(k, i); } return i; };
          for (let i = 0; i < N; i += 3) {
            a.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
            b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld);
            c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld);
            vol += a.dot(ab.copy(b).cross(c)) / 6;
            area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
            tris++;
            const va = vid(a), vb = vid(b), vc = vid(c);
            [[va, vb], [vb, vc], [vc, va]].forEach(([x, y]) => { if (x === y) return; const k = x < y ? x * 4194304 + y : y * 4194304 + x; edge.set(k, (edge.get(k) || 0) + 1); });
          }
          edge.forEach(v => { if (v === 1) open++; });
        }));
        return { vol: Math.abs(vol), area, tris, open, size: box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3()) };
      }
      function refreshModelInfo() {
        const $m = id => document.getElementById(id);
        const list = selected.length ? selected : objects.filter(o => o.visible && !o.userData.isSketch);
        if (!list.length) { $m('mi-out').innerHTML = '<div class="mi-empty">Nothing in the scene yet.</div>'; return; }
        const r = measureObjects(list);
        const dens = MATERIALS[$m('mi-mat').value] || 1.24;
        const infill = (+$m('mi-infill').value) / 100;
        const wall = +$m('mi-wall').value;
        const volCm3 = r.vol / 1000;
        // shell (walls + top/bottom) approximated as surface area × wall thickness
        const shell = Math.min(r.vol, r.area * wall) / 1000;
        const printed = shell + Math.max(0, volCm3 - shell) * infill;
        const grams = printed * dens;
        const metres = printed / (Math.PI * 0.0875 * 0.0875) / 100;   // 1.75 mm filament
        $m('mi-infill-val').textContent = Math.round(infill * 100) + '%';
        $m('mi-wall-val').textContent = wall.toFixed(1) + ' mm';
        const row = (k, v, cls) => `<div class="mi-row${cls ? ' ' + cls : ''}"><span>${k}</span><b>${v}</b></div>`;
        $m('mi-out').innerHTML =
          `<div class="mi-scope">${selected.length ? selected.length + ' selected object' + (selected.length > 1 ? 's' : '') : 'Whole scene (' + list.length + ' object' + (list.length > 1 ? 's' : '') + ')'}</div>` +
          row('Size (W × D × H)', `${r.size.x.toFixed(1)} × ${r.size.y.toFixed(1)} × ${r.size.z.toFixed(1)} mm`) +
          row('Volume', `${volCm3.toFixed(2)} cm³`) +
          row('Surface area', `${(r.area / 100).toFixed(1)} cm²`) +
          row('Triangles', r.tris.toLocaleString()) +
          row('Watertight', r.open ? `No — ${r.open} open edge${r.open > 1 ? 's' : ''} (try Repair mesh)` : 'Yes', r.open ? 'warn' : 'ok') +
          '<div class="mi-sep"></div>' +
          row('Solid weight', `${(volCm3 * dens).toFixed(1)} g`) +
          row('Estimated print', `${grams.toFixed(1)} g · ${metres.toFixed(2)} m`, 'hi');
      }
      function openModelInfo() {
        refreshModelInfo();
        document.getElementById('mi-backdrop').classList.add('open');
        document.getElementById('mi-dialog').classList.add('open');
      }
      function wireModelInfo() {
        const $m = id => document.getElementById(id);
        const sel = $m('mi-mat');
        if (sel && !sel.options.length) Object.keys(MATERIALS).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = `${k} (${MATERIALS[k]} g/cm³)`; sel.appendChild(o); });
        ['mi-mat', 'mi-infill', 'mi-wall'].forEach(id => { const el = $m(id); if (el) el.oninput = el.onchange = refreshModelInfo; });
        const close = () => { $m('mi-backdrop').classList.remove('open'); $m('mi-dialog').classList.remove('open'); };
        ['mi-close', 'mi-done', 'mi-backdrop'].forEach(id => { const el = $m(id); if (el) el.onclick = close; });
      }


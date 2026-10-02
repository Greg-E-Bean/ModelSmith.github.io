      // ══ Display engine (v1.9) ═══════════════════════════════════════════════
      // Everything that decides how the 3D view looks and how often it draws:
      //  • adaptive quality — full effects on a desktop, scaled back on a tablet,
      //    and the pixel ratio nudged down/up automatically if frames get slow;
      //  • studio lighting: soft shadows onto the plate, image-based reflections
      //    (generated here, so it stays fully offline) and a hemisphere fill;
      //  • crisp feature-edge outlines, a hover highlight and a live size box;
      //  • on-demand rendering: full frame rate while you interact, a slow 4 fps
      //    heartbeat when nothing is happening, nothing at all when hidden.
      const DISPLAY_KEY = 'modelsmith_display_v1';
      const display = Object.assign(
        { quality: 'auto', shadows: true, reflections: true, edges: true, hover: true, sizebox: true },
        (() => { try { return JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}') || {}; } catch (e) { return {}; } })()
      );
      function saveDisplay() { try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(display)); } catch (e) {} }

      // iPadOS reports itself as a Mac, so "Mac + multi-touch" means iPad.
      const IS_TABLET = ((navigator.maxTouchPoints || 0) > 0 && /iPad|iPhone|Android/.test(navigator.userAgent)) ||
        ((navigator.maxTouchPoints || 0) > 1 &&
         ((window.matchMedia && matchMedia('(pointer: coarse)').matches) || /Macintosh/.test(navigator.userAgent)));
      const DEVICE_DPR = window.devicePixelRatio || 1;
      const QUALITY = {
        high:     { dprMax: Math.min(DEVICE_DPR, 2),   shadowSize: 2048, edgeTriLimit: 160000 },
        balanced: { dprMax: Math.min(DEVICE_DPR, 1.5), shadowSize: 1024, edgeTriLimit: 90000 },
        saver:    { dprMax: 1,                         shadowSize: 1024, edgeTriLimit: 40000 }
      };
      function qualityTier() {
        if (display.quality !== 'auto') return display.quality;
        return IS_TABLET ? 'balanced' : 'high';
      }
      function qualityCfg() { return QUALITY[qualityTier()] || QUALITY.high; }
      let _dpr = 1;               // current (possibly adapted) pixel ratio
      const _frameTimes = [];      // recent frame intervals while actively drawing

      let _plate = null, _keyLight = null, _ambLight = null, _hemiLight = null, _envTex = null, _shadowCatcher = null;
      let _shadowsDirty = true, _lastShadowAt = 0;
      let _activeUntil = 0, _lastRender = 0, _lastFrameAt = 0;

      // Anything that edits the scene calls invalidate(); camera-only motion
      // calls invalidateView() so shadows aren't recomputed just for orbiting.
      function invalidateView() { _needsRender = true; }
      window.invalidateView3D = invalidateView;
      function kickActive(ms) { _activeUntil = Math.max(_activeUntil, performance.now() + (ms || 1200)); }

      function applyPixelRatio(v) {
        const cfg = qualityCfg();
        _dpr = Math.max(1, Math.min(cfg.dprMax, v));
        if (Math.abs(renderer.getPixelRatio() - _dpr) > 0.01) {
          renderer.setPixelRatio(_dpr);
          const c = document.getElementById('bld-viewport');
          renderer.setSize(c.clientWidth, c.clientHeight);
          _needsRender = true;
        }
      }

      // A small procedural "photo studio": dark room, one big overhead softbox,
      // a warm key panel and a cool fill. Pre-filtered once into an environment
      // map, which is what gives surfaces their soft reflections and form.
      function buildStudioEnvironment() {
        try {
          const pm = new THREE.PMREMGenerator(renderer);
          const env = new THREE.Scene();
          const room = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10),
            new THREE.MeshBasicMaterial({ color: 0x1c2027, side: THREE.BackSide }));
          env.add(room);
          const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: 0x0c0d10 }));
          floor.position.z = -4.9; env.add(floor);
          const panel = (w, h, x, y, z, k, hex) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide }));
            m.material.color.multiplyScalar(k);
            m.position.set(x, y, z); m.up.set(0, 0, 1); m.lookAt(0, 0, 0); env.add(m);
          };
          panel(6, 4, 0, 0, 4.9, 0.95, 0xffffff);     // overhead softbox
          panel(3, 4, 4.9, -2.5, 1.5, 1.1, 0xfff0dd); // warm key
          panel(3, 3, -4.9, 2, 1, 0.55, 0xd8e6ff);     // cool fill
          panel(8, 1, 0, 4.9, 0.5, 0.45, 0xffffff);    // rim strip
          const rt = pm.fromScene(env, 0.035);
          pm.dispose();
          env.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
          return rt.texture;
        } catch (e) { console.warn('Studio environment unavailable', e); return null; }
      }

      function setupDisplayEngine(ambLight, dirLight) {
        _ambLight = ambLight; _keyLight = dirLight;
        _hemiLight = new THREE.HemisphereLight(0xe4ecff, 0x2a241e, 0.0);
        _hemiLight.position.set(0, 0, 1);
        scene.add(_hemiLight);
        scene.add(_keyLight.target);
        _keyLight.shadow.bias = -0.0004;
        _keyLight.shadow.normalBias = 0.35;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.shadowMap.autoUpdate = false;

        // Invisible plane at the build plate that only shows shadows, so parts
        // read as sitting ON the plate instead of floating over a grid.
        // A slightly lighter, unlit build-plate surface under the grid gives the
        // shadows something to fall on (on the near-black background they were
        // invisible) and makes the printable area obvious at a glance.
        _plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ color: 0x161a20, depthWrite: true }));
        _plate.position.z = -0.06; _plate.renderOrder = -2;
        _plate.raycast = () => {}; _plate.userData.isHelper = true;
        scene.add(_plate);
        _shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
          new THREE.ShadowMaterial({ opacity: 0.55, depthWrite: false }));
        _shadowCatcher.position.z = -0.03;
        _shadowCatcher.raycast = () => {};
        _shadowCatcher.receiveShadow = true;
        _shadowCatcher.renderOrder = -1;
        _shadowCatcher.userData.isHelper = true;
        scene.add(_shadowCatcher);

        _envTex = buildStudioEnvironment();
        applyDisplaySettings();
        setupDisplayDialog();
        setupTools3D();
        applyPixelRatio(qualityCfg().dprMax);

        // Size changes that aren't window resizes (sidebar drag, panels opening,
        // rotating an iPad) — without this the view stretched until the next
        // window resize. Re-render straight away so the canvas never flashes blank.
        const vp = document.getElementById('bld-viewport');
        if (window.ResizeObserver) {
          new ResizeObserver(() => {
            const w = vp.clientWidth, h = vp.clientHeight;
            if (!w || !h) return;
            camera.aspect = w / h; camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            _needsRender = true; renderFrame(performance.now());
          }).observe(vp);
        }

        // Any real input wakes the loop to full rate for a moment. Plain mouse
        // hovering elsewhere in the UI doesn't — that's where the idle savings are.
        const wake = () => { kickActive(1500); _shadowsDirty = true; };
        ['pointerdown', 'pointerup', 'keydown', 'keyup', 'input', 'change', 'wheel'].forEach(ev =>
          window.addEventListener(ev, wake, { passive: true, capture: true }));
        window.addEventListener('pointermove', e => { if (e.buttons) wake(); }, { passive: true, capture: true });
        // Moving over the view itself keeps frames flowing — tool previews (sketch
        // rubber-band lines, gizmo axis highlights, measure) follow the pointer.
        vp.addEventListener('pointermove', e => { kickActive(350); onHoverMove(e); }, { passive: true });
        vp.addEventListener('pointerleave', () => setHovered(null));
        vp.addEventListener('dblclick', onViewportDoubleClick);

        // Bigger gizmo handles on touch screens — easier to grab with a finger.
        if (IS_TABLET && transformControl.setSize) transformControl.setSize(1.3);
        // Hold Shift while rotating to snap to 15° steps.
        window.addEventListener('keydown', e => { if (e.key === 'Shift' && transformControl.setRotationSnap) transformControl.setRotationSnap(THREE.MathUtils.degToRad(15)); });
        const restoreRot = () => transformControl.setRotationSnap(snap.rotate ? THREE.MathUtils.degToRad(snap.rotate) : null);
        window.addEventListener('keyup',   e => { if (e.key === 'Shift') restoreRot(); });
        window.addEventListener('blur',    restoreRot);

        // While dragging the gizmo, the size tag becomes a live readout of how far
        // the part has moved (or its angles, when rotating).
        transformControl.addEventListener('dragging-changed', e => {
          _dragStartCentre = null; _sizeKey = '';
          if (e.value && selected.length) {
            const bx = new THREE.Box3(); selected.forEach(o => { o.updateMatrixWorld(true); bx.expandByObject(o); });
            if (!bx.isEmpty()) _dragStartCentre = bx.getCenter(new THREE.Vector3());
          }
        });

        controls.dampingFactor = 0.14;     // settles quickly instead of drifting
        controls.rotateSpeed = 0.9;
        controls.zoomSpeed = 1.1;
        controls.screenSpacePanning = true;
      }

      function applyDisplaySettings() {
        const refl = display.reflections && !!_envTex;
        scene.environment = refl ? _envTex : null;
        // Rebalance the lights so the scene is equally bright with or without
        // reflections (the environment contributes a lot of the fill light).
        _ambLight.intensity  = refl ? 0.07 : 0.40;
        _hemiLight.intensity = refl ? 0.24 : 0.28;
        _keyLight.intensity  = refl ? 0.62 : 0.72;
        const sh = display.shadows && qualityTier() !== 'saver';
        renderer.shadowMap.enabled = sh;
        _keyLight.castShadow = sh;
        _shadowCatcher.visible = sh;
        const size = qualityCfg().shadowSize;
        if (_keyLight.shadow.mapSize.x !== size) {
          _keyLight.shadow.mapSize.set(size, size);
          if (_keyLight.shadow.map) { _keyLight.shadow.map.dispose(); _keyLight.shadow.map = null; }
        }
        // Materials must recompile when shadows/environment switch on or off.
        scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
        if (!display.hover) setHovered(null);
        _frameTimes.length = 0;
        applyPixelRatio(qualityCfg().dprMax);
        _shadowsDirty = true; _needsRender = true;
      }
      window.msDisplay = { get: () => Object.assign({}, display),
        set: (k, v) => { display[k] = v; saveDisplay(); applyDisplaySettings(); },
        tier: qualityTier, dpr: () => _dpr,
        debug: () => ({ key: _keyLight, catcher: _shadowCatcher, env: _envTex, edges: edgeGroup }) };



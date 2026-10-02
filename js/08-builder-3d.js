
    // ═══════════════════════════════════════════════════════════════════════════
    //   CORE ARCHITECTURE & STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════
    const Builder = (function() {
      let scene, camera, renderer, grid, controls, transformControl;
      let currentGridSize = 300; // grows automatically as bigger objects are added
      let objects = [];
      let selected = []; 
      let sketchLayerCount = 0;
      let clipboard = null;   // stored geometry/material for copy → paste
      let lastImage3DFile = null;   // remembers the last image for Image→3D re-generation
      let multiSelectMode = false;   // when on, plain clicks add/remove from the selection
      let shiftHeld = false;         // Shift key currently down (aspect-lock while sketching/scaling)
      let aspectLock3D = false;      // touch toggle equivalent of holding Shift
      let groupPivot = null;         // invisible anchor the gizmo drives when 2+ objects are selected
      let snapEnabled = false;       // face-snapping: dragged objects snap flush to others
      let centerSnapEnabled = false; // centre/inline snapping: line up object middles
      let _dragTruePos = null;       // true unsnapped position tracked during a gizmo drag
      let _scaleStart = null;        // object scale captured at drag start, for Shift-uniform scaling
      const SNAP_DIST = 3;           // world-mm proximity that triggers a snap
      let pivotPrevMatrix = null;    // last pivot world matrix, to compute per-frame deltas
      let movePivot = null;          // invisible, never-rotated proxy the Move gizmo drives —
                                      // keeps the arrows world-axis-aligned no matter the
                                      // real object's own rotation, so "up" always means +Z
      let moveGizmoTarget = null;    // the real object/groupPivot the move proxy is puppeting
      const movePivotLastPos = new THREE.Vector3();
      
      let historyTimeline = [];
      let historyIndex = -1;
      const HISTORY_LIMIT = 60;   // how many steps the history panel keeps
      let currentMode = 'select'; 
      let isMouseDown = false;

      let activeSketch = {
        plane: new THREE.Plane(new THREE.Vector3(0,0,1), 0),
        origin: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(),
        gridVisual: null,
        segments: [], 
        tempPoints: [], 
        arcStage: 0, 
        visualizerGroup: new THREE.Group(),
        tool: null,
        isSnapped: false,
        undoStack: [],   // snapshots of `segments` before each drawn element (for sketch undo)
        redoStack: []
      };

      let sculptBrush = {
        type: 'add',
        radius: 15,
        intensity: 3,
        ring: null   // circular cursor showing brush footprint on the surface
      };

      let sliceState = {
        armed: false,
        // Rotation of the cut plane about each of the three build-plate axes
        // (X = left/right, Y = forward/back, Z = up/down — see computeSliceNormal).
        // At all-zero the plane is flat, i.e. a horizontal cut.
        rotX: 0, rotY: 0, rotZ: 0,
        offset: 0,
        keep: 'both',
        planeHelper: null,
        dragging: false,     // true while the plane itself is being dragged
        customNormal: null   // set when the plane is rotated by hand
      };

      let pushDir = 'pull';   // 'pull' = extrude along +normal, 'push' = along -normal

      // Solid-fillet edge selection state
      let filletState = {
        mesh: null,          // the mesh whose edges we're picking
        edges: [],           // detected feature edges [{a:Vec3, b:Vec3, faceN1, faceN2, key}]
        picked: new Set(),   // indices into edges[] that are selected
        hovered: -1,         // index of edge under the cursor
        lineGroup: null,     // THREE.Group holding highlight lines
        highlightMat: null,
        pickMat: null,
        hoverMat: null
      };

      let paintMode = 'brush';        // 'brush' = freehand radius paint, 'face' = flood one face, 'object' = whole mesh
      let paintColor = '#c2895f';     // current paint colour
      let paintBrushSize = 6;         // world-mm radius of the paint brush
      let paintOpacity = 1;           // 0..1 — brush opacity (lower builds up gradually)
      let paintStroke = { active: false, mesh: null, lastWorld: null };  // tracks an in-progress brush drag

      // Ruler / measuring tool state — never touches `objects`, so it can't be
      // selected, exported, or undone; it's purely a visual guide.
      let measureState = { p1: null, p2: null, marker1: null, marker2: null, line: null, preview: null, label: null };

      // Direct face push/pull: click any flat face on a solid (tessellated into
      // many triangles or not) to select it, then Apply extends/insets it.
      // Push/pull can hold several picked faces at once. Each entry is
      // {mesh, triIndex, highlightMesh}. Applying push/pull acts on all of them.
      let pushPullFaceState = { faces: [] };

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const lastPointerScreen = { x: 0, y: 0 };   // for positioning the length overlay
      let dimTypedActive = false;                  // true while the length box has a typed value

      function start() {
        // Default Euler order for every new object's .rotation is 'ZYX' instead
        // of three.js's usual 'XYZ'. This matters for the Rotate HUD: with 'ZYX'
        // the Z angle is applied first, about the untouched world Z axis, and X/Y
        // (roll/pitch) are layered on top of that afterwards — so editing the Z
        // field always spins the object about true world-up, no matter what its
        // current tilt is. With the default 'XYZ' order, Z would be the *last*
        // rotation applied, about whatever direction the object's own local Z
        // axis had already been tilted to — i.e. it'd follow the shape instead
        // of staying vertical, which was the actual bug.
        THREE.Euler.DefaultOrder = 'ZYX';

        const container = document.getElementById('bld-viewport');
        scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d0f12);
        // Soft vertical backdrop (lighter at the horizon) instead of a flat void.
        try {
          const bgc = document.createElement('canvas'); bgc.width = 4; bgc.height = 256;
          const bx = bgc.getContext('2d'); const gr = bx.createLinearGradient(0, 0, 0, 256);
          gr.addColorStop(0, '#0a0c10'); gr.addColorStop(0.55, '#141920'); gr.addColorStop(1, '#0d1014');
          bx.fillStyle = gr; bx.fillRect(0, 0, 4, 256);
          const bt = new THREE.CanvasTexture(bgc); bt.magFilter = THREE.LinearFilter; bt.minFilter = THREE.LinearFilter;
          scene.background = bt;
        } catch (e) {}

        camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 2000);
        // Z is the app's vertical (up/down) axis; X is left/right, Y is forward/back.
        camera.up.set(0, 0, 1);
        camera.position.set(120, -160, 130);   // front-right 3/4 view, matching the view cube's home

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.shadowMap.enabled = true;
        container.appendChild(renderer.domElement);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        // Any camera movement (orbit, pan, zoom, and the damping tail-off) needs
        // frames, so ask for them explicitly now that the loop idles when still.
        controls.addEventListener('change', () => { if (window.invalidateView3D) window.invalidateView3D(); });
        controls.enableDamping = true; controls.dampingFactor = 0.05;
        controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
        // One-finger touch is left free for the app's own tools (select, drag,
        // sketch, sculpt, paint, fillet-pick, measure) — same idea as LEFT being
        // null above. Two fingers pinch-zoom and rotate the camera.
        controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };

        transformControl = new THREE.TransformControls(camera, renderer.domElement);
        transformControl.setSpace('world'); 
        movePivot = new THREE.Object3D(); movePivot.visible = false; scene.add(movePivot);
        transformControl.addEventListener('dragging-changed', e => { 
          controls.enabled = !e.value;
          invalidate();
          // Track when the slice plane itself is the thing being dragged.
          sliceState.dragging = e.value && transformControl.object === sliceState.planeHelper;
          if (e.value) {
            // starting a drag — seed the true position from where the object is now
            _dragTruePos = moveGizmoTarget ? moveGizmoTarget.position.clone() : null;
            // Remember the scale at grab time so Shift-uniform scaling can measure
            // which axis the user pulled and mirror it onto the others.
            const so = transformControl.object;
            _scaleStart = so ? so.scale.clone() : null;
          } else {
            _dragTruePos = null;   // drag ended; snapped position (if any) is committed
            _scaleStart = null;
            saveHistory();
          }
        });
        transformControl.addEventListener('change', updateFloatingHUD);
        // Move gizmo always drives `movePivot`, which never rotates — so its
        // arrows stay locked to true world X/Y/Z no matter how the selected
        // object is oriented. Each frame we take however far the proxy moved
        // and apply that same world-space delta straight to the real object's
        // position, leaving its rotation untouched. Face snapping (below)
        // then nudges the real object, and we resync the (invisible) proxy
        // back onto it so next frame's delta is measured correctly again.
        transformControl.addEventListener('objectChange', () => {
          invalidate();
          if (moveGizmoTarget && transformControl.object === movePivot) {
            // Stability guard: if the thing we're puppeting was removed from the
            // scene (deleted, sliced, replaced by a boolean) mid-interaction, stop
            // rather than write to a detached object and corrupt state.
            if (moveGizmoTarget !== groupPivot && !moveGizmoTarget.parent) {
              transformControl.detach(); moveGizmoTarget = null; _dragTruePos = null; return;
            }
            const delta = movePivot.position.clone().sub(movePivotLastPos);
            // Accumulate the drag on the object's TRUE, unsnapped position. Snapping
            // then computes a fresh offset from that each frame instead of stacking
            // on top of the previous frame's snap — which is what made the object
            // fight the finger and dodge, especially on touch where frames jump.
            if (!_dragTruePos) _dragTruePos = moveGizmoTarget.position.clone();
            _dragTruePos.add(delta);
            moveGizmoTarget.position.copy(_dragTruePos);
            if ((snapEnabled || centerSnapEnabled) && transformControl.getMode() === 'translate') applyObjectSnap();
            // proxy follows the true position so next delta is measured cleanly
            movePivot.position.copy(_dragTruePos);
            movePivotLastPos.copy(movePivot.position);
          } else if ((snapEnabled || centerSnapEnabled) && transformControl.getMode() === 'translate') {
            applyObjectSnap();
          }
          // Shift-uniform scaling: in scale mode, when Shift is held (or the toggle is
          // on), whichever axis the user drags is mirrored onto the other two so the
          // object grows evenly and keeps its proportions.
          if (transformControl.getMode() === 'scale' && (shiftHeld || aspectLock3D) && _scaleStart) {
            const o = transformControl.object;
            if (o && o.scale) {
              // Find the axis that changed most relative to its starting value.
              const rx = o.scale.x / (_scaleStart.x || 1);
              const ry = o.scale.y / (_scaleStart.y || 1);
              const rz = o.scale.z / (_scaleStart.z || 1);
              // Pick the ratio furthest from 1 — that's the one the user is pulling.
              let r = rx;
              if (Math.abs(rz - 1) > Math.abs(r - 1)) r = rz;
              if (Math.abs(ry - 1) > Math.abs(rx - 1) && Math.abs(ry - 1) > Math.abs(rz - 1)) r = ry;
              o.scale.set(_scaleStart.x * r, _scaleStart.y * r, _scaleStart.z * r);
              o.updateMatrixWorld(true);
            }
          }
        });
        scene.add(transformControl);

        const ambLight = new THREE.AmbientLight(0xffffff, 0.5); scene.add(ambLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(100, 50, 200); scene.add(dirLight);
        setupDisplayEngine(ambLight, dirLight);

        // The build plate is the horizontal (X/Y) plane at Z=0. GridHelper is
        // authored lying flat in the X/Z plane by default, so tip it up onto X/Y.
        grid = new THREE.GridHelper(300, 30, 0xc2895f, 0x262b34); scene.add(grid);
        grid.rotation.x = Math.PI / 2;
        grid.material.opacity = 0.5; grid.material.transparent = true;
        currentGridSize = 300;

        const pMat = new THREE.MeshBasicMaterial({ color: 0x3d8ef5, wireframe: true, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
        activeSketch.gridVisual = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 20, 20), pMat);
        activeSketch.gridVisual.visible = false; scene.add(activeSketch.gridVisual);
        scene.add(activeSketch.visualizerGroup);

        // Slice plane visual (orange), hidden until armed
        const sliceMat = new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
        sliceState.planeHelper = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMat);
        const sliceEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1,1)), new THREE.LineBasicMaterial({ color: 0xf5a623 }));
        sliceState.planeHelper.add(sliceEdge);
        sliceState.planeHelper.visible = false;
        scene.add(sliceState.planeHelper);

        // Sculpt brush ring cursor — a flat ring of unit radius (scaled to brush
        // size) that we lay tangent to the surface under the pointer so you can
        // see exactly where and how big the brush footprint is.
        const ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x2dd4a0, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false });
        sculptBrush.ring = new THREE.Mesh(ringGeo, ringMat);
        sculptBrush.ring.renderOrder = 999;
        sculptBrush.ring.visible = false;
        scene.add(sculptBrush.ring);

        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        renderer.domElement.addEventListener('pointermove', onPointerMove);
        renderer.domElement.addEventListener('pointerup', onPointerUp);
        window.addEventListener('keydown', onKeyDown);
        // Track Shift globally so sketch shapes and the scale gizmo can lock aspect
        // ratio while it's held (mirrors the paint studio's Shift behaviour).
        window.addEventListener('keydown', e => { if (e.key === 'Shift') shiftHeld = true; });
        window.addEventListener('keyup',   e => { if (e.key === 'Shift') shiftHeld = false; });
        window.addEventListener('blur',    () => { shiftHeld = false; });
        renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

        setupDOMEvents(); 
        saveHistory(); 
        animate(); 
        updateStatus();
        setActiveTool('select');   // set up initial panel visibility
        restoreUploadedFonts();    // bring back any fonts the user uploaded before

        // Crash recovery: if a previous session was auto-saved, offer to restore it.
        // Do this after init so the scene/renderer exist. We don't auto-clobber an
        // (empty) fresh scene's save until the user decides.
        // Wait for the database read before deciding whether there's anything to
        // recover — otherwise a session stored in IndexedDB would look absent.
        primeSessionCache().then(() => offerSessionRecovery());
        function offerSessionRecovery() {
        const savedSession = loadSessionData();
        if (savedSession && savedSession.objects && savedSession.objects.length) {
          const secs = Math.round((Date.now() - (savedSession.savedAt||Date.now()))/1000);
          const when = secs < 90 ? 'a moment ago' : secs < 3600 ? `about ${Math.round(secs/60)} minutes ago` : `about ${Math.round(secs/3600)} hours ago`;
          setTimeout(() => {
            if (confirm(`ModelSmith found an unsaved session from ${when} (${savedSession.objects.length} object${savedSession.objects.length!==1?'s':''}).\n\nRestore it?`)) {
              restoreSession(savedSession);
            } else {
              // keep it on disk until they actually build something new, so a
              // mis-tap doesn't lose their work permanently.
            }
            updateSessionStatus();
          }, 400);
        }
        }

        // Periodic safety save, plus a final save when the tab is hidden/closed
        // (covers iOS swipe-away and browser crashes reasonably well).
        setInterval(autosaveTick, 20000);
        document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); });
        window.addEventListener('pagehide', saveSession);
        window.addEventListener('beforeunload', saveSession);

        banner("Systems Initialized. Ready to build.");
      }

      // Render loop.
      //
      // Previously this rendered the 3D scene ~60 times a second no matter what —
      // including the entire time you were working in the 2D studio, and while the
      // app sat in the background. On a tablet that's a constant drain for no
      // benefit. Now it skips the work when the 3D view isn't actually on screen,
      // and idles at a low tick rate when nothing is moving, waking instantly on any
      // interaction.
      // Kept as a hook so callers can signal "something changed" — it also forces a
      // resize/redraw when returning from the 2D studio.
      function invalidate() { _needsRender = true; _shadowsDirty = true; }
      let _needsRender = true;
      window.invalidate3D = invalidate;

      function animate() {
        requestAnimationFrame(animate);
        // Not visible? Do nothing at all.
        if (document.hidden) return;
        const paintEl = document.getElementById('paint-app');
        if (paintEl && paintEl.style.display !== 'none') return;

        const now = performance.now();
        stepCameraTween(now);
        if (controls && controls.update()) _needsRender = true;   // orbit / damping tail
        if (sliceState.armed) { updateSlicePlaneHelper(); _needsRender = true; }
        if (_thumbWanted) _needsRender = true;

        // On-demand drawing: every frame while something is happening, a 4 fps
        // heartbeat otherwise (which also catches any change that forgot to ask
        // for a redraw). Resizes redraw immediately (see the ResizeObserver),
        // which was the real cause of the old "blank viewport" problem.
        const active = now < _activeUntil;
        if (!_needsRender && !active && now - _lastRender < 250) { _lastFrameAt = 0; return; }
        adaptResolution(now);
        renderFrame(now);
      }

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

      // ── Fillet / edge rounding ──────────────────────────────────────────
      // Welds a soup into unique vertices + triangle indices so we can reason
      // about which vertices share an edge/corner.
      function weldGeometry(geometry, precision = 4) {
        const pos = geometry.toNonIndexed().attributes.position;
        const map = new Map(); const unique = []; const indices = [];
        const key = (x,y,z)=>`${x.toFixed(precision)}_${y.toFixed(precision)}_${z.toFixed(precision)}`;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const k = key(x,y,z);
          let id = map.get(k);
          if (id === undefined) { id = unique.length; unique.push(new THREE.Vector3(x,y,z)); map.set(k, id); }
          indices.push(id);
        }
        return { verts: unique, indices };
      }

      // Rounds sharp edges of the selected solid by subdividing then running a few
      // constrained smoothing passes weighted toward high-curvature (edge/corner)
      // vertices, so flat faces stay flat and only the sharp transitions soften.
      // ═══════════════════════════════════════════════════════════════════════
      //   SELECTIVE EDGE FILLET (box / extrusion solids)
      //   Detect feature edges → let the user pick some → replace each picked edge
      //   with a real tangent arc of the chosen radius (not a global smooth).
      // ═══════════════════════════════════════════════════════════════════════

      const V3 = () => new THREE.Vector3();
      function keyOfPoint(p, prec = 3) {
        return `${p.x.toFixed(prec)}_${p.y.toFixed(prec)}_${p.z.toFixed(prec)}`;
      }

      // Weld near-identical points to a single representative.
      //
      // Slicing and booleans compute the same physical corner via two different
      // interpolations, so the results can differ by a few nanometres. Plain
      // rounding (keyOfPoint) then puts them in different buckets whenever they
      // straddle a rounding boundary — 4.999501 and 4.999499 are 2e-6 apart but
      // round to "5.000" and "4.999". Edge matching would then see one face per
      // edge instead of two and silently drop it, which is why "slice then fillet"
      // lost edges and cut faces developed gaps.
      //
      // This checks the 27 neighbouring cells around a point, so a match is found
      // regardless of which side of a boundary each copy landed on.
      function makeWelder(tol = 1e-3) {
        const cells = new Map();
        const cs = tol * 2;                       // cell size
        const ci = (v) => Math.floor(v / cs);
        return function weld(p) {
          const x = ci(p.x), y = ci(p.y), z = ci(p.z);
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dz = -1; dz <= 1; dz++) {
                const bucket = cells.get(`${x+dx}_${y+dy}_${z+dz}`);
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                  if (bucket[i].distanceToSquared(p) <= tol * tol) return bucket[i];
                }
              }
          const k = `${x}_${y}_${z}`;
          if (!cells.has(k)) cells.set(k, []);
          const rep = p.clone();
          cells.get(k).push(rep);
          return rep;                             // first occurrence becomes the representative
        };
      }

      // Build the list of feature edges of a mesh: edges shared by exactly two
      // triangles whose face normals differ by more than ~20° (a real model edge,
      // not a seam inside a flat face). Coplanar neighbours are ignored.
      function detectFeatureEdges(mesh) {
        mesh.updateMatrixWorld(true);
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = g.attributes.position;
        const m = mesh.matrixWorld;

        // Map each undirected edge → list of {faceNormal, triIndex}
        // Points are welded first so that vertices which should be identical but
        // differ by a hair (slice/boolean output) still land on the same edge key.
        const weld = makeWelder(1e-3);
        const edgeMap = new Map();
        const addEdge = (pa, pb, n, tri, pc) => {
          const wa = weld(pa), wb = weld(pb);
          const ka = keyOfPoint(wa), kb = keyOfPoint(wb);
          if (ka === kb) return;                 // degenerate (zero-length) edge
          const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          if (!edgeMap.has(key)) edgeMap.set(key, { a: wa.clone(), b: wb.clone(), faces: [] });
          edgeMap.get(key).faces.push({ n: n.clone(), tri, c: pc });
        };

        for (let i = 0; i < pos.count; i += 3) {
          const p0 = V3().fromBufferAttribute(pos, i).applyMatrix4(m);
          const p1 = V3().fromBufferAttribute(pos, i+1).applyMatrix4(m);
          const p2 = V3().fromBufferAttribute(pos, i+2).applyMatrix4(m);
          const n = V3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0)).normalize();
          addEdge(p0, p1, n, i/3, p2); addEdge(p1, p2, n, i/3, p0); addEdge(p2, p0, n, i/3, p1);
        }

        // Keep edges with a sharp dihedral angle between adjacent faces. We accept
        // edges shared by 2 OR MORE faces: slicing and booleans produce T-junctions
        // where a cut edge is touched by extra triangles, so requiring exactly 2
        // faces (as before) silently dropped those edges and made "slice then fillet"
        // fail. Taking the sharpest face pair at each edge recovers them.
        const raw = [];
        edgeMap.forEach(e => {
          if (e.faces.length < 2) return;
          // find the pair of faces with the largest dihedral angle
          let bestAngle = 0, bn1 = null, bn2 = null, bc1 = null, bc2 = null;
          for (let i = 0; i < e.faces.length; i++) {
            for (let j = i + 1; j < e.faces.length; j++) {
              const dot = Math.max(-1, Math.min(1, e.faces[i].n.dot(e.faces[j].n)));
              const ang = Math.acos(dot) * 180 / Math.PI;
              if (ang > bestAngle) { bestAngle = ang; bn1 = e.faces[i].n; bn2 = e.faces[j].n; bc1 = e.faces[i].c; bc2 = e.faces[j].c; }
            }
          }
          if (bestAngle > 20) raw.push({ a: e.a, b: e.b, n1: bn1, n2: bn2, c1: bc1, c2: bc2, ang: bestAngle });
        });

        return mergeCollinearEdges(raw);
      }

      // Chain raw edge fragments that are collinear and connected into single edges,
      // so clicking selects a whole box edge rather than one tessellated slice of it.
      function mergeCollinearEdges(raw) {
        const used = new Array(raw.length).fill(false);
        const merged = [];
        const dirOf = (e) => e.b.clone().sub(e.a).normalize();

        for (let i = 0; i < raw.length; i++) {
          if (used[i]) continue;
          used[i] = true;
          let chain = { a: raw[i].a.clone(), b: raw[i].b.clone(), n1: raw[i].n1, n2: raw[i].n2, c1: raw[i].c1, c2: raw[i].c2, ang: raw[i].ang };
          let d = dirOf(raw[i]);
          let extended = true;
          while (extended) {
            extended = false;
            for (let j = 0; j < raw.length; j++) {
              if (used[j]) continue;
              const dj = dirOf(raw[j]);
              if (Math.abs(Math.abs(d.dot(dj)) - 1) > 1e-3) continue; // not parallel
              // connects to either end, collinearly?
              const eps = 1e-3;
              if (raw[j].a.distanceTo(chain.b) < eps) { chain.b = raw[j].b.clone(); used[j]=true; extended=true; }
              else if (raw[j].b.distanceTo(chain.b) < eps) { chain.b = raw[j].a.clone(); used[j]=true; extended=true; }
              else if (raw[j].b.distanceTo(chain.a) < eps) { chain.a = raw[j].a.clone(); used[j]=true; extended=true; }
              else if (raw[j].a.distanceTo(chain.a) < eps) { chain.a = raw[j].b.clone(); used[j]=true; extended=true; }
            }
          }
          chain.mid = chain.a.clone().add(chain.b).multiplyScalar(0.5);
          chain.len = chain.a.distanceTo(chain.b);
          merged.push(chain);
        }
        return merged;
      }

      // Enter edge-pick mode for the selected solid: detect edges and draw them faint.
      function beginFilletEdgePicking() {
        clearFilletHighlights();
        if (selected.length === 0 || selected[0].userData.isSketch || !selected[0].geometry) {
          document.getElementById('fillet-hint').textContent = 'Select a solid first, then click its edges.';
          return;
        }
        const mesh = selected[0];
        filletState.mesh = mesh;
        filletState.edges = detectFeatureEdges(mesh);
        filletState.picked = new Set();
        filletState.hovered = -1; filletState.hoverSet = null; filletState._adj = null;

        if (!filletState.lineGroup) {
          filletState.lineGroup = new THREE.Group();
          scene.add(filletState.lineGroup);
          filletState.baseMat  = new THREE.LineBasicMaterial({ color: 0x8092aa, transparent: true, opacity: 0.75, depthTest: false });
          // Picked / hovered edges are drawn as solid tubes (below), so these use
          // bright unlit materials for a bold, clear highlight.
          filletState.hoverMat = new THREE.MeshBasicMaterial({ color: 0xffb703, depthTest: false });
          filletState.pickMat  = new THREE.MeshBasicMaterial({ color: 0xff7a1a, depthTest: false });
        }
        renderFilletEdges();
        updateFilletCount();
        document.getElementById('fillet-hint').textContent =
          filletState.edges.length ? 'Click an edge to pick it. Click again to unpick.' : 'No sharp edges detected on this solid.';
      }

      function clearFilletHighlights() {
        if (filletState.lineGroup) {
          while (filletState.lineGroup.children.length) {
            const c = filletState.lineGroup.children[0];
            filletState.lineGroup.remove(c); if (c.geometry) c.geometry.dispose();
          }
        }
      }

      function renderFilletEdges() {
        clearFilletHighlights();
        if (!filletState.lineGroup) return;
        // Scale the highlight-tube radius to the model so it reads clearly on both
        // tiny and large parts.
        let tubeR = 0.5;
        if (filletState.mesh) {
          const box = new THREE.Box3().setFromObject(filletState.mesh);
          const size = new THREE.Vector3(); box.getSize(size);
          tubeR = Math.max(0.25, Math.min(2.2, size.length() * 0.006));
        }
        filletState.edges.forEach((e, idx) => {
          const isPicked = filletState.picked.has(idx);
          const isHover = filletState.hoverSet ? filletState.hoverSet.has(idx) : idx === filletState.hovered;
          if (isPicked || isHover) {
            // Bold tube along the edge for a clear, thick highlight.
            const dir = e.b.clone().sub(e.a);
            const len = dir.length();
            if (len < 1e-6) return;
            const geo = new THREE.CylinderGeometry(tubeR, tubeR, len, 6, 1);
            const tube = new THREE.Mesh(geo, isHover ? filletState.hoverMat : filletState.pickMat);
            // orient the cylinder (default +Y) along the edge, centre it on the edge
            tube.position.copy(e.a).add(e.b).multiplyScalar(0.5);
            tube.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
            tube.renderOrder = 999;
            filletState.lineGroup.add(tube);
          } else {
            const geo = new THREE.BufferGeometry().setFromPoints([e.a, e.b]);
            const line = new THREE.Line(geo, filletState.baseMat);
            line.renderOrder = 998;
            filletState.lineGroup.add(line);
          }
        });
      }

      function updateFilletCount() {
        const el = document.getElementById('fillet-count');
        if (el) el.textContent = filletState.picked.size;
      }

      function clearFilletPicks() {
        filletState.picked = new Set();
        filletState.hovered = -1; filletState.hoverSet = null;
        renderFilletEdges(); updateFilletCount();
        document.getElementById('fillet-hint').textContent = 'Picks cleared. Click an edge to pick it.';
      }

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

      // ── Ruler / measuring tool ──────────────────────────────────────────
      // Draws a small marker at each clicked point and a dashed "ghost" line
      // between them with a floating distance label. Nothing here is added to
      // `objects`, so it never gets selected, exported, or affects undo.
      // Points snap onto the nearest mesh vertex (corner/edge point) under the
      // cursor, judged in screen space so it works at any zoom level.
      let measureHoverMarker = null;

      function makeMeasureMarker(pt, color) {
        const geo = new THREE.SphereGeometry(1.3, 12, 12);
        const mat = new THREE.MeshBasicMaterial({ color: color || 0x5dd6ff, depthTest: false, transparent: true, opacity: 0.9 });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(pt);
        m.renderOrder = 999;
        scene.add(m);
        return m;
      }

      function makeMeasureLabelSprite(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 176; canvas.height = 50;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(18,20,26,0.88)';
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(2, 2, 172, 46, 9); ctx.fill(); }
        else { ctx.fillRect(2, 2, 172, 46); }
        ctx.strokeStyle = '#5dd6ff'; ctx.lineWidth = 2;
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(2, 2, 172, 46, 9); ctx.stroke(); }
        ctx.font = '600 20px "JetBrains Mono", monospace';
        ctx.fillStyle = '#eaf6ff';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 88, 26);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
        const spr = new THREE.Sprite(mat);
        spr.scale.set(9.5, 2.7, 1);
        spr.renderOrder = 1000;
        return spr;
      }

      // Project a world point to on-screen pixel coordinates (relative to the
      // viewport canvas) so snapping distance stays consistent at any zoom.
      function measureScreenPos(worldPt) {
        const p = worldPt.clone().project(camera);
        const rect = renderer.domElement.getBoundingClientRect();
        return { x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height };
      }

      // Look at every vertex of the hit mesh and snap onto the nearest one to
      // the cursor, provided it's within a small pixel radius. Returns null if
      // nothing is close enough, so the raw surface hit point is used instead.
      function findMeasureSnapVertex(obj, screenPt) {
        const geo = obj.geometry;
        if (!geo || !geo.attributes || !geo.attributes.position) return null;
        const pos = geo.attributes.position;
        const m = obj.matrixWorld;
        const v = new THREE.Vector3();
        const threshold = 20; // px
        let best = null, bestDist = threshold;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          const s = measureScreenPos(v);
          const dx = s.x - screenPt.x, dy = s.y - screenPt.y;
          const d = Math.sqrt(dx*dx + dy*dy);
          if (d < bestDist) { bestDist = d; best = v.clone(); }
        }
        return best;
      }

      // Resolves the point a measure click/hover should use right now: a
      // snapped vertex if one is close by, otherwise the raw raycast hit.
      // Returns { point, snapped } or null if nothing is under the cursor.
      function getMeasurePoint() {
        const selectable = objects.filter(o => o.visible);
        const intersects = raycaster.intersectObjects(selectable, true);
        if (!intersects.length) return null;
        const hit = intersects[0];
        const snapVertex = findMeasureSnapVertex(hit.object, lastPointerScreen);
        return snapVertex ? { point: snapVertex, snapped: true } : { point: hit.point.clone(), snapped: false };
      }

      function clearMeasurePreview() {
        if (measureState.preview) { scene.remove(measureState.preview); measureState.preview = null; }
      }

      function clearMeasureHover() {
        if (measureHoverMarker) { scene.remove(measureHoverMarker); measureHoverMarker = null; }
      }

      function clearMeasure() {
        [measureState.marker1, measureState.marker2, measureState.line, measureState.preview, measureState.label].forEach(o => {
          if (o) scene.remove(o);
        });
        measureState = { p1: null, p2: null, marker1: null, marker2: null, line: null, preview: null, label: null };
        const ro = document.getElementById('measure-readout'); if (ro) ro.textContent = '—';
      }

      function drawMeasureLine() {
        if (measureState.line) { scene.remove(measureState.line); measureState.line = null; }
        if (measureState.label) { scene.remove(measureState.label); measureState.label = null; }
        clearMeasurePreview();

        const geo = new THREE.BufferGeometry().setFromPoints([measureState.p1, measureState.p2]);
        const mat = new THREE.LineDashedMaterial({ color: 0x5dd6ff, dashSize: 3, gapSize: 2, depthTest: false, transparent: true, opacity: 0.95 });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.renderOrder = 998;
        scene.add(line);
        measureState.line = line;

        const dist = measureState.p1.distanceTo(measureState.p2);
        const mid = measureState.p1.clone().add(measureState.p2).multiplyScalar(0.5);
        const label = makeMeasureLabelSprite(dist.toFixed(2) + ' mm');
        label.position.copy(mid);
        scene.add(label);
        measureState.label = label;

        const ro = document.getElementById('measure-readout'); if (ro) ro.textContent = dist.toFixed(2) + ' mm';
        banner(`Distance: ${dist.toFixed(2)} mm — click again to start a new measurement.`);
      }

      // Runs on every pointer move while the ruler tool is active: shows a
      // hover marker at the point a click would land on right now (brighter
      // green when snapped to a vertex), and updates the live ghost preview
      // line once the first point has been placed.
      function updateMeasurePreview() {
        const found = getMeasurePoint();
        if (!found) { clearMeasureHover(); clearMeasurePreview(); return; }
        const { point: pt, snapped } = found;

        if (!measureHoverMarker) measureHoverMarker = makeMeasureMarker(pt, snapped ? 0x2dd4a0 : 0x5dd6ff);
        measureHoverMarker.position.copy(pt);
        measureHoverMarker.material.color.setHex(snapped ? 0x2dd4a0 : 0x5dd6ff);
        measureHoverMarker.visible = true;

        if (measureState.p1 && !measureState.p2) {
          if (measureState.preview) scene.remove(measureState.preview);
          const geo = new THREE.BufferGeometry().setFromPoints([measureState.p1, pt]);
          const mat = new THREE.LineDashedMaterial({ color: 0x5dd6ff, dashSize: 2, gapSize: 2, depthTest: false, transparent: true, opacity: 0.45 });
          const line = new THREE.Line(geo, mat);
          line.computeLineDistances();
          line.renderOrder = 997;
          scene.add(line);
          measureState.preview = line;
        } else {
          clearMeasurePreview();
        }
      }

      function handleMeasureClick() {
        const found = getMeasurePoint();
        if (!found) { banner("⚠️ Click on a solid's surface (near a corner to snap) to place a measuring point."); return; }
        const pt = found.point;

        if (measureState.p1 && measureState.p2) clearMeasure();

        if (!measureState.p1) {
          measureState.p1 = pt;
          measureState.marker1 = makeMeasureMarker(pt);
          banner(found.snapped ? "Point 1 snapped to a vertex — click a second point to measure." : "Point 1 set — click a second point to measure the distance.");
        } else {
          measureState.p2 = pt;
          measureState.marker2 = makeMeasureMarker(pt);
          drawMeasureLine();
        }
      }

      function updateMouse(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        lastPointerScreen.x = e.clientX - rect.left;
        lastPointerScreen.y = e.clientY - rect.top;
        raycaster.setFromCamera(mouse, camera);
      }

      // Sketch snapping options — toggleable, so free drawing is still possible.
      let sketchSnap = { grid: false, gridSize: 5, points: true, angle: false, angleStep: 15 };

      function snapPoint(pt) {
        let snapRadius = 4.0;
        let closestPt = null;
        let minDist = snapRadius;
        activeSketch.isSnapped = false;

        // 1) Snap to existing endpoints and midpoints (geometry snapping).
        if (sketchSnap.points) {
          activeSketch.segments.forEach(seg => {
            const d1 = pt.distanceTo(seg.p1);
            if (d1 < minDist) { minDist = d1; closestPt = seg.p1.clone(); }
            const d2 = pt.distanceTo(seg.p2);
            if (d2 < minDist) { minDist = d2; closestPt = seg.p2.clone(); }
            // midpoint
            const mid = seg.p1.clone().add(seg.p2).multiplyScalar(0.5);
            const dm = pt.distanceTo(mid);
            if (dm < minDist) { minDist = dm; closestPt = mid; }
          });
        }

        if (closestPt) { pt.copy(closestPt); activeSketch.isSnapped = true; return pt; }

        // 2) Angle snap: constrain the line from the previous point to fixed angles.
        //    Only while a segment is in progress, and only if no geometry snap won.
        if (sketchSnap.angle && activeSketch.tempPoints && activeSketch.tempPoints.length) {
          const a = activeSketch.tempPoints[activeSketch.tempPoints.length - 1];
          const dx = pt.x - a.x, dy = pt.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.01) {
            const step = (sketchSnap.angleStep * Math.PI) / 180;
            const ang = Math.round(Math.atan2(dy, dx) / step) * step;
            pt.x = a.x + Math.cos(ang) * len;
            pt.y = a.y + Math.sin(ang) * len;
            activeSketch.isSnapped = true;
          }
        }

        // 3) Grid snap: round to the nearest grid cell (applied last, so a point
        //    snap or angle snap takes precedence when active).
        if (sketchSnap.grid && !activeSketch.isSnapped) {
          const g = sketchSnap.gridSize;
          pt.x = Math.round(pt.x / g) * g;
          pt.y = Math.round(pt.y / g) * g;
          activeSketch.isSnapped = true;
        }
        return pt;
      }

      function onPointerDown(e) {
        if (e.button !== 0 || (transformControl && transformControl.axis !== null)) return;
        isMouseDown = true;
        updateMouse(e);

        if (currentMode === 'sketching') { handleSketchDown(); return; }
        if (currentMode === 'sculpt') { handleSculptStroke(); return; }
        if (currentMode === 'measure') { handleMeasureClick(); return; }

        // Array centre pick: the next click on the model sets the rotation centre.
        if (arrayPickingCentre) {
          const hits = raycaster.intersectObjects(objects.filter(o => o.visible), true);
          if (hits.length) {
            arrayCentrePoint = hits[0].point.clone();
            const st = document.getElementById('array-centre-status');
            if (st) st.textContent = `Centre: picked point (${arrayCentrePoint.x.toFixed(1)}, ${arrayCentrePoint.y.toFixed(1)})`;
            banner("Rotation centre set. Now press Create array.");
          } else {
            banner("No surface there — click on your object to set the centre.");
          }
          arrayPickingCentre = false;
          currentMode = 'select';
          return;
        }

        // Fillet tool: clicking an edge picks/unpicks it (doesn't change selection).
        if (activeTool === 'fillet' && filletState.edges.length) {
          if (filletClickPick()) return;
        }

        // Push/Pull tool: clicking a face on a solid selects that face directly
        // (as an alternative to picking a baked sketch layer from the panel).
        // Shift-click or multi-select mode adds more faces to push/pull together.
        if (activeTool === 'pushpull') {
          if (handlePushPullFaceClick(e)) return;
        }

        // Paint tool: clicking the model paints it, doesn't select/transform.
        if (activeTool === 'paint') {
          handlePaintClick();
          return;
        }

        const selectable = objects.filter(o => o.visible);
        const intersects = raycaster.intersectObjects(selectable, true);

        if (currentMode === 'arm_plane') {
          if (intersects.length > 0) {
            const fn = intersects[0].face
              ? intersects[0].face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(intersects[0].object.matrixWorld)).normalize()
              : new THREE.Vector3(0, 0, 1);
            initSketchPlane(intersects[0].point, fn);
          } else initSketchPlane(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1));
          return;
        }

        if (intersects.length > 0) {
          let target = intersects[0].object;
          while (target.parent && target.parent !== scene && !target.userData.isSketch && target.parent !== groupPivot) { target = target.parent; }
          // if the hit object is currently parented under the group pivot, resolve to it
          if (target.parent === groupPivot) { /* keep target */ }

          if (activeTool === 'fillet') {
            selectOnly(target);
            transformControl.detach();
            beginFilletEdgePicking();
          } else if (multiSelectMode || e.shiftKey) {
            toggleInSelection(target);
          } else {
            selectOnly(target);
          }
        } else {
          // clicking empty space clears (unless holding shift, which keeps the set)
          if (!(multiSelectMode || e.shiftKey)) {
            clearSelection();
            if (activeTool === 'fillet') { clearFilletHighlights(); filletState.edges = []; }
          }
        }
        updateStatus(); updateFloatingHUD();
      }

      function onPointerMove(e) {
        updateMouse(e);
        if (currentMode === 'sketching') { handleSketchMove(); }
        else if (currentMode === 'sculpt') {
          updateSculptRing();
          if (isMouseDown) handleSculptStroke();
        }
        else if (activeTool === 'paint') {
          if (isMouseDown && paintMode === 'brush') handlePaintStroke();
        }
        else if (activeTool === 'fillet') { filletHover(); }
        else if (currentMode === 'measure') { updateMeasurePreview(); }
      }

      // Lays the ring cursor tangent to the surface under the pointer, sized to the
      // brush radius, so you always see the exact sculpt footprint.
      function updateSculptRing() {
        if (!sculptBrush.ring) return;
        const targetable = objects.filter(o => !o.userData.isSketch && o.visible);
        const hits = raycaster.intersectObjects(targetable, true);
        if (hits.length === 0) { sculptBrush.ring.visible = false; return; }
        const hit = hits[0];
        if (!hit.face) { sculptBrush.ring.visible = false; return; }
        // world-space surface normal
        const n = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
        sculptBrush.ring.position.copy(hit.point).addScaledVector(n, 0.05); // lift slightly to avoid z-fight
        sculptBrush.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        sculptBrush.ring.scale.setScalar(sculptBrush.radius);
        sculptBrush.ring.material.color.setHex(sculptBrush.type === 'add' ? 0x2dd4a0 : 0xf5a623);
        sculptBrush.ring.visible = true;
      }

      function onPointerUp() {
        if (isMouseDown && currentMode === 'sculpt') { saveHistory(); }
        if (activeTool === 'paint') endPaintStroke();
        isMouseDown = false;
      }

      function onKeyDown(e) {
        // The Paint studio has its own shortcuts; while it's on screen the 3D
        // workspace should ignore keys entirely (otherwise Ctrl+Z would undo the
        // 3D scene while the user is drawing).
        const pApp = document.getElementById('paint-app');
        if (pApp && pApp.style.display !== 'none') return;

        // Ignore shortcuts while typing in a text/number field so values can be edited freely.
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

        // Escape resets an in-progress sketch, regardless of focus.
        if (e.key === 'Escape' && currentMode === 'sketching') {
          if (activeSketch.tool === 'spline' && activeSketch.tempPoints.length >= 2) {
            sketchSnapshot();
            let pts = new THREE.SplineCurve(activeSketch.tempPoints).getPoints(50);
            for(let i=0; i<pts.length-1; i++) injectRawSegment(pts[i], pts[i+1]);
            splitAllIntersections();
          }
          activeSketch.tempPoints = [];
          activeSketch.arcStage = 0;
          renderSegments();
          hideDimOverlay();
          banner("Sketch input reset.");
          return;
        }

        // Escape clears the ruler tool's current measurement, regardless of focus.
        if (e.key === 'Escape' && currentMode === 'measure') {
          clearMeasure();
          banner("Measurement cleared.");
          return;
        }

        // While sketching, Ctrl+Z / Ctrl+Y (and Shift variants) undo/redo drawn
        // elements — handled before the typing guard so it works even when the
        // dimension box has focus.
        if (currentMode === 'sketching' && (e.ctrlKey || e.metaKey)) {
          const k = e.key.toLowerCase();
          if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); sketchUndo(); return; }
          if ((k === 'z' && e.shiftKey) || k === 'y' || k === 'r') { e.preventDefault(); e.stopPropagation(); sketchRedo(); return; }
        }

        if (typing) return;   // let inputs handle their own keys

        // F frames the selection (or everything if nothing is selected) — a standard
        // CAD shortcut for bringing lost geometry back into view.
        if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          frameObjects(selected.length ? selected : null);
          return;
        }

        const mod = e.ctrlKey || e.metaKey;   // support ⌘ on macOS too

        // Ctrl/Cmd shortcuts
        if (mod) {
          switch (e.key.toLowerCase()) {
            case 'z':
              e.preventDefault();
              if (e.shiftKey) triggerRedo(); else triggerUndo();
              return;
            case 'y':
              e.preventDefault(); triggerRedo(); return;
            case 'r':
              e.preventDefault(); triggerRedo(); return;   // Ctrl+R = redo (overrides page reload)
            case 'c':
              e.preventDefault(); copySelected(); return;
            case 'x':
              e.preventDefault(); cutSelected(); return;
            case 'v':
              e.preventDefault(); pasteClipboard(); return;
            case 'd':
              e.preventDefault(); duplicateSelected(); return;   // bonus: Ctrl+D duplicate
          }
          return;
        }

        // Plain keys
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault(); deleteSelected(); return;
        }
      }

      function setEmissive(obj, hex) {
        if (obj.material) {
          if (!Array.isArray(obj.material)) { if(obj.material.emissive) obj.material.emissive.setHex(hex); } 
          else { obj.material.forEach(m => { if(m.emissive) m.emissive.setHex(hex); }); }
        }
        if(obj.children) obj.children.forEach(c => setEmissive(c, hex));
      }

      // ── Central selection management ────────────────────────────────────────
      // Keeps the highlight state and the transform gizmo in sync with `selected`.
      // One object → gizmo attaches directly. Two or more → the gizmo drives an
      // invisible pivot at their combined centre and every selected object follows
      // the pivot's motion, so they move/rotate/scale together as a set.
      // ── X-ray ───────────────────────────────────────────────────────────────
      // When the thing you've selected sits inside something else, the enclosing
      // object hides it completely — which is exactly the case when you're
      // checking a cavity, a mould pattern or a hollowed part. Any object that
      // encloses the selection is switched to a translucent blue wireframe so you
      // can see through it, while the selection itself stays solid.
      const _xrayOrig = new Map();       // uuid -> saved material state

      function xrayRestore(o) {
        const saved = _xrayOrig.get(o.uuid);
        if (!saved) return;
        o.traverse(c => {
          if (!c.isMesh || !c.material) return;
          const s = saved.get(c.uuid);
          if (!s) return;
          c.material.transparent = s.transparent;
          c.material.opacity = s.opacity;
          c.material.wireframe = s.wireframe;
          c.material.depthWrite = s.depthWrite;
          if (c.material.color && s.color !== undefined) c.material.color.setHex(s.color);
          c.material.needsUpdate = true;
        });
        _xrayOrig.delete(o.uuid);
      }
      function xrayApply(o) {
        if (_xrayOrig.has(o.uuid)) return;      // already ghosted
        const saved = new Map();
        o.traverse(c => {
          if (!c.isMesh || !c.material) return;
          saved.set(c.uuid, {
            transparent: c.material.transparent,
            opacity: c.material.opacity,
            wireframe: c.material.wireframe,
            depthWrite: c.material.depthWrite,
            color: c.material.color ? c.material.color.getHex() : undefined
          });
          c.material.transparent = true;
          c.material.opacity = 0.22;
          c.material.wireframe = true;
          c.material.depthWrite = false;      // so the solid inside always shows
          if (c.material.color) c.material.color.setHex(0x4da6ff);
          c.material.needsUpdate = true;
        });
        _xrayOrig.set(o.uuid, saved);
      }
      function xrayClearAll() {
        [...(_xrayOrig.keys())].forEach(id => {
          const o = objects.find(x => x.uuid === id);
          if (o) xrayRestore(o); else _xrayOrig.delete(id);
        });
      }
      // Does `outer` fully contain `inner`? Bounding boxes are enough here — the
      // point is "you can't see it", not an exact containment proof, and a box
      // test costs nothing on a scene of hundreds of parts.
      function xrayEncloses(outer, inner) {
        outer.updateMatrixWorld(true); inner.updateMatrixWorld(true);
        const bo = new THREE.Box3().setFromObject(outer);
        const bi = new THREE.Box3().setFromObject(inner);
        if (bo.isEmpty() || bi.isEmpty()) return false;
        // A small tolerance so a part touching the inside face still counts.
        const eps = 0.05;
        return bo.min.x - eps <= bi.min.x && bo.max.x + eps >= bi.max.x &&
               bo.min.y - eps <= bi.min.y && bo.max.y + eps >= bi.max.y &&
               bo.min.z - eps <= bi.min.z && bo.max.z + eps >= bi.max.z &&
               // and it must be genuinely bigger, or every object "encloses" itself
               bo.getSize(new THREE.Vector3()).length() > bi.getSize(new THREE.Vector3()).length() * 1.02;
      }
      let xrayEnabled = true;
      window.setXray = (on) => { xrayEnabled = on; refreshSelectionVisual(); if (window.invalidate3D) invalidate3D(); };
      window.getXray = () => xrayEnabled;
      // Test hook: report which objects are currently ghosted.
      window.__bounds = () => objects.map(o => { o.updateMatrixWorld(true);
        const b=new THREE.Box3().setFromObject(o); const s=b.getSize(new THREE.Vector3());
        return { name:(o.userData.name||o.name||'?'),
                 min:[+b.min.x.toFixed(1),+b.min.y.toFixed(1),+b.min.z.toFixed(1)],
                 max:[+b.max.x.toFixed(1),+b.max.y.toFixed(1),+b.max.z.toFixed(1)] }; });
      window.__xrayState = () => objects.map(o => {
        let wf=false, op=1;
        o.traverse(c => { if (c.isMesh && c.material) { wf = wf || !!c.material.wireframe; op = c.material.opacity; } });
        return { name: (o.userData.name||o.name||'?'), ghosted: wf, opacity: op };
      });

      function refreshSelectionVisual() {
        objects.forEach(o => setEmissive(o, 0x000000));
        selected.forEach(o => setEmissive(o, 0x0e3d44));

        xrayClearAll();
        if (!xrayEnabled || !selected.length) return;
        objects.forEach(o => {
          if (selected.includes(o) || o.userData.isSketch || !o.visible) return;
          // Ghost it if it encloses ANY selected object.
          if (selected.some(s => xrayEncloses(o, s))) xrayApply(o);
        });
      }

      function attachGizmoToSelection() {
        detachGroupPivot();
        // Stability: drop any objects that are no longer in the scene (deleted or
        // replaced by an operation) so a stale reference can't corrupt the pivot.
        selected = selected.filter(o => o && (o.parent === scene || o.parent === groupPivot));
        if (activeTool === 'fillet') { transformControl.detach(); moveGizmoTarget = null; return; }
        if (selected.length === 0) { transformControl.detach(); moveGizmoTarget = null; return; }
        if (selected.length === 1) { attachGizmoTarget(selected[0]); return; }

        // Multiple: build a pivot at the centre of all selected objects.
        const centre = new THREE.Vector3();
        const box = new THREE.Box3();
        selected.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
        box.getCenter(centre);

        groupPivot = new THREE.Object3D();
        groupPivot.position.copy(centre);
        scene.add(groupPivot);
        groupPivot.updateMatrixWorld(true);
        pivotPrevMatrix = groupPivot.matrixWorld.clone();

        // Parent each selected object under the pivot WITHOUT changing its world
        // transform, so dragging the pivot moves the whole set rigidly.
        // NOTE: this deliberately does NOT use THREE.SceneUtils.attach — in r128 that
        // is a deprecation stub that takes no arguments and silently does nothing, so
        // the objects never actually got parented and multi-select drags moved an
        // empty pivot. attachKeepWorld below is the real implementation.
        selected.forEach(o => attachKeepWorld(o, groupPivot));
        attachGizmoTarget(groupPivot);
      }

      // Attaches the gizmo to `target`. In Move mode this goes through
      // `movePivot` — an invisible proxy that's kept at the target's position
      // but is NEVER rotated — so the move arrows are always aligned to true
      // world X/Y/Z regardless of the target's own rotation, and dragging
      // "up" always moves it along world Z. Rotate/scale attach directly,
      // since those need to actually spin/resize the real object.
      function attachGizmoTarget(target) {
        transformControl.setSpace('world');
        const mode = transformControl.getMode ? transformControl.getMode() : 'translate';
        if (mode === 'translate') {
          moveGizmoTarget = target;
          movePivot.position.copy(target.position);
          movePivot.quaternion.identity();
          movePivotLastPos.copy(movePivot.position);
          transformControl.attach(movePivot);
        } else {
          moveGizmoTarget = null;
          transformControl.attach(target);
        }
      }

      // Reparent `child` under `parent` preserving its world transform (r128 has no
      // SceneUtils by default, so do it manually).
      function attachKeepWorld(child, parent) {
        child.updateMatrixWorld(true); parent.updateMatrixWorld(true);
        const world = child.matrixWorld.clone();
        parent.add(child);
        const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
        child.matrix.copy(inv.multiply(world));
        child.matrix.decompose(child.position, child.quaternion, child.scale);
        child.updateMatrixWorld(true);
      }

      // Release objects from the pivot back to the scene, keeping world transforms.
      function detachGroupPivot() {
        if (!groupPivot) return;
        [...groupPivot.children].forEach(c => attachKeepWorld(c, scene));
        scene.remove(groupPivot);
        groupPivot = null; pivotPrevMatrix = null;
      }

      // Replace the whole selection (single object or none).
      function selectOnly(obj) {
        selected = obj ? [obj] : [];
        refreshSelectionVisual();
        attachGizmoToSelection();
        updateStatus(); updateFloatingHUD();
      }

      // Toggle one object in/out of the current selection (multi-select).
      function toggleInSelection(obj) {
        if (!obj) return;
        detachGroupPivot();   // release pivot before changing membership
        const i = selected.indexOf(obj);
        if (i >= 0) selected.splice(i, 1); else selected.push(obj);
        refreshSelectionVisual();
        attachGizmoToSelection();
        updateStatus(); updateFloatingHUD();
      }

      // Select every top-level solid/sketch at once.
      function selectAllObjects() {
        selected = objects.slice();
        refreshSelectionVisual();
        attachGizmoToSelection();
        updateStatus(); updateFloatingHUD();
      }

      function clearSelection() {
        detachGroupPivot();
        selected = [];
        refreshSelectionVisual();
        transformControl.detach();
        updateStatus(); updateFloatingHUD();
      }

      // Snap the object(s) being dragged so their outer faces sit flush against
      // nearby objects. Uses world axis-aligned bounding boxes: for each of the
      // three axes we compare the moved box's min/max faces to every other object's
      // min/max faces and, if the closest pair is within SNAP_DIST, shift by exactly
      // the gap so the two faces coincide (touching, no overlap). One axis snaps at
      // a time (the nearest), which feels predictable when sliding pieces together.
      function applyObjectSnap() {
        // What is the gizmo driving? A single object, or the group pivot.
        const driven = (selected.length > 1 && groupPivot) ? groupPivot : selected[0];
        if (!driven) return;

        // Build the world AABB of the moved selection.
        const movingBox = new THREE.Box3();
        if (driven === groupPivot) groupPivot.children.forEach(c => movingBox.expandByObject(c));
        else movingBox.expandByObject(driven);
        if (movingBox.isEmpty()) return;

        // Candidate stationary objects (visible solids not in the selection).
        const others = objects.filter(o =>
          o.visible && !o.userData.isSketch && !selected.includes(o) && o !== groupPivot
        );
        if (others.length === 0) return;

        const axes = ['x', 'y', 'z'];
        let bestGap = SNAP_DIST, bestAxis = null, bestShift = 0;

        const movingCenter = new THREE.Vector3(); movingBox.getCenter(movingCenter);

        others.forEach(o => {
          const ob = new THREE.Box3().setFromObject(o);
          if (ob.isEmpty()) return;
          const otherCenter = new THREE.Vector3(); ob.getCenter(otherCenter);
          axes.forEach(ax => {
            // The two perpendicular axes must overlap so the faces actually front
            // each other; otherwise the objects aren't lined up to snap on `ax`.
            const o1 = ax === 'x' ? 'y' : 'x', o2 = ax === 'z' ? 'y' : 'z';
            const overlap = (a, b, p) => a.min[p] <= b.max[p] - 0.05 && a.max[p] >= b.min[p] + 0.05;
            const perpOverlap = overlap(movingBox, ob, o1) && overlap(movingBox, ob, o2);

            const candidates = [];

            if (snapEnabled && perpOverlap) {
              // Face snapping: bring two faces into flush contact. Only meaningful
              // when the objects front each other on the perpendicular axes.
              candidates.push(
                ob.min[ax] - movingBox.max[ax],  // my +face meets their -face
                ob.max[ax] - movingBox.min[ax],  // my -face meets their +face
                ob.min[ax] - movingBox.min[ax],  // align -faces
                ob.max[ax] - movingBox.max[ax]   // align +faces
              );
            }

            if (centerSnapEnabled) {
              // Center/inline snapping lines up the MIDDLES rather than the faces.
              // This needs no perpendicular overlap — that's what lets you drop a
              // small peg concentric inside a ring, or sit two parts in a row with
              // their centre-lines matching. Aligning the moving centre to the
              // other's centre on one axis leaves the other two axes free, so a
              // single call can make objects concentric (snap all three over
              // successive drags) or merely co-linear.
              candidates.push(otherCenter[ax] - movingCenter[ax]);
              // Also allow snapping the moving centre onto the other's faces — an
              // object's midline meeting the edge of another reads as "inline".
              candidates.push(ob.min[ax] - movingCenter[ax]);
              candidates.push(ob.max[ax] - movingCenter[ax]);
            }

            candidates.forEach(shift => {
              const d = Math.abs(shift);
              if (d > 0.02 && d < bestGap) { bestGap = d; bestAxis = ax; bestShift = shift; }
            });
          });
        });

        if (bestAxis) {
          driven.position[bestAxis] += bestShift;
          driven.updateMatrixWorld(true);
        }
      }

      // The correct sketch-plane → world matrix for a baked sketch, accounting for
      // the origin-recenter (so revolve/loft place geometry correctly even after the
      // sketch has been moved with the gizmo). projectionMatrix maps 2D→original
      // world; the group may since have been recentred and/or moved, so compose:
      //   groupWorld * translate(-originShift) * projectionMatrix
      function sketchWorldMatrix(grp) {
        grp.updateMatrixWorld(true);
        const proj = grp.userData.projectionMatrix || new THREE.Matrix4();
        const shift = grp.userData.originShift
          ? new THREE.Matrix4().makeTranslation(-grp.userData.originShift.x, -grp.userData.originShift.y, -grp.userData.originShift.z)
          : new THREE.Matrix4();
        return new THREE.Matrix4().multiplyMatrices(grp.matrixWorld, new THREE.Matrix4().multiplyMatrices(shift, proj));
      }

      function recenterMeshTransform(mesh) {
        mesh.geometry.computeBoundingBox();
        let center = new THREE.Vector3();
        mesh.geometry.boundingBox.getCenter(center);
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        // ADD rather than overwrite: every caller except splitDisconnectedShells
        // creates a brand-new mesh at (0,0,0) right before this runs, so add and
        // overwrite were indistinguishable there. But splitDisconnectedShells
        // first copies the PARENT piece's already-correct world position onto
        // each new shell, then calls this a second time to give that shell its
        // own pivot -- and geometry.boundingBox at that point is in the
        // parent's local (already-shifted) frame, so the centre this computes
        // is an offset WITHIN that frame, not a world position. Overwriting
        // position with it discarded the real world offset and pulled every
        // disconnected shell back toward the parent's centre -- which is
        // exactly why a cut that split an object (text almost always does,
        // since letters are separate shells) moved the pieces to the origin
        // instead of leaving them where they were cut.
        mesh.position.add(center);
        mesh.updateMatrixWorld();
      }

      // Move a baked sketch GROUP's origin to the centre of the drawn shape, so the
      // move/scale/rotate gizmo sits on the geometry instead of at the plane origin.
      // We shift the child meshes/lines into local space around that centre and set
      // the group's position to the centre — the shape stays visually put, but its
      // transform origin (and the gizmo) is now on the shape.
      function recenterSketchGroup(group) {
        if (!group || !group.userData || !group.userData.isSketch) return;
        const box = new THREE.Box3();
        group.children.forEach(ch => { if (ch.geometry) { ch.geometry.computeBoundingBox(); box.expandByObject(ch); } });
        if (!isFinite(box.min.x)) return;
        const centre = new THREE.Vector3(); box.getCenter(centre);
        group.children.forEach(ch => { if (ch.geometry) ch.geometry.translate(-centre.x, -centre.y, -centre.z); });
        group.position.copy(centre);
        // Remember the recenter offset so revolve/loft (which use the original
        // plane-space projectionMatrix) can compensate for the group's new origin.
        group.userData.originShift = centre.clone();
        group.updateMatrixWorld(true);
      }

      function findSpatialIntersectionTarget(meshA) {
        meshA.updateMatrixWorld();
        let boxA = new THREE.Box3().setFromObject(meshA);
        
        for (let i = 0; i < objects.length; i++) {
          let meshB = objects[i];
          if (meshB === meshA || meshB.userData.isSketch || !meshB.visible) continue;
          
          meshB.updateMatrixWorld();
          let boxB = new THREE.Box3().setFromObject(meshB);
          
          if (boxA.intersectsBox(boxB)) return meshB;
        }
        return null;
      }

      // Every solid that overlaps the cutter — so one cut can carve several separate
      // (unmerged) bodies at once, instead of stopping at the first one it finds.
      function findAllIntersectionTargets(meshA) {
        meshA.updateMatrixWorld(true);
        const boxA = new THREE.Box3().setFromObject(meshA);
        const hits = [];
        objects.forEach(o => {
          if (o === meshA || o.userData.isSketch || !o.visible) return;
          o.updateMatrixWorld(true);
          const boxB = new THREE.Box3().setFromObject(o);
          if (boxA.intersectsBox(boxB)) hits.push(o);
        });
        return hits;
      }

      // Collect the real geometry-bearing meshes inside an object — a group returns
      // all its child solids, a plain mesh returns itself. Lets booleans work on
      // groups (which have no geometry of their own).
      function collectSolidMeshes(obj) {
        const out = [];
        const walk = (o) => {
          if (o.userData && o.userData.isSketch) return;
          if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) out.push(o);
          if (o.children) o.children.forEach(walk);
        };
        walk(obj);
        return out;
      }

      // Split a mesh's geometry into separate objects wherever the triangles form
      // disconnected shells (e.g. cutting a tube out of a block leaves the block and
      // the loose inner core). Returns an array of new meshes, or null if it's one
      // connected piece.
      // strict = false (default): pieces count as joined if they share even one
      // vertex. That is what the Cut / mould tools want, because boolean output can
      // contain T-junctions that a stricter rule would shatter.
      // strict = true: pieces are joined only along shared edges, so bodies that
      // merely touch at a corner or along a line can be separated (used by Ungroup).
      function splitDisconnectedShells(mesh, strict) {
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = g.attributes.position;
        if (pos.count / 3 < 2) return null;
        const { comp, nComp, triCount } = labelLooseShells(pos, null, !!strict);
        if (nComp < 2) return null;   // single connected body — nothing to split

        // build one mesh per component. Bucket the triangles by shell in a single
        // pass first - scanning every triangle once per shell is O(shells x tris)
        // and crawls on scans/imports made of hundreds of loose pieces.
        const col = g.attributes.color;
        const made = [];
        const bucket = Array.from({ length: nComp }, () => []);
        for (let t = 0; t < triCount; t++) if (comp[t] >= 0) bucket[comp[t]].push(t);
        for (let c = 0; c < nComp; c++) {
          const verts = [], cols = [];
          for (const t of bucket[c]) {
            for (let k = 0; k < 3; k++) {
              const i = t*3+k;
              verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
              if (col) cols.push(col.getX(i), col.getY(i), col.getZ(i));
            }
          }
          if (!verts.length) continue;
          const ng = new THREE.BufferGeometry();
          ng.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          if (cols.length) ng.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
          ng.computeVertexNormals();
          const m = new THREE.Mesh(ng, Array.isArray(mesh.material) ? mesh.material[0].clone() : mesh.material.clone());
          m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
          recenterMeshTransform(m);
          m.castShadow = true; m.receiveShadow = true;
          made.push(m);
        }
        return made.length > 1 ? made : null;
      }

      // Label every triangle with the loose part ("shell") it belongs to.
      // Vertices are welded by rounded position. Zero-area triangles are ignored
      // (comp = -1). Returns { comp, nComp, triCount }.
      //   loose  (strict = false): triangles sharing any vertex are one part.
      //   strict (strict = true):  triangles are joined only along an EDGE used by
      //     exactly two triangles (a normal manifold seam). Bodies that touch at a
      //     corner, or along a line (four triangles on one edge), stay separate.
      //     Slivers of 1-2 triangles that share a vertex with another part are
      //     re-attached to it, since those are almost always T-junction artefacts
      //     in the file rather than real loose pieces.
      function labelLooseShells(pos, idx, strict) {
        const n = idx ? idx.count : pos.count;
        const triCount = Math.floor(n / 3);
        const ids = new Int32Array(pos.count).fill(-1);
        const wmap = new Map();
        const vid = (i) => {
          if (ids[i] >= 0) return ids[i];
          const k = pos.getX(i).toFixed(3) + '_' + pos.getY(i).toFixed(3) + '_' + pos.getZ(i).toFixed(3);
          let id = wmap.get(k);
          if (id === undefined) { id = wmap.size; wmap.set(k, id); }
          return (ids[i] = id);
        };
        const tv = new Int32Array(triCount * 3);
        for (let i = 0; i < triCount * 3; i++) tv[i] = vid(idx ? idx.getX(i) : i);
        const nv = wmap.size + 1;
        const ok = new Uint8Array(triCount);
        for (let t = 0; t < triCount; t++) {
          const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
          ok[t] = (a !== b && b !== c && a !== c) ? 1 : 0;
        }
        const parent = new Int32Array(triCount);
        for (let t = 0; t < triCount; t++) parent[t] = t;
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
        if (!strict) {
          // any shared vertex joins
          const vFirst = new Int32Array(nv).fill(-1);
          for (let t = 0; t < triCount; t++) {
            if (!ok[t]) continue;
            for (let k = 0; k < 3; k++) {
              const v = tv[t * 3 + k];
              if (vFirst[v] < 0) vFirst[v] = t; else join(vFirst[v], t);
            }
          }
        } else {
          const ekey = (a, b) => (a < b ? a * nv + b : b * nv + a);
          // pass 1: how many triangles use each edge
          const uses = new Map();
          for (let t = 0; t < triCount; t++) {
            if (!ok[t]) continue;
            for (let k = 0; k < 3; k++) {
              const key = ekey(tv[t * 3 + k], tv[t * 3 + (k + 1) % 3]);
              uses.set(key, (uses.get(key) || 0) + 1);
            }
          }
          // pass 2: join the two triangles on every edge used by exactly two triangles
          const first = new Map();
          for (let t = 0; t < triCount; t++) {
            if (!ok[t]) continue;
            for (let k = 0; k < 3; k++) {
              const key = ekey(tv[t * 3 + k], tv[t * 3 + (k + 1) % 3]);
              if (uses.get(key) !== 2) continue;
              const o = first.get(key);
              if (o === undefined) first.set(key, t); else join(o, t);
            }
          }
          // pass 3: re-attach tiny slivers (<= 2 triangles) that touch another part
          const size = new Map();
          for (let t = 0; t < triCount; t++) if (ok[t]) { const r = find(t); size.set(r, (size.get(r) || 0) + 1); }
          const vFirst = new Int32Array(nv).fill(-1);
          for (let t = 0; t < triCount; t++) {
            if (!ok[t]) continue;
            for (let k = 0; k < 3; k++) {
              const v = tv[t * 3 + k];
              if (vFirst[v] < 0) { vFirst[v] = t; continue; }
              const ra = find(vFirst[v]), rb = find(t);
              if (ra !== rb && (size.get(ra) <= 2 || size.get(rb) <= 2)) {
                const merged = size.get(ra) + size.get(rb);
                join(ra, rb); size.set(find(ra), merged);
              }
            }
          }
        }
        const comp = new Int32Array(triCount).fill(-1);
        const label = new Map();
        let nComp = 0;
        for (let t = 0; t < triCount; t++) {
          if (!ok[t]) continue;
          const r = find(t);
          let l = label.get(r);
          if (l === undefined) { l = nComp++; label.set(r, l); }
          comp[t] = l;
        }
        return { comp, nComp, triCount };
      }

      // How many disconnected shells a geometry is made of (same rule as
      // splitDisconnectedShells, but no geometry is built), so an import can tell the
      // user it has loose parts without paying for a full split.
      function countLooseShells(geometry) {
        const pos = geometry && geometry.attributes && geometry.attributes.position;
        if (!pos) return 0;
        return labelLooseShells(pos, geometry.index, true).nComp;
      }

      // Builds a recentered mesh from a world-space CSG result. Colour comes
      // from the per-vertex colour attribute baked into the geometry (each
      // input solid's own colour, carried through the boolean by the CSG
      // engine) — not from whichever material happens to get passed in — so
      // e.g. a black block with red text on it keeps both colours after a
      // boolean/merge instead of the whole thing flattening to one colour.
      function csgToRecenteredMesh(csgResult, material) {
        const geo = window.CSGEngine.toGeometry(csgResult); // world-space geometry
        const mat = material.clone();
        mat.vertexColors = true;
        mat.color.setRGB(1, 1, 1); // avoid tinting the baked-in vertex colours
        const mesh = new THREE.Mesh(geo, mat);
        recenterMeshTransform(mesh);
        mesh.castShadow = true; mesh.receiveShadow = true;
        return mesh;
      }

      function executeAutoBoolean(operation) {
        if (selected.length !== 1) return banner("⚠️ Select exactly 1 solid (or group) to use as the cutter.");
        if (selected[0].userData.isSketch) return banner("⚠️ Booleans work on solids — extrude the sketch first.");
        const cutterObj = selected[0];
        // A group has no geometry of its own; use its child solids as the cutter.
        const cutterMeshes = collectSolidMeshes(cutterObj);
        if (!cutterMeshes.length) return banner("⚠️ That selection has no solid geometry.");

        // Every overlapping body — so a single cut carves all of them, merged or not.
        const targetObjs = findAllIntersectionTargets(cutterObj);
        if (!targetObjs.length) return banner("⚠️ Bounds Error: The selected object must overlap another solid.");

        // Expand groups into their child solids so grouped targets can be cut too.
        const targetMeshes = [];
        targetObjs.forEach(t => collectSolidMeshes(t).forEach(m => targetMeshes.push({ mesh: m, root: t })));
        if (!targetMeshes.length) return banner("⚠️ Nothing solid to cut — the overlapping object has no geometry.");

        const triCount = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
        let totalTris = cutterMeshes.reduce((s,m)=>s+triCount(m),0) + targetMeshes.reduce((s,t)=>s+triCount(t.mesh),0);
        if (totalTris > 16000 && !window._boolHeavyOK) {
          const proceed = confirm(`These shapes are detailed (${Math.round(totalTris/1000)}k triangles combined), so this cut may take a while and briefly freeze the screen.\n\nTip: for a cleaner, faster cut, use lower-resolution shapes where you can.\n\nContinue anyway?`);
          if (!proceed) { banner("Boolean cancelled."); return; }
          window._boolHeavyOK = true;
        }
        banner(targetMeshes.length > 1 ? `Cutting ${targetMeshes.length} bodies…` : "Computing boolean topology...");

        setTimeout(() => {
          try {
            const CSG = window.CSGEngine;
            // Combine all cutter pieces into one CSG solid (handles grouped cutters).
            let bCut = CSG.fromMesh(cutterMeshes[0]);
            for (let i = 1; i < cutterMeshes.length; i++) bCut = bCut.union(CSG.fromMesh(cutterMeshes[i]));

            const created = [];
            const consumed = new Set();

            if (operation === 'split') {
              // Split: for each target, keep both the outside remainder and the
              // overlapping core as separate bodies.
              targetMeshes.forEach(({ mesh, root }) => {
                const bT = CSG.fromMesh(mesh);
                const outMesh = csgToRecenteredMesh(bT.subtract(bCut), mesh.material.clone());
                const inMesh  = csgToRecenteredMesh(bT.intersect(bCut), mesh.material.clone());
                [outMesh, inMesh].forEach(m => {
                  if (!m.geometry.attributes.position.count) return;
                  const parts = splitDisconnectedShells(m);
                  if (parts) parts.forEach(p => created.push(p)); else created.push(m);
                });
                consumed.add(root);
              });
            } else {
              targetMeshes.forEach(({ mesh, root }) => {
                const bT = CSG.fromMesh(mesh);
                let res;
                if (operation === 'union') res = bT.union(bCut);
                else if (operation === 'subtract') res = bT.subtract(bCut);   // target minus cutter
                else if (operation === 'intersect') res = bT.intersect(bCut);
                if (!res || !res.polygons.length) return;   // nothing left of this body
                const outMesh = csgToRecenteredMesh(res, mesh.material.clone());
                if (!outMesh.geometry.attributes.position.count) return;
                // Cutting can leave loose pieces (e.g. a tube's core inside a block) —
                // hand each disconnected shell back as its own object.
                const parts = splitDisconnectedShells(outMesh);
                if (parts) parts.forEach(p => created.push(p)); else created.push(outMesh);
                consumed.add(root);
              });
            }

            if (!created.length) return banner("⚠️ The result was empty — do the solids actually overlap?");

            // Remove the originals we replaced, plus the cutter (except for union,
            // where the cutter is absorbed into the result anyway).
            consumed.forEach(root => { scene.remove(root); objects = objects.filter(o => o !== root); });
            scene.remove(cutterObj); objects = objects.filter(o => o !== cutterObj);
            transformControl.detach();

            objects.forEach(o => setEmissive(o, 0x000000));
            created.forEach(m => { m.castShadow = true; m.receiveShadow = true; scene.add(m); objects.push(m); });
            selected = [created[0]]; setEmissive(created[0], 0x0e3d44); attachGizmoTarget(created[0]);
            transformControl.setSpace('world');
            saveHistory(); updateStatus(); updateFloatingHUD();
            const pieces = created.length;
            banner(`${operation === 'subtract' ? 'Cut' : operation === 'intersect' ? 'Intersect' : operation === 'split' ? 'Split' : 'Merge'} complete — ${pieces} piece${pieces>1?'s':''}.`);
          } catch(err) {
            console.error(err); banner("⚠️ CSG error — try nudging the objects so faces overlap cleanly.");
          }
          updateStatus(); updateFloatingHUD();
        }, 30);
      }

      function finalizeCSGOutput(resMesh, oldA, oldB) {
        resMesh.castShadow = true; resMesh.receiveShadow = true;
        scene.remove(oldA); scene.remove(oldB);
        objects = objects.filter(o => o !== oldA && o !== oldB);
        scene.add(resMesh); objects.push(resMesh);
        selected = [resMesh]; setEmissive(resMesh, 0x0e3d44); attachGizmoTarget(resMesh);
        transformControl.setSpace('world');
        saveHistory();
      }

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

      // ══ Moulds ══════════════════════════════════════════════════════════════
      // Two ways to turn a model into something you can cast copies from. Both work
      // in the app's Z-up world (Z is height, the build plate is the XY plane). The
      // builders these replace assumed Y was up, so their "pour funnel on top" came
      // out of the model's side and the casting box's "floor" was a side wall.
      //
      //  • Print-and-pour mould (buildPourMould): a printed block with the model's
      //    shape left as a HOLLOW inside it, a pour funnel and an air vent running
      //    from the top of the block down into the hollow, split in two with
      //    alignment pegs. Clamp the halves together and pour resin, plaster, wax…
      //    straight into the printed plastic.
      //
      //  • Silicone mould box (buildSiliconeBox): an open-top box, plus a lid that
      //    holds the model suspended inside the box by its pour funnel, leaving an
      //    even gap all round — underneath too — to fill with silicone through the
      //    lid's pour hole. Once cured, lift the lid away (the funnel leaves a pour
      //    channel in the rubber), take the block out, cut it open to free the model,
      //    and cast copies in the rubber.
      //
      // Both lay their parts out ready to print: on the plate, in the orientation
      // that needs no supports for the mould itself.

      // A solid box spanning the given world-space bounds.
      const _mBox = (minX, minY, minZ, maxX, maxY, maxZ) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ), new THREE.MeshStandardMaterial());
        m.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        m.updateMatrixWorld(true);
        return m;
      };
      // A vertical (Z) cone or cylinder from z0 at radius r0 up to z1 at radius r1.
      const _mCone = (x, y, z0, z1, r0, r1, seg) => {
        const g = new THREE.CylinderGeometry(r1, r0, Math.max(0.1, z1 - z0), seg || 32);
        g.rotateX(Math.PI / 2);                         // its axis was Y; make it Z (top stays on top)
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
        m.position.set(x, y, (z0 + z1) / 2);
        m.updateMatrixWorld(true);
        return m;
      };
      // An alignment peg: wide end on the parting plane at p, tapering along +axis
      // into the other half. Truncated rather than pointed — a true apex is a
      // degenerate vertex that collapses the BSP solver (and prints as a needle).
      const _mPeg = (axis, p, r, len) => {
        const g = new THREE.CylinderGeometry(r * 0.55, r, len, 20);
        if (axis === 'x') g.rotateZ(-Math.PI / 2);      // +Y -> +X
        else if (axis === 'z') g.rotateX(Math.PI / 2);  // +Y -> +Z
        g.translate(axis === 'x' ? len / 2 : 0, axis === 'y' ? len / 2 : 0, axis === 'z' ? len / 2 : 0);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
        m.position.copy(p);
        m.updateMatrixWorld(true);
        return m;
      };
      const _mWorldGeo = (mesh) => {
        mesh.updateMatrixWorld(true);
        const g = mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        g.computeBoundingBox();
        return g;
      };
      // Where the pour funnel should meet the model: its highest point, preferring
      // the one nearest the middle when the top is flat or level — so the funnel
      // lands on material rather than dropping through a hole (a ring, a handle).
      function _mTopPoint(geo, near) {
        const p = geo.attributes.position, bb = geo.boundingBox;
        const tol = Math.max(0.3, (bb.max.z - bb.min.z) * 0.02);
        let best = null, bestD = Infinity;
        for (let i = 0; i < p.count; i++) {
          const z = p.getZ(i);
          if (z < bb.max.z - tol) continue;
          const x = p.getX(i), y = p.getY(i);
          const d = Math.hypot(x - near.x, y - near.y);
          if (d < bestD) { bestD = d; best = { x, y, z }; }
        }
        return best;
      }
      // Highest point of the model at least `r` away (in plan) from (x, y) — where
      // air collects that the pour funnel can't release, so that's where the vent goes.
      function _mHighestAway(geo, x, y, r) {
        const p = geo.attributes.position;
        let best = null;
        for (let i = 0; i < p.count; i++) {
          const px = p.getX(i), py = p.getY(i);
          if (Math.hypot(px - x, py - y) < r) continue;
          const z = p.getZ(i);
          if (!best || z > best.z) best = { x: px, y: py, z };
        }
        return best;
      }
      // How deep the funnel's foot must sink below the top point, and how wide it
      // can be there. On a pointed or domed top the model is only a pin-prick wide
      // just under its highest point, so a shallow funnel meets it through a pin-hole:
      // the casting can't fill, and a pattern hung from the funnel snaps off. Sink
      // until the model (near the top point) is wide enough for the foot, and never
      // make the foot wider than the model there, so the sprue stub stays small.
      function _mFunnelFoot(geo, top, rWant, maxDepth) {
        const p = geo.attributes.position;
        const reach = rWant * 3;
        const need = Math.min(rWant, 2.5);
        const widthTo = (d) => {
          let w = 0;
          for (let i = 0; i < p.count; i++) {
            const z = p.getZ(i);
            if (z < top.z - d) continue;
            const h = Math.hypot(p.getX(i) - top.x, p.getY(i) - top.y);
            if (h <= reach && h > w) w = h;
          }
          return w;
        };
        let d = Math.min(1.5, maxDepth), w = widthTo(d);
        for (const step of [2.5, 4, 6, 8, 11, 15, 20, 26]) {
          if (w >= need || step > maxDepth) break;
          d = step; w = widthTo(d);
        }
        if (w < need && maxDepth > d) { d = maxDepth; w = widthTo(d); }
        return { depth: d, r: Math.max(1, Math.min(rWant, w * 0.9)) };
      }

      const _mVolume = (csg) => {
        const p = window.CSGEngine.toGeometry(csg).attributes.position;
        if (!p || p.count < 12) return 0;
        let v = 0;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < p.count; i += 3) {
          a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
          v += a.dot(b.cross(c)) / 6;
        }
        return Math.abs(v);
      };
      const _mTris = (csg) => window.CSGEngine.toGeometry(csg).attributes.position.count / 3;
      // Try a CSG step; keep the result only if it didn't collapse.
      const _mTry = (base, fn) => {
        try { const r = fn(base); return (r && r.polygons.length > 12) ? r : base; } catch (e) { return base; }
      };

      // The BSP boolean engine is numerically fragile: whether it survives depends
      // on exact coplanar coincidences between the block, the cavity and the funnel.
      // Nudging dimensions by a fraction of a millimetre breaks the coincidence
      // without meaningfully changing the mould, so a retry almost always succeeds.
      function _mRetry(build) {
        const jitters = [0, 0.37, -0.29, 0.63, -0.51, 0.91];
        let lastErr = null;
        for (const j of jitters) {
          try { return build(j); } catch (err) { lastErr = err; }
        }
        throw lastErr || new Error('the mould could not be built.');
      }

      // ── Print-and-pour mould ──────────────────────────────────────────────
      // o: { wall, sprue, vent, split: 'x' | 'y' | 'z', pegR, pegLenMul, pegClear }
      function buildPourMould(mesh, o) {
        const CSG = window.CSGEngine;
        const geo = _mWorldGeo(mesh);
        const bb = geo.boundingBox;
        const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
        if (!(size.x > 0 && size.y > 0 && size.z > 0)) throw new Error('that object has no volume to cast.');

        const w = o.wall;
        const B = { min: [bb.min.x - w, bb.min.y - w, bb.min.z - w], max: [bb.max.x + w, bb.max.y + w, bb.max.z + w] };
        // Everything that has to be hollowed out — the model, the pour funnel and the
        // air vent — is merged into ONE cutter first, and the halves are built from
        // plain boxes (with their pegs and sockets) before the cutter is subtracted.
        // That is two heavy booleans against a dense model instead of a dozen, which
        // is the difference between a couple of seconds and most of a minute.
        let cutter = CSG.fromMesh(mesh);

        // Pour funnel: from the model's top point straight up through the block's
        // top face, narrow at the model and flaring at the opening. Its foot sinks a
        // little below the top point so it is guaranteed to break into the hollow.
        const top = _mTopPoint(geo, ctr) || { x: ctr.x, y: ctr.y, z: bb.max.z };
        const foot = Math.min(size.x, size.y);
        const ff = _mFunnelFoot(geo, top, Math.max(0.8, Math.min(o.sprue, foot * 0.4)), size.z * 0.4);
        const rBot = ff.r;
        const roomTop = Math.min(B.max[0] - top.x, top.x - B.min[0], B.max[1] - top.y, top.y - B.min[1]) - 1.5;
        const rTop = Math.max(rBot * 1.2, Math.min(Math.max(rBot, o.sprue) * 1.7, roomTop));
        const funnel = CSG.fromMesh(_mCone(top.x, top.y, top.z - ff.depth, B.max[2] + 1, rBot, rTop));
        const withFunnel = _mTry(cutter, c => c.union(funnel));
        if (withFunnel === cutter) throw new Error('the pour funnel could not be joined to the model.');
        cutter = withFunnel;

        // Air vent: a thin riser from the highest point away from the funnel, so air
        // trapped there escapes instead of leaving a bubble in the casting.
        let vented = false;
        if (o.vent) {
          const vr = Math.max(0.8, Math.min(1.5, rBot * 0.35));
          const v = _mHighestAway(geo, top.x, top.y, rTop + vr + 2);
          if (v && v.z > bb.min.z + size.z * 0.25) {
            const before = cutter;
            cutter = _mTry(cutter, c => c.union(CSG.fromMesh(_mCone(v.x, v.y, v.z - Math.min(1, size.z * 0.2), B.max[2] + 1, vr, vr, 12))));
            vented = cutter !== before;
          }
        }

        // The two half-blocks, split through the middle of the model.
        const ax = o.split, ai = 'xyz'.indexOf(ax);
        const plane = [ctr.x, ctr.y, ctr.z][ai];
        const halfBox = (side) => {
          const mn = B.min.slice(), mx = B.max.slice();
          if (side < 0) mx[ai] = plane; else mn[ai] = plane;
          return CSG.fromMesh(_mBox(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]));
        };
        let halfA = halfBox(-1);   // negative side — carries the pegs
        let halfB = halfBox(+1);   // positive side — carries the sockets

        // Alignment pegs at the four corners of the wall ring on the parting plane —
        // outside the model's bounds on both of the other axes, so they always sit in
        // solid wall and never break into the hollow, the funnel or the vent. Each
        // starts half a millimetre inside half A so it fuses with it rather than
        // merely touching its face.
        const others = [0, 1, 2].filter(i => i !== ai);
        const bmin = [bb.min.x, bb.min.y, bb.min.z], bmax = [bb.max.x, bb.max.y, bb.max.z];
        const pegR = Math.min(o.pegR, (w / 2) / 1.3);
        let pegsAdded = 0, pegNote = '';
        if (pegR < 0.8) {
          pegNote = 'the wall is too thin for alignment pegs — raise Wall thickness';
        } else {
          const pegLen = Math.min(pegR * o.pegLenMul, size.getComponent(ai) / 2 + w - 1);
          [-1, 1].forEach(su => [-1, 1].forEach(sv => {
            const p = [0, 0, 0];
            p[ai] = plane - 0.5;
            p[others[0]] = su < 0 ? bmin[others[0]] - w / 2 : bmax[others[0]] + w / 2;
            p[others[1]] = sv < 0 ? bmin[others[1]] - w / 2 : bmax[others[1]] + w / 2;
            const at = new THREE.Vector3(p[0], p[1], p[2]);
            try {
              const grown = halfA.union(CSG.fromMesh(_mPeg(ax, at, pegR, pegLen + 0.5)));
              const cut = halfB.subtract(CSG.fromMesh(_mPeg(ax, at, pegR + o.pegClear, pegLen + 0.5 + o.pegClear)));
              // Only accept a peg together with its socket, so one never jams the other.
              if (grown.polygons.length > 6 && cut.polygons.length > 6) { halfA = grown; halfB = cut; pegsAdded++; }
            } catch (e) { /* skip this peg */ }
          }));
          if (!pegsAdded) pegNote = 'the alignment pegs could not be added';
        }

        halfA = halfA.subtract(cutter);
        halfB = halfB.subtract(cutter);

        // Sanity: both halves must be real and the hollow must actually be there.
        const blockVol = (B.max[0] - B.min[0]) * (B.max[1] - B.min[1]) * (B.max[2] - B.min[2]);
        const vA = _mVolume(halfA), vB = _mVolume(halfB);
        if (vA < blockVol * 0.05 || vB < blockVol * 0.05 || _mTris(halfA) < 24 || _mTris(halfB) < 24) {
          throw new Error('this shape defeated the boolean solver — try nudging Wall thickness by a millimetre or two, or another split direction.');
        }
        if (vA + vB > blockVol * 0.995) throw new Error('the hollow did not form — try a slightly different wall thickness or funnel size.');
        geo.dispose();
        return { csgA: halfA, csgB: halfB, axis: ax, pegs: pegsAdded, pegNote, vented };
      }

      // ── Silicone mould box ────────────────────────────────────────────────
      // o: { gap, wall, floor, lid, sprue, clear }
      function buildSiliconeBox(mesh, o) {
        const CSG = window.CSGEngine;
        const geo = _mWorldGeo(mesh);
        const bb = geo.boundingBox;
        const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
        if (!(size.x > 0 && size.y > 0 && size.z > 0)) throw new Error('that object has no volume to cast.');

        // Inside of the box = the block of silicone: the model plus the gap on
        // every side, including underneath (the model hangs, it doesn't stand).
        const g = o.gap, t = o.wall;
        const I = { x0: bb.min.x - g, y0: bb.min.y - g, z0: bb.min.z - g, x1: bb.max.x + g, y1: bb.max.y + g, z1: bb.max.z + g };

        // Box: floor and walls, open top.
        let box = CSG.fromMesh(_mBox(I.x0 - t, I.y0 - t, I.z0 - o.floor, I.x1 + t, I.y1 + t, I.z1))
          .subtract(CSG.fromMesh(_mBox(I.x0, I.y0, I.z0, I.x1, I.y1, I.z1 + 5)));

        // Lid: a plate resting on the walls, with a locating rim underneath that
        // drops just inside the walls so the lid — and the model hanging from it —
        // always sits centred.
        const c = o.clear;
        const rimW = Math.max(1, Math.min(2, g - c - 1)), rimD = Math.min(3, g * 0.5);
        let lid = CSG.fromMesh(_mBox(I.x0 - t, I.y0 - t, I.z1, I.x1 + t, I.y1 + t, I.z1 + o.lid));
        const rim = CSG.fromMesh(_mBox(I.x0 + c, I.y0 + c, I.z1 - rimD, I.x1 - c, I.y1 - c, I.z1 + 0.5))
          .subtract(CSG.fromMesh(_mBox(I.x0 + c + rimW, I.y0 + c + rimW, I.z1 - rimD - 1, I.x1 - c - rimW, I.y1 - c - rimW, I.z1 + 1)));
        lid = _mTry(lid, l => l.union(rim));

        // Pour funnel: from the model's top point up into the lid. This is what holds
        // the model up, and once the silicone cures it leaves the channel you pour
        // the final casting through.
        const top = _mTopPoint(geo, ctr) || { x: ctr.x, y: ctr.y, z: bb.max.z };
        const foot = Math.min(size.x, size.y);
        const ff = _mFunnelFoot(geo, top, Math.max(1.2, Math.min(o.sprue, foot * 0.4)), size.z * 0.4);
        const rBot = Math.max(1.2, ff.r);
        const roomTop = Math.min(I.x1 - top.x, top.x - I.x0, I.y1 - top.y, top.y - I.y0) - c - rimW - 1;
        const rTop = Math.max(rBot, Math.min(Math.max(rBot, o.sprue) * 1.7, roomTop));
        const bite = ff.depth;

        // Pour and vent holes through the lid, in the corners furthest from the
        // funnel so silicone runs down the gap beside the model rather than onto it.
        const inset = c + rimW + 1;
        const rPour = Math.max(3, Math.min(8, Math.min(I.x1 - I.x0, I.y1 - I.y0) * 0.12));
        const rVent = Math.max(1.5, rPour * 0.4);
        const corners = [[I.x0, I.y0, 1, 1], [I.x1, I.y0, -1, 1], [I.x0, I.y1, 1, -1], [I.x1, I.y1, -1, -1]]
          .sort((a, b) => Math.hypot(b[0] - top.x, b[1] - top.y) - Math.hypot(a[0] - top.x, a[1] - top.y));
        const hole = (cn, r) => {
          const hx = cn[0] + cn[2] * (inset + r), hy = cn[1] + cn[3] * (inset + r);
          if (Math.hypot(hx - top.x, hy - top.y) < rTop + r + 1) return null;   // would cut into the funnel
          return _mCone(hx, hy, I.z1 - rimD - 1, I.z1 + o.lid + 1, r, r, 24);
        };
        const pourHole = hole(corners[0], rPour), ventHole = hole(corners[1], rVent);
        if (pourHole) lid = _mTry(lid, l => l.subtract(CSG.fromMesh(pourHole)));
        if (ventHole) lid = _mTry(lid, l => l.subtract(CSG.fromMesh(ventHole)));

        const funnel = _mCone(top.x, top.y, top.z - bite, I.z1 + Math.min(1, o.lid * 0.5), rBot, rTop);
        let assembly = _mTry(lid, l => l.union(CSG.fromMesh(funnel)));
        const withFunnel = assembly !== lid;
        const withModel = _mTry(assembly, a => a.union(CSG.fromMesh(mesh)));
        if (!withFunnel || withModel === assembly) {
          throw new Error('the model could not be joined to its pour funnel — try a slightly different funnel size.');
        }
        assembly = withModel;
        if (_mTris(box) < 24) throw new Error('the box did not form — try a slightly different wall thickness.');
        geo.dispose();
        return { box, lid: assembly, holes: !!pourHole };
      }

      // Lay parts out ready to print: rotate each so `up` (its outward face normal,
      // in world space) points +Z, then stand them on the plate in a row along X,
      // centred where the original model was.
      function _mLayout(parts, anchor) {
        const Z = new THREE.Vector3(0, 0, 1);
        parts.forEach(({ mesh, up }) => {
          mesh.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(up.clone().normalize(), Z));
          mesh.updateMatrixWorld(true);
        });
        const boxes = parts.map(({ mesh }) => new THREE.Box3().setFromObject(mesh));
        const gapX = 10;
        const total = boxes.reduce((s, b) => s + (b.max.x - b.min.x), 0) + gapX * (parts.length - 1);
        let x = anchor.x - total / 2;
        parts.forEach(({ mesh }, i) => {
          const b = boxes[i];
          mesh.position.x += x - b.min.x;
          mesh.position.y += anchor.y - (b.min.y + b.max.y) / 2;
          mesh.position.z += -b.min.z;
          mesh.updateMatrixWorld(true);
          x += (b.max.x - b.min.x) + gapX;
        });
      }

      // Build the selected kind of mould from the selected solid and drop its parts
      // into the scene, print-ready.
      function generateMold() {
        if (selected.length !== 1) return banner('⚠️ Select exactly one solid to make a mould of.');
        const src = selected[0];
        if (src.userData.isSketch) return banner('⚠️ Moulds need a solid — extrude the sketch first.');
        const meshes = collectSolidMeshes(src);
        if (!meshes.length) return banner('⚠️ That selection has no solid geometry.');
        if (meshes.length > 1) return banner('⚠️ Combine the group into one solid first (Modify → Merge).');
        const mesh = meshes[0];
        const tris = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3;
        if (tris > 16000) banner('Working — that is a dense mesh, so this may take a moment…');

        // NOTE: document.getElementById directly — the `$` shorthand lives in the
        // Paint module, not this one.
        const el = (id) => document.getElementById(id);
        const num = (id, d) => { const e = el(id); const v = e ? parseFloat(e.value) : NaN; return isFinite(v) ? v : d; };
        const kind = window.currentMoldKind ? window.currentMoldKind() : 'block';
        const sprue = num('mold-sprue', 6);

        let res;
        try {
          if (kind === 'cast') {
            const gap = num('cast-gap', 10);
            res = _mRetry(j => buildSiliconeBox(mesh, {
              gap: gap + j * 0.4, wall: num('cast-wall', 3), floor: num('cast-base', 3), lid: num('cast-lid', 3),
              sprue: Math.max(1.2, sprue + j * 0.3), clear: num('cast-clear', 0.4)
            }));
          } else {
            const wall = num('mold-wall', 8);
            const split = (el('mold-axis') && el('mold-axis').value) || 'x';
            res = _mRetry(j => buildPourMould(mesh, {
              wall: wall + j * 0.5, sprue: Math.max(0.8, sprue + j * 0.4),
              vent: el('mold-vent') ? el('mold-vent').checked : true,
              split: /^[xyz]$/.test(split) ? split : 'x',
              pegR: num('mold-peg', 3), pegLenMul: num('mold-peglen', 2.4), pegClear: num('mold-clear', 0.15)
            }));
          }
        } catch (err) {
          console.error('Mould build failed:', err);
          return banner('⚠️ Couldn\'t build that ' + (kind === 'cast' ? 'silicone mould box' : 'mould') + ': ' + (err.message || err));
        }

        const baseName = src.userData.name || src.name || 'Object';
        const mk = (csg, label) => {
          const m = csgToRecenteredMesh(csg, mesh.material);
          m.userData.name = baseName + ' ' + label;
          m.userData.isMoldHalf = true;
          m.castShadow = true; m.receiveShadow = true;
          scene.add(m); objects.push(m);
          return m;
        };
        const anchor = new THREE.Box3().setFromObject(src).getCenter(new THREE.Vector3());
        let made, msg;
        if (kind === 'cast') {
          const boxM = mk(res.box, 'mould box');
          const lidM = mk(res.lid, 'lid + pattern');
          // Box prints as it stands; the lid prints upside down — lid flat on the
          // plate, funnel and model pointing up.
          _mLayout([{ mesh: boxM, up: new THREE.Vector3(0, 0, 1) }, { mesh: lidM, up: new THREE.Vector3(0, 0, -1) }], anchor);
          made = [boxM, lidM];
          msg = 'Silicone mould box created — print the box, and the lid upside down as laid out (the model may need supports). ' +
                'Turn the lid over and drop it onto the box: the model hangs inside with an even gap all round. ' +
                (res.holes ? 'Pour silicone through the larger hole in the lid; the small one lets air out. '
                           : 'The box is too small for pour holes in the lid — pour before fitting it, or raise Silicone thickness. ') +
                'Once cured, lift the lid away, take the block out and cut it open to free the model. The funnel leaves the channel you pour castings through.';
        } else {
          const a = mk(res.csgA, 'mould A');
          const b = mk(res.csgB, 'mould B');
          // Each half prints with its parting face up, so the hollow is an open pit
          // (no supports) and the face that has to seal is the cleanest one.
          const n = new THREE.Vector3(); n.setComponent('xyz'.indexOf(res.axis), 1);
          _mLayout([{ mesh: a, up: n.clone() }, { mesh: b, up: n.clone().negate() }], anchor);
          made = [a, b];
          const pegs = res.pegs ? res.pegs + ' alignment pegs' : 'no alignment pegs (' + (res.pegNote || 'no room for them') + ')';
          msg = `Mould created — two halves laid out parting-face up, with ${pegs}, a pour funnel${res.vented ? ' and an air vent' : ''}. ` +
                'Print both, put them face to face, clamp them, and pour through the funnel.';
        }

        // Keep the original around but out of the way — you may want to re-make the
        // mould with different settings. Unhide it from the object list.
        src.visible = false;
        selected = made;
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(msg + ' The original is hidden.');
      }

      function performSlice() {
        if (selected.length !== 1) return banner("⚠️ Select exactly one solid (or group) to slice.");
        if (selected[0].userData.isSketch) return banner("⚠️ Slicing works on solids — extrude the sketch first.");
        const root = selected[0];
        // A group has no geometry of its own — slice each solid inside it.
        const meshes = collectSolidMeshes(root);
        if (!meshes.length) return banner("⚠️ That selection has no solid geometry to slice.");
        const { point, normal } = computeSlicePoint();

        const created = [];
        let crossedAny = false;

        meshes.forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const geo = mesh.geometry.toNonIndexed().clone();
          geo.applyMatrix4(mesh.matrixWorld);
          const pos = geo.attributes.position;
          const colAttr = geo.attributes.color;
          const posT=[], negT=[], cutSeg=[];
          const readV = (i) => ({
            p: new THREE.Vector3().fromBufferAttribute(pos, i),
            c: colAttr ? new THREE.Vector3(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i)) : null
          });
          for (let i=0;i<pos.count;i+=3){
            const a = readV(i), b = readV(i+1), c = readV(i+2);
            // Skip zero-area triangles for the same reason the boolean engine does:
            // a cone's apex is a fan of ~24 collapsed slivers, and feeding those to
            // the clipper produced meaningless cut segments that left the cap loop
            // full of holes. This is why slicing a cone was unreliable.
            const e1 = b.p.clone().sub(a.p), e2 = c.p.clone().sub(a.p);
            if (e1.cross(e2).lengthSq() < 1e-16) continue;
            clipTri(a, b, c, normal, point, posT, negT, cutSeg);
          }
          // This body may sit entirely on one side — that's fine when slicing a group;
          // keep it whole rather than aborting the whole operation.
          if (posT.length === 0 || negT.length === 0) {
            const keepIt = (posT.length && sliceState.keep !== 'negative') || (negT.length && sliceState.keep !== 'positive');
            if (keepIt) {
              const whole = mesh.clone();
              whole.geometry = mesh.geometry.clone();
              whole.material = Array.isArray(mesh.material) ? mesh.material.map(m=>m.clone()) : mesh.material.clone();
              created.push(whole);
            }
            return;
          }
          crossedAny = true;
          let capColor = null;
          const mat0 = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (colAttr && mat0 && mat0.color) { const bc = mat0.color; capColor = new THREE.Vector3(bc.r, bc.g, bc.b); }
          addSliceCaps(cutSeg, normal, point, posT, negT, capColor);

          const baseMat = mat0;
          const pieces = [];
          if (sliceState.keep !== 'negative') pieces.push(trisToWorldMesh(posT, baseMat.clone()));
          if (sliceState.keep !== 'positive') pieces.push(trisToWorldMesh(negT, baseMat.clone()));
          // A single cut can leave loose bodies (e.g. slicing a tube inside a block) —
          // hand each disconnected shell back as its own object.
          pieces.forEach(p => {
            const parts = splitDisconnectedShells(p);
            if (parts) parts.forEach(x => created.push(x)); else created.push(p);
          });
        });

        if (!crossedAny) return banner("⚠️ Plane doesn't cross the object — adjust offset or tilt.");
        if (!created.length) return banner("⚠️ Nothing left after the slice — check which side you're keeping.");

        transformControl.detach();
        scene.remove(root); objects = objects.filter(o => o !== root);
        created.forEach(m => { setEmissive(m, 0x000000); m.castShadow = true; m.receiveShadow = true; scene.add(m); objects.push(m); });

        // Leave the user in a clean, movable state: disarm the slicer, switch back to
        // the Select tool (there is no 'move' tool — Select is the mode where the gizmo
        // drags objects), force the gizmo into translate mode, and attach it to the
        // first new piece so it can be dragged straight away.
        sliceState.armed = false; sliceState.planeHelper.visible = false;
        document.getElementById('bld-slice-arm').classList.remove('active');
        selected = [created[0]];
        refreshSelectionVisual();
        setActiveTool('select');
        if (transformControl.setMode) transformControl.setMode('translate');
        ['gizmo-translate','gizmo-rotate','gizmo-scale'].forEach(id => {
          const el = document.getElementById(id); if (el) el.classList.toggle('active', id === 'gizmo-translate');
        });
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Slice complete — ${created.length} piece(s) created.`);
      }

      // ═══════════════════════════════════════════════════════════════════════════
      //   IMPORT  (STL binary/ascii · OBJ · 3MF)
      // ═══════════════════════════════════════════════════════════════════════════
      function addImportedGeometry(geometry, name) {
        geometry = makeGeometryCSGReady(geometry);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45 }));
        recenterMeshTransform(mesh);
        mesh.userData.name = String(name).replace(/\.[^.]+$/, '');   // label it after the file; split parts build on this
        mesh.position.z = Math.max(mesh.position.z, 10);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); objects.push(mesh);
        selected.forEach(o=>setEmissive(o,0x000000));
        selected=[mesh]; setEmissive(mesh,0x0e3d44); attachGizmoTarget(mesh);
        saveHistory(); updateStatus(); updateFloatingHUD();
        // Tell the user when the file is really several loose pieces, since Ungroup
        // can split them. Skipped on very dense meshes so a big import stays instant.
        let loose = 0;
        try { if (geometry.attributes.position.count <= 450000) loose = countLooseShells(geometry); } catch (e) {}
        banner(loose > 1 ? `Imported ${name} \u2014 it has ${loose} separate parts. Use Modify \u2192 Ungroup to split them.`
                         : `Imported ${name}.`);
      }

      // Same idea as addImportedGeometry, but for a multi-part 3MF: clamps the
      // WHOLE group above the build plate together (by the same amount), so
      // parts that are meant to sit at different relative heights — like a
      // multi-piece assembly — don't each get independently snapped to Z=10
      // and end up flattened onto one plane.
      function addImportedGeometryParts(parts, baseName) {
        const meshes = parts.map(({ geometry, name }) => {
          geometry = makeGeometryCSGReady(geometry);
          const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45 }));
          recenterMeshTransform(mesh);
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.name = name;
          return mesh;
        });

        let minZ = Infinity;
        meshes.forEach(m => { const box = new THREE.Box3().setFromObject(m); if (isFinite(box.min.z)) minZ = Math.min(minZ, box.min.z); });
        const lift = isFinite(minZ) ? Math.max(0, 10 - minZ) : 0;
        meshes.forEach(m => { m.position.z += lift; scene.add(m); objects.push(m); });

        selected.forEach(o => setEmissive(o, 0x000000));
        selected = meshes.slice();
        selected.forEach(m => setEmissive(m, 0x0e3d44));
        if (meshes.length) attachGizmoTarget(meshes[0]);
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Imported ${meshes.length} separate objects from ${baseName}.`);
      }

      // ═══════════════════════════════════════════════════════════════════════════
      //   3D TEXT — type a string, pick a font, get an extruded solid.
      // ═══════════════════════════════════════════════════════════════════════════
      const FONT_URLS = {
        helvetiker:      'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/helvetiker_regular.typeface.json',
        helvetiker_bold: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/helvetiker_bold.typeface.json',
        optimer:         'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/optimer_regular.typeface.json',
        optimer_bold:    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/optimer_bold.typeface.json',
        gentilis:        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/gentilis_regular.typeface.json',
        gentilis_bold:   'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/gentilis_bold.typeface.json'
      };
      const fontCache = {};
      const uploadedFonts = {};   // key → parsed THREE font from an uploaded TTF/OTF
      function loadFont3D(key) {
        return new Promise((resolve, reject) => {
          if (uploadedFonts[key]) return resolve(uploadedFonts[key]);
          if (fontCache[key]) return resolve(fontCache[key]);
          if (!window.THREE) return reject(new Error('3D not ready'));
          // Built-ins live in the page, so they work offline and on first load.
          if (window.MODELSMITH_FONTS && window.MODELSMITH_FONTS[key]) {
            const f = new THREE.Font(window.MODELSMITH_FONTS[key].data);
            fontCache[key] = f;
            return resolve(f);
          }
          // Anything else may still be a CDN font from an older session.
          if (!THREE.FontLoader || !FONT_URLS[key]) return reject(new Error('Unknown font'));
          new THREE.FontLoader().load(FONT_URLS[key], font => { fontCache[key] = font; resolve(font); },
            undefined, () => reject(new Error('Could not download that font')));
        });
      }

      // Convert an uploaded TTF/OTF (parsed by opentype.js) into a THREE.Font.
      //
      // We build the glyph table by asking the font's own cmap for each character we
      // care about (charToGlyph), rather than walking raw glyph indices and trusting
      // glyph.unicode — many fonts (especially OTF/CFF families like Avenir) don't
      // populate .unicode on every glyph, or order glyphs unexpectedly, which left
      // the table half-empty or mis-keyed.
      //
      // Two coordinate subtleties, both of which broke uploaded fonts before:
      //  1. opentype gives y-DOWN coordinates; three.js glyph space is y-UP, so we
      //     negate y.
      //  2. Negating y REVERSES each contour's winding — and three.js decides
      //     "solid outline vs hole" purely from winding (Font.toShapes() runs with
      //     isCCW undefined, so clockwise == solid). With winding inverted, outlines
      //     were read as holes and vice-versa, shredding every letter with a counter
      //     (e, s, o, a) while simple ones like T looked fine. Reversing each
      //     contour's point order after the flip restores the original winding.
      function opentypeToThreeFont(otFont, familyName) {
        const upm = otFont.unitsPerEm || 1000;
        const glyphs = {};

        // The characters worth converting: printable ASCII plus common Latin-1.
        const chars = [];
        for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
        for (let c = 160; c <= 255; c++) chars.push(String.fromCharCode(c));
        // plus a few typographic extras people paste in
        '‘’“”–—…•°±×÷€£'.split('').forEach(c => chars.push(c));

        const emitGlyph = (ch, g) => {
          if (!g) return;
          const path = g.getPath(0, 0, upm);   // size = upm keeps native font units

          // Split the command stream into contours so each can be reversed on its own.
          const contours = [];
          let cur = null;
          path.commands.forEach(cmd => {
            if (cmd.type === 'M') { if (cur && cur.length) contours.push(cur); cur = [cmd]; }
            else if (cmd.type === 'Z') { if (cur) { cur.push(cmd); contours.push(cur); cur = null; } }
            else if (cur) cur.push(cmd);
          });
          if (cur && cur.length) contours.push(cur);

          let o = '';
          contours.forEach(cmds => {
            const segs = [];
            let startX = 0, startY = 0;
            cmds.forEach(c => {
              if (c.type === 'M') { startX = c.x; startY = -c.y; }
              else if (c.type === 'L') segs.push({ t: 'l', x: c.x, y: -c.y });
              else if (c.type === 'Q') segs.push({ t: 'q', x1: c.x1, y1: -c.y1, x: c.x, y: -c.y });
              else if (c.type === 'C') segs.push({ t: 'b', x1: c.x1, y1: -c.y1, x2: c.x2, y2: -c.y2, x: c.x, y: -c.y });
            });
            if (!segs.length) return;

            // Reverse the contour: walk segments backwards so the last point becomes
            // the start and each curve's control points swap ends. This undoes the
            // winding flip caused by negating y.
            //
            // IMPORTANT — three.js's font path parser (Font.js) reads curve commands
            // ENDPOINT FIRST, then the control points:
            //   'q' → q <endX> <endY> <ctrlX> <ctrlY>
            //   'b' → b <endX> <endY> <ctrl1X> <ctrl1Y> <ctrl2X> <ctrl2Y>
            // (it parses cpx,cpy first then calls quadraticCurveTo(cp1, cp) /
            //  bezierCurveTo(cp1, cp2, cp)). Emitting controls first — the natural
            // reading order — silently corrupted every curve, which is why round
            // letters (e, o, s, c, a) shattered while straight ones (T, l, i) were
            // fine.
            const last = segs[segs.length - 1];
            o += `m ${last.x} ${last.y} `;
            for (let s = segs.length - 1; s >= 0; s--) {
              const seg = segs[s];
              // where this segment starts from, i.e. where the REVERSED curve ends
              const prev = s > 0 ? segs[s - 1] : { x: startX, y: startY };
              if (seg.t === 'l') {
                o += `l ${prev.x} ${prev.y} `;
              } else if (seg.t === 'q') {
                // reversed quad: end at prev, single control unchanged
                o += `q ${prev.x} ${prev.y} ${seg.x1} ${seg.y1} `;
              } else if (seg.t === 'b') {
                // reversed cubic: end at prev, controls swapped (x2 becomes first)
                o += `b ${prev.x} ${prev.y} ${seg.x2} ${seg.y2} ${seg.x1} ${seg.y1} `;
              }
            }
            o += 'z ';
          });

          const ha = (g.advanceWidth != null) ? g.advanceWidth : upm * 0.5;
          glyphs[ch] = { ha, x_min: 0, x_max: ha, o: o.trim() };
        };

        chars.forEach(ch => {
          let g = null;
          try { g = otFont.charToGlyph(ch); } catch (e) { g = null; }
          // charToGlyph returns .notdef (index 0) for unmapped chars — skip those,
          // except for space which legitimately has no outline.
          if (!g) return;
          if (g.index === 0 && ch !== ' ') return;
          emitGlyph(ch, g);
        });

        // Space often has no contours; make sure it still advances the cursor.
        if (!glyphs[' ']) {
          const sp = (() => { try { return otFont.charToGlyph(' '); } catch(e) { return null; } })();
          const ha = (sp && sp.advanceWidth) ? sp.advanceWidth : upm * 0.3;
          glyphs[' '] = { ha, x_min: 0, x_max: ha, o: '' };
        }

        const data = {
          glyphs,
          familyName,
          ascender: (otFont.ascender ?? upm * 0.8),
          descender: (otFont.descender ?? -upm * 0.2),
          underlinePosition: -100,
          underlineThickness: 50,
          boundingBox: { yMin: -upm*0.2, xMin: -upm*0.1, yMax: upm*0.8, xMax: upm },
          resolution: upm,
          original_font_information: { font_family_name: familyName }
        };
        return new THREE.Font(data);
      }

      // Identify a font file from its first four bytes rather than its extension —
      // extensions are often wrong or missing, and the real reason an upload fails
      // is almost always the container format, which we can name precisely.
      function sniffFontFormat(buf) {
        const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
        const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
        const n = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
        if (tag === 'wOFF') return 'woff';
        if (tag === 'wOF2') return 'woff2';
        if (tag === 'ttcf') return 'ttc';
        if (tag === 'OTTO') return 'otf';
        if (tag === 'true' || tag === 'typ1') return 'ttf';
        if (n === 0x00010000) return 'ttf';
        return 'unknown';
      }

      function handleFontUpload(file) {
        if (!window.opentype) { banner("⚠️ The font parser isn't available — reload the app and try again."); return; }
        banner("Reading font…");
        const reader = new FileReader();
        reader.onload = () => {
          try {
            // Check the container first so we can give a useful message instead of
            // a generic parse failure.
            const fmt = sniffFontFormat(reader.result);
            if (fmt === 'woff' || fmt === 'woff2') {
              banner("⚠️ That's a " + fmt.toUpperCase() + " web font, which can't be read directly. Convert it to .ttf or .otf and try again.");
              return;
            }
            if (fmt === 'ttc') {
              banner("⚠️ That's a font collection (.ttc) holding several fonts. Extract the one you want as a .ttf and try again.");
              return;
            }
            const otFont = opentype.parse(reader.result);
            const family = (otFont.names && otFont.names.fontFamily && (otFont.names.fontFamily.en || Object.values(otFont.names.fontFamily)[0])) || file.name.replace(/\.[^.]+$/i, '');
            const key = 'user_' + family.replace(/\s+/g, '_') + '_' + Date.now();
            const threeFont = opentypeToThreeFont(otFont, family);
            uploadedFonts[key] = threeFont;

            // Sanity check: if the font produced no usable glyphs, say so plainly
            // instead of silently generating broken text later.
            const glyphCount = Object.keys(threeFont.data.glyphs || {}).length;
            if (glyphCount < 10) {
              banner("⚠️ Only " + glyphCount + " letters could be read from that font — it may be an icon font or use an unusual encoding. Try a standard .ttf.");
              return;
            }

            // Remember it so it's still here next time the app opens.
            saveUploadedFont(key, family, threeFont);

            addFontOption(key, family, true);
            // Offer it in the 2D studio too — the store is shared, so a font
            // uploaded on either side should be usable on both.
            try {
              const psel = document.getElementById('ps-font');
              if (psel && !psel.querySelector('option[value="' + key + '"]')) {
                const o2 = document.createElement('option');
                o2.value = key; o2.textContent = family + ' (uploaded)';
                psel.appendChild(o2);
              }
            } catch (e) { /* 2D not ready yet; it reads the store on init anyway */ }
            banner(`Font "${family}" ready — available in both 3D and 2D.`);
          } catch (err) {
            console.error('Font upload failed:', err);
            banner("⚠️ Couldn't read that font: " + ((err && err.message) || 'unrecognised format') + ". A standard .ttf usually works best.");
          }
        };
        reader.onerror = () => banner("⚠️ Couldn't read that font file.");
        reader.readAsArrayBuffer(file);
      }

      // ── Uploaded font persistence ────────────────────────────────────────────
      // We store the CONVERTED three.js font data (not the raw file) — it's compact
      // JSON and skips re-parsing on load. Kept in localStorage so uploads survive
      // closing the app.
      // Bumped to v2. Fonts uploaded before the glyph-conversion fixes were cached
      // in their broken form, so they stayed shattered forever even after the code
      // was corrected — re-uploading was the only cure, and nothing said so. A new
      // key retires those stale conversions; the old entry is cleaned up and the
      // user is told to re-add the font once.
      const FONT_STORE_KEY = 'modelsmith_fonts_v2';


      function addFontOption(key, family, select) {
        const sel = document.getElementById('text3d-font');
        if (!sel || sel.querySelector(`option[value="${key}"]`)) return;
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = family + ' (uploaded)';
        sel.appendChild(opt);
        if (select) sel.value = key;
      }

      function loadFontStore() {
        try { const raw = localStorage.getItem(FONT_STORE_KEY); return raw ? JSON.parse(raw) : {}; }
        catch (e) { return {}; }
      }

      function saveUploadedFont(key, family, threeFont) {
        try {
          const store = loadFontStore();
          store[key] = { family, data: threeFont.data };
          const json = JSON.stringify(store);
          // localStorage is ~5MB; a big font can be over 1MB of JSON. If we'd blow
          // the budget, drop the oldest entries until it fits.
          if (json.length > 4.5 * 1024 * 1024) {
            const keys = Object.keys(store);
            while (keys.length > 1 && JSON.stringify(store).length > 4.5 * 1024 * 1024) {
              delete store[keys.shift()];
            }
          }
          localStorage.setItem(FONT_STORE_KEY, JSON.stringify(store));
        } catch (e) {
          banner("Font loaded for this session (too large to remember permanently).");
        }
      }

      // Rebuild previously uploaded fonts on startup.
      function restoreUploadedFonts() {
        const store = loadFontStore();
        Object.keys(store).forEach(key => {
          try {
            const rec = store[key];
            if (!rec || !rec.data) return;
            uploadedFonts[key] = new THREE.Font(rec.data);
            addFontOption(key, rec.family, false);
          } catch (e) { /* skip a corrupt entry */ }
        });
      }

      // ═══════════════════════════════════════════════════════════════════════════
      //   SCREW THREAD — build a helical thread as a solid. The outer surface radius
      //   varies as a triangular (ISO-style) wave along the helix, wrapped around a
      //   core. Generated directly as a vertex grid so it stays watertight and
      //   CSG-ready (e.g. to cut an internal thread into a part).
      // ═══════════════════════════════════════════════════════════════════════════
      // ── Preview generators for the builder dialogs ─────────────────────────
      // Each returns geometry built from the CURRENT panel settings using the same
      // code path the Add button uses, so the preview cannot drift from the real
      // result. Kept deliberately cheap: previews use coarser detail than the
      // final build, since they re-run on every slider move.
      window.MS_PREVIEW = {
        thread: () => {
          const g = (id, d) => { const e = document.getElementById(id); return e ? parseFloat(e.value) : d; };
          const t = document.getElementById('thread-type');
          const internal = t ? t.value === 'internal' : false;
          const hand = document.getElementById('thread-hand');
          const handedness = hand ? (hand.querySelector('.active') ? hand.querySelector('.active').dataset.hand : 'right') : 'right';
          const pitch = g('thread-pitch', 1.5), length = g('thread-len', 20);
          if (pitch <= 0 || pitch >= length) return null;
          return buildThreadGeometry({ diameter: g('thread-dia', 10), pitch, length, internal, handedness });
        },
        text3d: () => {
          const txt = (document.getElementById('text3d-input') || {}).value || '';
          if (!txt.trim()) return null;
          const fontKey = (document.getElementById('text3d-font') || {}).value;
          const font = fontCache && fontCache[fontKey];
          // Fonts load asynchronously. Kick the load off and ask the dialog to
          // re-preview once it lands, otherwise the first preview is always empty
          // and never recovers.
          if (!font) {
            loadFont3D(fontKey).then(() => {
              if (window.MS_PREVIEW_REFRESH) window.MS_PREVIEW_REFRESH();
            }).catch(() => {});
            return null;
          }
          const size = parseFloat((document.getElementById('text3d-size') || {}).value) || 10;
          const depth = parseFloat((document.getElementById('text3d-depth') || {}).value) || 4;
          const warpEl = document.getElementById('text3d-warp');
          const amtEl = document.getElementById('text3d-warp-amt');
          const warp = warpEl ? warpEl.value : 'none';
          const amount = (parseFloat(amtEl ? amtEl.value : 40) || 40) / 100;
          let geo = (warp && warp !== 'none')
            ? buildWarpedTextGeometry(font, txt, size, depth, warp, amount) : null;
          if (!geo) {
            const segs = Math.max(6, Math.min(12, Math.round(size * 0.6)));   // coarser for preview
            geo = new THREE.ExtrudeGeometry(textShapes(font, txt, size, segs), {
              depth, bevelEnabled: false, curveSegments: segs, steps: 1 });
            geo.rotateX(Math.PI / 2);
          }
          geo.center();
          return geo;
        },
        img3d: () => {
          // Only meaningful once an image has been dropped in.
          if (!window._img3dLastImage) return null;
          const el = (id, d) => { const e = document.getElementById(id); return e ? parseFloat(e.value) : d; };
          const mode = document.querySelector('#img3d-mode .toggle-btn.active');
          if (!mode || mode.dataset.mode !== 'relief') return null;
          return buildReliefGeometry(window._img3dLastImage, {
            footprint: el('img3d-size', 60), relief: el('img3d-relief', 6),
            base: el('img3d-base', 2),
            res: Math.min(80, parseInt(el('img3d-res', 160), 10)),   // coarse preview
            smooth: parseInt(el('img3d-rsmooth', 1), 10) || 0,
            flatten: parseInt(el('img3d-flatten', 0), 10) || 0,
            invert: (document.getElementById('img3d-invert') || {}).checked || false
          });
        }
      };

      function buildThreadGeometry(opts) {
        const {
          diameter = 10,     // outer (major) diameter
          pitch = 1.5,       // distance between adjacent crests
          length = 20,       // axial length
          internal = false,  // internal (nut) vs external (bolt)
          handedness = 'right'
        } = opts;

        // Internal threads are only ever used as a CSG cutting tool (Booleans →
        // Cut). The boolean engine here is a simple BSP-tree CSG, which gets
        // unreliable — producing a torn, self-intersecting mess instead of a
        // clean hole — when one operand is a fine, high-poly helix. External
        // threads never go through a boolean (used standalone as a rod), so
        // they can stay at full smoothness; internal ones are deliberately
        // coarser to give the boolean engine a fighting chance.
        const radialSegments = opts.radialSegments || (internal ? 18 : 32);
        const stepsPerPitch = internal ? 6 : 12;

        const majorR = diameter / 2;
        const threadDepth = Math.min(pitch * 0.6134, majorR * 0.6); // ISO metric-ish depth
        const minorR = Math.max(0.4, majorR - threadDepth);
        const dir = handedness === 'left' ? -1 : 1;
        const totalSteps = Math.max(6, Math.round((length / pitch) * stepsPerPitch));

        const positions = [];
        const V = (x,y,z) => new THREE.Vector3(x,y,z);
        const addTri = (a, b, c) => { positions.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z); };

        // radius as a triangular wave within one pitch (crest at middle, root at ends)
        const profileRadius = (phaseFrac) => {
          const tri = 1 - Math.abs(((phaseFrac % 1) + 1) % 1 * 2 - 1);
          return minorR + tri * (majorR - minorR);
        };

        // A solid, watertight thread: just the outer threaded wall plus a flat
        // disc cap at each end running straight to the axis. (An earlier version
        // also built a separate full cylindrical "core" entirely inside this
        // shell for extra safety — but a second, fully-enclosed surface nested
        // inside the first is exactly what breaks inside/outside solid
        // classification in the boolean engine: a ray through the centre crosses
        // two separate closed boundaries instead of one, so the very middle of
        // the thread was coming back classified as NOT solid. One shell, wound
        // consistently outward, is both simpler and correct.
        const grid = [];
        for (let i = 0; i <= totalSteps; i++) {
          const z = (i / totalSteps) * length;
          const row = [];
          for (let j = 0; j <= radialSegments; j++) {
            const a = (j / radialSegments) * Math.PI * 2;
            const localPhase = (z / pitch) + dir * (j / radialSegments);
            const r = profileRadius(localPhase);
            row.push(V(Math.cos(a) * r, Math.sin(a) * r, z));
          }
          grid.push(row);
        }

        // outer threaded surface (normals point outward)
        for (let i = 0; i < totalSteps; i++) {
          for (let j = 0; j < radialSegments; j++) {
            const a = grid[i][j], b = grid[i][j+1], c = grid[i+1][j+1], d = grid[i+1][j];
            addTri(a, b, c); addTri(a, c, d);
          }
        }

        // Flat disc caps, fanned straight from the axis out to the thread's own
        // profile ring at each end — this alone closes the solid.
        const discAt = (i, z, faceUp) => {
          const centre = V(0, 0, z);
          for (let j = 0; j < radialSegments; j++) {
            const p = grid[i][j], q = grid[i][j+1];
            if (faceUp) addTri(centre, p, q); else addTri(centre, q, p);
          }
        };
        discAt(totalSteps, length, true);
        discAt(0, 0, false);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.computeVertexNormals();
        geo.center();
        return geo;
      }

      function createScrewThread() {
        const diameter = parseFloat(document.getElementById('thread-dia').value) || 10;
        const pitch = parseFloat(document.getElementById('thread-pitch').value) || 1.5;
        const length = parseFloat(document.getElementById('thread-len').value) || 20;
        const internal = (document.querySelector('#thread-type .toggle-btn.active') || {}).dataset?.tt === 'internal';
        const handedness = (document.querySelector('#thread-hand .toggle-btn.active') || {}).dataset?.th || 'right';

        if (pitch >= length) return banner("⚠️ Pitch must be smaller than the length.");
        if (internal && (length / pitch) > 40) {
          banner("⚠️ That's a lot of turns for one cut — a shorter length or coarser pitch cuts more reliably. Building anyway…");
        } else {
          banner("Building thread…");
        }
        setTimeout(() => {
          try {
            const geo = buildThreadGeometry({ diameter, pitch, length, internal, handedness });
            const clean = makeGeometryCSGReady(geo);
            const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }));
            mesh.geometry.computeBoundingBox();
            const h = (mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z) / 2;
            mesh.position.z = h + 0.01;
            mesh.castShadow = true; mesh.receiveShadow = true;
            scene.add(mesh); objects.push(mesh);
            selected.forEach(o => setEmissive(o, 0x000000));
            selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
            saveHistory(); updateStatus(); updateFloatingHUD();
            banner(`Created ${internal ? 'internal' : 'external'} thread — ⌀${diameter}mm, ${pitch}mm pitch, ${length}mm long.`);
          } catch (err) {
            console.error(err); banner("⚠️ Couldn't build that thread — try different settings.");
          }
        }, 30);
      }

      // ── Glyph hole detection ────────────────────────────────────────────────
      // three.js decides which contours of a glyph are holes purely from their
      // winding direction. Fonts do not agree on that convention, and several of
      // the built-in ones wind a counter the same way as its outer ring — so the
      // hole in e, d, a, o, etc. came back as a SEPARATE SOLID sitting inside the
      // letter, which is the shattered, filled-in look those glyphs had.
      //
      // Winding is unreliable, so this ignores it and works out nesting
      // geometrically: a contour enclosed by an odd number of other contours is a
      // hole, by the standard even-odd rule. That holds no matter how the font was
      // authored, which is why this fixes every font rather than one at a time.
      function pointInContour(pt, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
          if (((yi > pt.y) !== (yj > pt.y)) &&
              (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
        }
        return inside;
      }
      function renestGlyphShapes(shapes, divisions) {
        // Flatten every contour the font gave us, however it chose to group them.
        // `divisions` sets how finely curved segments are sampled — this is what
        // actually controls how smooth round letters look.
        const d = Math.max(4, divisions || 12);
        const contours = [];
        shapes.forEach(s => {
          try { contours.push(s.extractPoints(d).shape); } catch (e) { return; }
          (s.holes || []).forEach(h => { try { contours.push(h.getPoints(d)); } catch (e) {} });
        });
        const items = contours
          .filter(p => p && p.length > 2)
          .map(p => ({ pts: p, area: Math.abs(THREE.ShapeUtils.area(p)) }))
          .filter(c => c.area > 1e-9)
          .sort((a, b) => b.area - a.area);      // biggest first, so parents precede children
        if (!items.length) return shapes;

        // Depth = how many other contours enclose this one.
        items.forEach((c, i) => {
          c.depth = 0; c.parent = null;
          const probe = c.pts[0];
          for (let j = 0; j < items.length; j++) {
            if (j === i) continue;
            if (items[j].area <= c.area) continue;          // only larger can contain
            if (pointInContour(probe, items[j].pts)) {
              c.depth++;
              // nearest (smallest) enclosing contour is the real parent
              if (!c.parent || items[j].area < c.parent.area) c.parent = items[j];
            }
          }
        });

        // Normalise winding before building the shapes.
        //
        // Detecting holes geometrically (above) says WHICH contours are holes, but
        // ExtrudeGeometry still relies on winding direction to build the side walls
        // facing the right way: an outer ring must run counter-clockwise and a hole
        // clockwise. Fonts don't guarantee that, and after re-nesting we were
        // handing it holes wound the same way as their outer. The extrusion then
        // came out with inverted faces around every counter, so the mesh was not a
        // closed solid — which is why cutting text into an object engraved only the
        // outlines instead of removing the letter bodies.
        const wind = (pts, wantCCW) => {
          const ccw = THREE.ShapeUtils.area(pts) > 0;
          return ccw === wantCCW ? pts : pts.slice().reverse();
        };
        const out = [];
        items.forEach(c => {
          if (c.depth % 2 === 0) {                          // even → a solid outline
            c.shape = new THREE.Shape(wind(c.pts, true));   // outer: counter-clockwise
            out.push(c.shape);
          }
        });
        items.forEach(c => {
          if (c.depth % 2 === 1 && c.parent && c.parent.shape) {   // odd → a hole
            c.parent.shape.holes.push(new THREE.Path(wind(c.pts, false)));  // hole: clockwise
          }
        });
        return out.length ? out : shapes;
      }
      // Build glyph shapes with holes resolved properly.
      function textShapes(font, text, size, divisions) {
        const raw = font.generateShapes(text, size);
        try { return renestGlyphShapes(raw, divisions); } catch (e) { return raw; }
      }

      // Warp a 3D glyph the same way the 2D studio warps its text. `t` is how far
      // along the string this glyph sits (0..1). The transform is applied to the
      // whole glyph rather than its individual points, so outlines stay crisp and
      // the extrusion never self-intersects.
      function warp3DGlyph(geo, mode, t, amount, size, runWidth) {
        if (!mode || mode === 'none' || !amount) return;
        const c = (t - 0.5) * 2;            // -1 at the left, +1 at the right
        const m = new THREE.Matrix4();
        switch (mode) {
          case 'arch': case 'arc': {
            const depth = size * 1.6 * amount;
            const dir = mode === 'arch' ? 1 : -1;
            geo.translate(0, 0, dir * depth * (1 - c * c));
            // Lean each glyph into the curve so it follows the tangent.
            geo.rotateY(dir * c * amount * 0.9);
            break;
          }
          // Same centring fix as the 2D side: scale about the glyph's middle so the
          // letters swell (or pinch) evenly top and bottom, rather than only rising.
          case 'bulge': {
            const s = 1 + (1 - c * c) * amount;
            const mid = size * 0.35;
            geo.translate(0, 0, -mid);
            m.makeScale(1, 1, s); geo.applyMatrix4(m);
            geo.translate(0, 0, mid);
            break;
          }
          case 'waist': {
            const s = Math.max(0.15, 1 - (1 - c * c) * amount * 0.75);
            const mid = size * 0.35;
            geo.translate(0, 0, -mid);
            m.makeScale(1, 1, s); geo.applyMatrix4(m);
            geo.translate(0, 0, mid);
            break;
          }
          case 'skew':
            // Shear the height axis along the run direction.
            m.set(1, 0, 0, 0,  0, 1, 0, 0,  amount * 0.9, 0, 1, 0,  0, 0, 0, 1);
            geo.applyMatrix4(m);
            break;
          case 'rise':
            geo.translate(0, 0, c * size * amount);
            break;
          case 'wave':
            geo.translate(0, 0, Math.sin(t * Math.PI * 2) * size * 0.55 * amount);
            geo.rotateY(-Math.cos(t * Math.PI * 2) * amount * 0.5);
            break;
          case 'fan':
            // Splay the run outward like a rainbow — each glyph rotates about the
            // run's centre rather than its own.
            geo.rotateZ(-c * amount * 0.8);
            break;
        }
      }

      // Build the text as ONE geometry per glyph so each can be warped
      // independently, then merge. Without this a warp would have to deform the
      // whole string as a single mesh, which distorts the letterforms themselves.
      function buildWarpedTextGeometry(font, text, size, depth, warp, amount) {
        const shapes = [];
        const scale = size / (font.data.resolution || 1000);
        // Measure the run first so each glyph knows how far along it sits.
        let total = 0;
        for (const ch of text) {
          const g = font.data.glyphs[ch];
          total += (g && g.ha ? g.ha : (font.data.resolution || 1000) * 0.5) * scale;
        }
        if (total <= 0) total = 1;

        const parts = [];
        let cursor = 0;
        for (const ch of text) {
          const g = font.data.glyphs[ch];
          const adv = (g && g.ha ? g.ha : (font.data.resolution || 1000) * 0.5) * scale;
          if (g && g.o && ch.trim()) {
            const segs = Math.max(8, Math.min(24, Math.round(size * 0.9)));
            const geo = new THREE.ExtrudeGeometry(textShapes(font, ch, size, segs), {
              depth, bevelEnabled: false, curveSegments: segs, steps: 1
            });
            geo.rotateX(Math.PI / 2);
            geo.translate(cursor, 0, 0);
            warp3DGlyph(geo, warp, (cursor + adv / 2) / total, amount, size, total);
            parts.push(geo);
          }
          cursor += adv;
        }
        if (!parts.length) return null;
        // Merge into a single buffer geometry, carrying the NORMALS across as well.
        // The warp transforms are applied with applyMatrix4/translate/rotate, all of
        // which update normals correctly — so the per-glyph normals are still right
        // and keep curved letters smoothly shaded. Previously only positions were
        // merged and the normals were recomputed flat, which faceted every curve.
        let totalVerts = 0;
        parts.forEach(p => { totalVerts += p.attributes.position.count; });
        const pos = new Float32Array(totalVerts * 3);
        const nrm = new Float32Array(totalVerts * 3);
        let off = 0, hasNormals = true;
        parts.forEach(p => {
          const src = p.index ? p.toNonIndexed() : p;
          const a = src.attributes.position;
          const n = src.attributes.normal;
          if (!n) hasNormals = false;
          for (let i = 0; i < a.count; i++) {
            pos[off] = a.getX(i); pos[off+1] = a.getY(i); pos[off+2] = a.getZ(i);
            if (n) { nrm[off] = n.getX(i); nrm[off+1] = n.getY(i); nrm[off+2] = n.getZ(i); }
            off += 3;
          }
        });
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, off), 3));
        if (hasNormals) out.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, off), 3));
        else out.computeVertexNormals();
        parts.forEach(p => p.dispose());
        return out;
      }

      async function generate3DText() {
        const text = (document.getElementById('text3d-input').value || '').trim();
        if (!text) return banner("⚠️ Type some text first.");
        const fontKey = document.getElementById('text3d-font').value;
        const size = parseFloat(document.getElementById('text3d-size').value) || 10;
        const depth = parseFloat(document.getElementById('text3d-depth').value) || 4;
        const warpEl = document.getElementById('text3d-warp');
        const amtEl = document.getElementById('text3d-warp-amt');
        const warp = warpEl ? warpEl.value : 'none';
        const amount = (parseFloat(amtEl ? amtEl.value : 40) || 40) / 100;

        banner("Building 3D text…");
        try {
          const font = await loadFont3D(fontKey);
          let geo = (warp && warp !== 'none')
            ? buildWarpedTextGeometry(font, text, size, depth, warp, amount)
            : null;
          if (!geo) {
            // curveSegments controls how finely each curved part of a glyph is
            // approximated. It was 6, which is very coarse — the bowls of letters
            // like e, a, c and d came out visibly polygonal, and the flat facets
            // caught the light unevenly. Scale it with the text size so small text
            // stays cheap and large text prints smooth.
            const segs = Math.max(8, Math.min(24, Math.round(size * 0.9)));
            // Extrude our own hole-corrected shapes rather than using TextGeometry,
            // which would re-derive the holes from winding and reintroduce the bug.
            geo = new THREE.ExtrudeGeometry(textShapes(font, text, size, segs), {
              depth, bevelEnabled: false, curveSegments: segs, steps: 1
            });
            geo.rotateX(Math.PI / 2);
          }
          // TextGeometry's native letter-height axis is Y; the builders above have
          // already stood it up so letter height runs along Z, the app's vertical.
          geo.computeBoundingBox();
          const center = new THREE.Vector3();
          geo.boundingBox.getCenter(center);
          geo.translate(-center.x, -center.y, -center.z);

          // Deliberately NOT makeGeometryCSGReady() here. That helper recomputes
          // vertex normals, and on a non-indexed soup that forces flat shading —
          // which turns every curve segment of a glyph into a visible facet and is
          // why 3D text looked chunky and unevenly lit. TextGeometry already
          // supplies correct normals (smooth around curves, hard at the extrusion
          // edges), so they're kept. Degenerate triangles are dropped instead,
          // which is the part that actually matters for later booleans.
          const clean = dropDegenerateTriangles(geo);
          const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.3 }));
          mesh.position.z = 12; mesh.castShadow = true; mesh.receiveShadow = true;
          scene.add(mesh); objects.push(mesh);
          selected.forEach(o => setEmissive(o, 0x000000));
          selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
          saveHistory(); updateStatus(); updateFloatingHUD();
          banner(`Added 3D text "${text}".`);
        } catch (err) {
          console.error(err);
          banner("⚠️ Couldn't load that font (needs an internet connection) — try again or pick another font.");
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      //   IMAGE → 3D — rasterize a flat image (e.g. a shape drawn in Paint) into
      //   an extruded pixel-block solid. Dark (or opaque) pixels become material,
      //   light (or transparent) pixels stay empty; the result sits flat like a
      //   plaque, extruded upward by the chosen thickness.
      // ═══════════════════════════════════════════════════════════════════════════
      function rasterizeImageToGrid(img, maxDim, threshold, polarity = 'dark') {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        const scale = maxDim / Math.max(iw, ih);
        const cols = Math.max(1, Math.round(iw * scale));
        const rows = Math.max(1, Math.round(ih * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cols; canvas.height = rows;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cols, rows);
        const data = ctx.getImageData(0, 0, cols, rows).data;
        const grid = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * 4;
            const a = data[i+3];
            const lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
            // Transparent pixels are always "empty". Otherwise the shape is either
            // the dark part (lum < threshold) or the light part, per polarity.
            let on = a >= 16 && (polarity === 'dark' ? lum < threshold : lum >= threshold);
            row.push(on);
          }
          grid.push(row);
        }
        return { grid, cols, rows };
      }

      // Emit only the outward-facing faces of the solid (skip a face wherever the
      // neighbouring cell is also filled, since that face is buried inside the
      // model) — a simple greedy face-culling extrusion of the pixel grid.
      function buildExtrudedGridGeometry(grid, cols, rows, cellSize, depth) {
        const at = (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols) ? grid[r][c] : false;
        const out = [];
        const P = (x,y,z) => new THREE.Vector3(x,y,z);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!grid[r][c]) continue;
            const x0 = c*cellSize, x1 = (c+1)*cellSize;
            const z0 = r*cellSize, z1 = (r+1)*cellSize;
            const y0 = 0, y1 = depth;
            pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y0,z1), P(x0,y0,z1), new THREE.Vector3(0,-1,0)); // bottom
            pushQuadOutward(out, P(x0,y1,z0), P(x1,y1,z0), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,1,0));  // top
            if (!at(r,c-1)) pushQuadOutward(out, P(x0,y0,z0), P(x0,y0,z1), P(x0,y1,z1), P(x0,y1,z0), new THREE.Vector3(-1,0,0));
            if (!at(r,c+1)) pushQuadOutward(out, P(x1,y0,z0), P(x1,y0,z1), P(x1,y1,z1), P(x1,y1,z0), new THREE.Vector3(1,0,0));
            if (!at(r-1,c)) pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y1,z0), P(x0,y1,z0), new THREE.Vector3(0,0,-1));
            if (!at(r+1,c)) pushQuadOutward(out, P(x0,y0,z1), P(x1,y0,z1), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,0,1));
          }
        }
        const arr = new Float32Array(out.length * 9);
        out.forEach((t,i) => { for (let j=0;j<3;j++){ arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.computeVertexNormals();
        return g;
      }

      // Trace the filled region of a boolean grid into closed polygon contours
      // using marching squares on the cell corners, then simplify + smooth them.
      // This turns a pixel blob into clean vector outlines we can extrude smoothly.
      function traceContours(grid, cols, rows) {
        // Sample "inside" at integer corner coordinates (a corner is inside if any
        // of its 4 surrounding cells is filled → gives a tight outline around the shape).
        const inside = (x, y) => {
          if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
          return grid[y][x];
        };
        // Build a padded corner field: corner (cx,cy) covers cells; use cell-centre
        // occupancy directly by treating each filled cell as a unit square. We march
        // over the grid-with-1-cell border so edges close.
        const W = cols + 2, H = rows + 2;
        const val = (cx, cy) => inside(cx - 1, cy - 1) ? 1 : 0;

        // Collect boundary segments between filled and empty cells (Moore-style).
        // Each filled cell contributes edges where its neighbour is empty; we then
        // chain those unit edges into closed loops.
        const edges = new Map(); // "x,y" -> list of "x,y" (directed boundary)
        const key = (x, y) => x + ',' + y;
        const addSeg = (ax, ay, bx, by) => {
          if (!edges.has(key(ax, ay))) edges.set(key(ax, ay), []);
          edges.get(key(ax, ay)).push([bx, by]);
        };
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            if (!grid[cy][cx]) continue;
            const x0 = cx, y0 = cy, x1 = cx + 1, y1 = cy + 1;
            // wind boundary CCW so filled is on the left
            if (!inside(cx, cy - 1)) addSeg(x0, y0, x1, y0); // top edge
            if (!inside(cx + 1, cy)) addSeg(x1, y0, x1, y1); // right
            if (!inside(cx, cy + 1)) addSeg(x1, y1, x0, y1); // bottom
            if (!inside(cx - 1, cy)) addSeg(x0, y1, x0, y0); // left
          }
        }

        // Chain segments into closed loops.
        const loops = [];
        const usedFrom = new Set();
        edges.forEach((list, from) => {
          list.forEach((to, idx) => {
            const startKey = from + '>' + idx;
            if (usedFrom.has(startKey)) return;
            // walk
            const loop = [];
            let curKey = from, curIdx = idx, guard = 0;
            let cur = from.split(',').map(Number);
            while (guard++ < 100000) {
              const outs = edges.get(curKey);
              if (!outs || !outs.length) break;
              // pick first unused outgoing
              let chosen = -1;
              for (let i = 0; i < outs.length; i++) {
                if (!usedFrom.has(curKey + '>' + i)) { chosen = i; break; }
              }
              if (chosen < 0) break;
              usedFrom.add(curKey + '>' + chosen);
              const nxt = outs[chosen];
              loop.push([cur[0], cur[1]]);
              cur = nxt;
              curKey = key(nxt[0], nxt[1]);
              if (curKey === from) { break; }
            }
            if (loop.length >= 4) loops.push(loop);
          });
        });
        return loops;
      }

      // Chaikin smoothing: rounds a polygon by cutting corners, `iters` times.
      function smoothLoop(loop, iters) {
        let pts = loop.map(p => [p[0], p[1]]);
        for (let k = 0; k < iters; k++) {
          const out = [];
          const n = pts.length;
          for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            out.push([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25]);
            out.push([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75]);
          }
          pts = out;
        }
        return pts;
      }

      // Drop points that are nearly collinear, to keep the contour light.
      function simplifyLoop(pts, tol) {
        if (pts.length < 4) return pts;
        const out = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
          const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
          const abx = b[0]-a[0], aby = b[1]-a[1], bcx = c[0]-b[0], bcy = c[1]-b[1];
          const cross = abx*bcy - aby*bcx;
          const lenA = Math.hypot(abx, aby), lenB = Math.hypot(bcx, bcy);
          if (Math.abs(cross) > tol * lenA * lenB || lenA < 1e-6) out.push(b);
        }
        out.push(pts[pts.length - 1]);
        return out;
      }

      // Signed area (shoelace) — used to tell outer contours (CCW) from holes (CW).
      function loopArea(pts) {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          a += p[0]*q[1] - q[0]*p[1];
        }
        return a / 2;
      }

      // Point-in-polygon (ray cast), for assigning holes to their outer shape.
      function pointInLoop(pt, loop) {
        let inside = false;
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
          const xi = loop[i][0], yi = loop[i][1], xj = loop[j][0], yj = loop[j][1];
          if (((yi > pt[1]) !== (yj > pt[1])) &&
              (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      }

      // ── Image → 3D relief (heightmap) ──────────────────────────────────────
      // The existing importer traces the image's OUTLINE and extrudes it flat — a
      // stamp of the silhouette. This instead reads the image's brightness as
      // HEIGHT, so shading in the picture becomes real depth: a photo of a logo or
      // a scan of a foot comes out as a contoured surface rather than a flat plate.
      //
      // Every pixel becomes a vertex on a grid, the grid is triangulated, and skirt
      // walls plus a base are added so the result is a closed solid that can be cut,
      // filleted, and printed rather than an open sheet.
      function buildReliefGeometry(img, opts) {
        const o = Object.assign({
          footprint: 60,     // mm across the longest side
          relief: 6,         // mm from the lowest point to the highest
          base: 2,           // mm of solid plate underneath
          res: 160,          // grid samples across the longest side
          invert: false,     // light = high, or dark = high
          smooth: 1,         // blur passes over the height data
          flatten: 0         // clamp the darkest N% to the base (kills noise)
        }, opts || {});

        // Sample the image into a grid.
        const ar = img.width / img.height;
        const nx = Math.max(8, Math.round(ar >= 1 ? o.res : o.res * ar));
        const ny = Math.max(8, Math.round(ar >= 1 ? o.res / ar : o.res));
        const c = document.createElement('canvas');
        c.width = nx; c.height = ny;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, nx, ny);
        const px = cx.getImageData(0, 0, nx, ny).data;

        // Perceptual luminance — a plain RGB average makes reds and blues read at
        // the wrong height, which matters on coloured scans.
        let h = new Float32Array(nx * ny);
        for (let i = 0, n = nx * ny; i < n; i++) {
          const r = px[i*4], g = px[i*4+1], b = px[i*4+2], a = px[i*4+3] / 255;
          let v = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
          v *= a;                              // transparent areas sit at the base
          h[i] = o.invert ? 1 - v : v;
        }

        // Blur to take the edge off compression noise and dithering, which would
        // otherwise print as a rough, speckled surface.
        for (let s = 0; s < o.smooth; s++) {
          const t = new Float32Array(h.length);
          for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
            let sum = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const xx = x+dx, yy = y+dy;
              if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
              sum += h[yy*nx+xx]; cnt++;
            }
            t[y*nx+x] = sum / cnt;
          }
          h = t;
        }

        // Normalise to the actual range present, so a low-contrast photo still uses
        // the full relief depth instead of coming out nearly flat.
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
        const span = (hi - lo) || 1;
        const cut = o.flatten / 100;
        for (let i = 0; i < h.length; i++) {
          let v = (h[i] - lo) / span;
          v = v <= cut ? 0 : (v - cut) / (1 - cut || 1);
          h[i] = v;
        }

        const w = o.footprint, d = o.footprint / ar;
        const sx = w / (nx - 1), sy = d / (ny - 1);
        const X = (i) => -w/2 + i * sx;
        const Y = (j) => -d/2 + j * sy;
        const Z = (i, j) => o.base + h[j*nx + i] * o.relief;

        const pos = [];
        const tri = (ax,ay,az, bx,by,bz, cx2,cy2,cz) => { pos.push(ax,ay,az, bx,by,bz, cx2,cy2,cz); };

        // Top surface.
        for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++) {
          const x0=X(i), x1=X(i+1), y0=Y(j), y1=Y(j+1);
          const z00=Z(i,j), z10=Z(i+1,j), z01=Z(i,j+1), z11=Z(i+1,j+1);
          tri(x0,y0,z00, x1,y0,z10, x1,y1,z11);
          tri(x0,y0,z00, x1,y1,z11, x0,y1,z01);
        }
        // Flat base — subdivided on the SAME grid as the skirt walls. Using a
        // single large quad here left the base edges unsplit while the walls were
        // split per column, so the corner vertices never matched up and the solid
        // came out with hundreds of open edges (and so couldn't be booleaned).
        const x0=-w/2, x1=w/2, y0=-d/2, y1=d/2;
        for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++) {
          const ax=X(i), bx=X(i+1), ay=Y(j), by=Y(j+1);
          tri(ax,ay,0, bx,by,0, bx,ay,0);
          tri(ax,ay,0, ax,by,0, bx,by,0);
        }
        // Skirt walls joining the surface to the base, so the solid is closed.
        for (let i = 0; i < nx-1; i++) {
          const xa=X(i), xb=X(i+1);
          tri(xa,y0,0, xb,y0,0, xb,y0,Z(i+1,0));
          tri(xa,y0,0, xb,y0,Z(i+1,0), xa,y0,Z(i,0));
          tri(xb,y1,0, xa,y1,0, xa,y1,Z(i,ny-1));
          tri(xb,y1,0, xa,y1,Z(i,ny-1), xb,y1,Z(i+1,ny-1));
        }
        for (let j = 0; j < ny-1; j++) {
          const ya=Y(j), yb=Y(j+1);
          tri(x1,ya,0, x1,yb,0, x1,yb,Z(nx-1,j+1));
          tri(x1,ya,0, x1,yb,Z(nx-1,j+1), x1,ya,Z(nx-1,j));
          tri(x0,yb,0, x0,ya,0, x0,ya,Z(0,j));
          tri(x0,yb,0, x0,ya,Z(0,j), x0,yb,Z(0,j+1));
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
        geo.computeVertexNormals();
        return geo;
      }

      // Read the chosen mode and hand off to the relief builder when asked.
      function img3dMode() {
        const b = document.querySelector('#img3d-mode .toggle-btn.active');
        return b ? b.dataset.mode : 'outline';
      }
      function importImageAsRelief(file) {
        const el = (id) => document.getElementById(id);
        const opts = {
          footprint: parseFloat(el('img3d-size') ? el('img3d-size').value : 60) || 60,
          relief:    parseFloat(el('img3d-relief') ? el('img3d-relief').value : 6) || 6,
          base:      parseFloat(el('img3d-base') ? el('img3d-base').value : 2) || 2,
          res:       parseInt(el('img3d-res') ? el('img3d-res').value : 160, 10) || 160,
          smooth:    parseInt(el('img3d-rsmooth') ? el('img3d-rsmooth').value : 1, 10) || 0,
          flatten:   parseInt(el('img3d-flatten') ? el('img3d-flatten').value : 0, 10) || 0,
          invert:    el('img3d-invert') ? el('img3d-invert').checked : false
        };
        banner('Reading image…');
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            window._img3dLastImage = img;   // so the dialog can preview it
            try {
              banner('Building relief — this can take a moment at high detail…');
              const geo = buildReliefGeometry(img, opts);
              const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.45 }));
              mesh.userData.name = (file.name || 'Relief').replace(/\.[^.]+$/, '');
              recenterMeshTransform(mesh);
              mesh.castShadow = true; mesh.receiveShadow = true;
              scene.add(mesh); objects.push(mesh);
              selected = [mesh];
              refreshSelectionVisual(); attachGizmoToSelection();
              saveHistory(); updateStatus(); updateFloatingHUD();
              if (window.invalidate3D) window.invalidate3D();
              const tris = geo.attributes.position.count / 3;
              banner(`Relief created — ${tris.toLocaleString()} triangles. Lower "Surface detail" if it feels heavy.`);
            } catch (err) {
              console.error('Relief build failed:', err);
              banner('⚠️ Couldn\'t build a relief from that image: ' + ((err && err.message) || err));
            }
            URL.revokeObjectURL(img.src);
          };
          img.onerror = () => banner('⚠️ Couldn\'t read that image.');
          img.src = reader.result;
        };
        reader.onerror = () => banner('⚠️ Couldn\'t read that file.');
        reader.readAsDataURL(file);
      }

      // ── QR code: exact grid extrusion (no image round-trip) ─────────────────
      // The QR panel used to render the code to a PNG and feed it through
      // importImageTo3D() like a dropped photo. That pipeline downsamples through
      // a canvas with smoothing ON by default (rasterizeImageToGrid never turns
      // it off, since a traced photo usually WANTS soft edges), then rounds
      // corners further for a natural-looking outline. Both steps blur and merge
      // module edges — fine for a logo, fatal for a QR code, where a scanner
      // expects every module to be an exact square: the printed codes came out
      // with melted, rounded modules that would not scan.
      //
      // The fix is to skip rasterization and tracing entirely. The QR matrix IS
      // already an exact boolean grid, so this extrudes it directly: one
      // axis-aligned box per dark module, sharing the app's build-face-culling
      // technique (skip a face wherever the neighbouring module is also filled,
      // since that face is buried inside the solid). No pixels, no contours, no
      // smoothing pass exists to round anything.
      window.buildQR3DFromGrid = function (modules, size, opts) {
        opts = opts || {};
        const footprint = opts.footprint || 40;
        const depth = opts.depth || 3;
        const quiet = opts.quiet != null ? opts.quiet : 4;   // standard QR light margin
        const n = size + quiet * 2;
        const cell = footprint / n;

        const at = (r, c) => {
          const rr = r - quiet, cc = c - quiet;
          return rr >= 0 && rr < size && cc >= 0 && cc < size && modules[rr][cc];
        };
        const out = [];
        let moduleCount = 0;
        const P = (x, y, z) => new THREE.Vector3(x, y, z);
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (!at(r, c)) continue;
            moduleCount++;
            const x0 = c * cell, x1 = (c + 1) * cell;
            const y0 = r * cell, y1 = (r + 1) * cell;
            const z0 = 0, z1 = depth;
            pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y1,z0), P(x0,y1,z0), new THREE.Vector3(0,0,-1)); // bottom
            pushQuadOutward(out, P(x0,y0,z1), P(x1,y0,z1), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,0,1));  // top
            if (!at(r,c-1)) pushQuadOutward(out, P(x0,y0,z0), P(x0,y1,z0), P(x0,y1,z1), P(x0,y0,z1), new THREE.Vector3(-1,0,0));
            if (!at(r,c+1)) pushQuadOutward(out, P(x1,y0,z0), P(x1,y1,z0), P(x1,y1,z1), P(x1,y0,z1), new THREE.Vector3(1,0,0));
            if (!at(r-1,c)) pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y0,z1), P(x0,y0,z1), new THREE.Vector3(0,-1,0));
            if (!at(r+1,c)) pushQuadOutward(out, P(x0,y1,z0), P(x1,y1,z0), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,1,0));
          }
        }
        if (!out.length) { banner('⚠️ That QR code has no dark modules to build.'); return null; }
        const arr = new Float32Array(out.length * 9);
        out.forEach((t, i) => { for (let j = 0; j < 3; j++) { arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        geo.computeBoundingBox();
        const c2 = new THREE.Vector3(); geo.boundingBox.getCenter(c2);
        geo.translate(-c2.x, -c2.y, 0);   // centre in X/Y, keep the base sitting at z=0
        geo.computeVertexNormals();

        const clean = makeGeometryCSGReady(geo);
        const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45, side: THREE.DoubleSide }));
        mesh.geometry.computeBoundingBox();
        mesh.position.z = 0.01;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.name = 'QR code';
        scene.add(mesh); objects.push(mesh);
        selected.forEach(o => setEmissive(o, 0x000000));
        selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Built ${moduleCount} dark modules as exact squares — no smoothing, so it scans.`);
        return mesh;
      };

      // ── Barcode: exact bar extrusion (same reasoning as the QR builder) ─────
      // A barcode's width array already strictly alternates bar, space, bar,
      // space... (that's what "symbol bar/space widths" means), so unlike the
      // QR grid there's no adjacent-module face-culling to do at all: a space
      // always separates one bar from the next, so every bar is simply its own
      // free-standing box. Straight from the encoder's own width array — no
      // image, no rasterizing, no smoothing pass to round anything.
      window.buildBarcode3DFromWidths = function (widths, opts) {
        opts = opts || {};
        const footprint = opts.footprint || 60;
        const barHeight = opts.barHeight || 18;
        const depth = opts.depth || 3;
        const quiet = opts.quiet != null ? opts.quiet : 10;   // standard quiet zone, in narrow-bar units
        const totalUnits = quiet * 2 + widths.reduce((a, b) => a + b, 0);
        const cell = footprint / totalUnits;

        const out = [];
        const P = (x, y, z) => new THREE.Vector3(x, y, z);
        const box = (x0, x1, y0, y1, z0, z1) => {
          pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y1,z0), P(x0,y1,z0), new THREE.Vector3(0,0,-1));
          pushQuadOutward(out, P(x0,y0,z1), P(x1,y0,z1), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,0,1));
          pushQuadOutward(out, P(x0,y0,z0), P(x0,y1,z0), P(x0,y1,z1), P(x0,y0,z1), new THREE.Vector3(-1,0,0));
          pushQuadOutward(out, P(x1,y0,z0), P(x1,y1,z0), P(x1,y1,z1), P(x1,y0,z1), new THREE.Vector3(1,0,0));
          pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y0,z1), P(x0,y0,z1), new THREE.Vector3(0,-1,0));
          pushQuadOutward(out, P(x0,y1,z0), P(x1,y1,z0), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,1,0));
        };
        let x = quiet * cell, barCount = 0;
        widths.forEach((w, i) => {
          const wide = w * cell;
          if (i % 2 === 0) {   // even index = bar (dark); odd = space (light)
            box(x, x + wide, 0, barHeight, 0, depth);
            barCount++;
          }
          x += wide;
        });
        if (!barCount) { banner('⚠️ That barcode has no bars to build.'); return null; }

        const arr = new Float32Array(out.length * 9);
        out.forEach((t, i) => { for (let j = 0; j < 3; j++) { arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        geo.computeBoundingBox();
        const c2 = new THREE.Vector3(); geo.boundingBox.getCenter(c2);
        geo.translate(-c2.x, -c2.y, 0);
        geo.computeVertexNormals();

        const clean = makeGeometryCSGReady(geo);
        const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45, side: THREE.DoubleSide }));
        mesh.geometry.computeBoundingBox();
        mesh.position.z = 0.01;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.name = 'Barcode';
        scene.add(mesh); objects.push(mesh);
        selected.forEach(o => setEmissive(o, 0x000000));
        selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Built ${barCount} bars as exact rectangles \u2014 no smoothing, so it scans.`);
        return mesh;
      };

      // Exposed so the QR panel (a separate script scope) can hand off a
      // generated image the same way a dropped file would arrive here. Kept for
      // the (currently unused) relief mode, which still goes through an image.
      window.importImageTo3D = (f) => importImageTo3D(f);
      function importImageTo3D(file) {
        if (img3dMode() === 'relief') return importImageAsRelief(file);
        const footprint = parseFloat(document.getElementById('img3d-size').value) || 40;
        const depth = parseFloat(document.getElementById('img3d-depth').value) || 5;
        const threshold = parseFloat(document.getElementById('img3d-thresh').value) || 128;
        const detail = parseInt(document.getElementById('img3d-detail').value, 10) || 220;
        const smoothIters = parseInt(document.getElementById('img3d-smooth').value, 10);
        const polarity = (document.querySelector('#img3d-polarity .toggle-btn.active') || {}).dataset?.pol || 'dark';

        banner("Reading image…");
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            try {
              const { grid, cols, rows } = rasterizeImageToGrid(img, detail, threshold, polarity);
              let onCount = 0; grid.forEach(row => row.forEach(v => { if (v) onCount++; }));
              if (!onCount) { banner("⚠️ Couldn't find a shape — try flipping Dark/Light or adjusting the threshold."); return; }
              if (onCount === cols * rows) { banner("⚠️ The whole image reads as the shape — try flipping Dark/Light or adjusting the threshold."); return; }

              // Trace outlines → smooth → build THREE.Shapes with holes.
              let loops = traceContours(grid, cols, rows);
              if (!loops.length) { banner("⚠️ Couldn't trace an outline — try a bolder shape or more detail."); return; }
              loops = loops
                .map(l => simplifyLoop(smoothLoop(l, smoothIters), 0.02))
                .filter(l => Math.abs(loopArea(l)) > 1.5); // drop specks
              if (!loops.length) { banner("⚠️ Only tiny specks found — use a bolder shape."); return; }

              // Separate outer contours (larger, CCW) from holes (inside another loop).
              loops.sort((a, b) => Math.abs(loopArea(b)) - Math.abs(loopArea(a)));
              const outers = [], holes = [];
              loops.forEach(l => {
                const centroid = l.reduce((s, p) => [s[0]+p[0], s[1]+p[1]], [0,0]).map(v => v / l.length);
                const container = outers.find(o => pointInLoop(centroid, o.pts));
                if (container) holes.push({ pts: l, parent: container });
                else outers.push({ pts: l, holes: [] });
              });
              holes.forEach(h => h.parent.holes.push(h.pts));

              // Normalize coordinates to the requested footprint, centre at origin.
              const scale = footprint / Math.max(cols, rows);
              const toXY = (p) => new THREE.Vector2((p[0] - cols/2) * scale, (rows/2 - p[1]) * scale);

              const shapes = outers.map(o => {
                const shape = new THREE.Shape(o.pts.map(toXY));
                o.holes.forEach(h => shape.holes.push(new THREE.Path(h.map(toXY))));
                return shape;
              });

              const geo = new THREE.ExtrudeGeometry(shapes, {
                depth, bevelEnabled: false, curveSegments: 2, steps: 1
              });
              // ExtrudeGeometry builds thickness along +Z, which is already the
              // app's vertical axis — the footprint lies flat on the build plate
              // (X/Y) and the extrusion stands straight up, no rotation needed.
              geo.computeBoundingBox();
              const c = new THREE.Vector3(); geo.boundingBox.getCenter(c);
              geo.translate(-c.x, -c.y, -c.z);

              const clean = makeGeometryCSGReady(geo);
              const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45, side: THREE.DoubleSide }));
              mesh.geometry.computeBoundingBox();
              const h2 = (mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z) / 2;
              mesh.position.z = h2 + 0.01;
              mesh.castShadow = true; mesh.receiveShadow = true;
              scene.add(mesh); objects.push(mesh);
              selected.forEach(o => setEmissive(o, 0x000000));
              selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
              saveHistory(); updateStatus(); updateFloatingHUD();
              banner(`Converted image to a smooth 3D solid (${outers.length} shape${outers.length>1?'s':''}, ${holes.length} hole${holes.length!==1?'s':''}).`);
            } catch (err) {
              console.error(err); banner("⚠️ Couldn't convert that image — try a simpler, bolder shape.");
            }
          };
          img.onerror = () => banner("⚠️ Couldn't read that image file.");
          img.src = reader.result;
        };
        reader.onerror = () => banner("⚠️ Couldn't read that file.");
        reader.readAsDataURL(file);
      }

      function parseSTL(buffer) {
        const dv = new DataView(buffer);
        // Detect ASCII: binary STL has 80-byte header + uint32 tri count; check for "solid" + plausibility
        const isAscii = (() => {
          const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength))).trim().toLowerCase();
          if (!header.startsWith('solid')) return false;
          if (buffer.byteLength < 84) return true;
          const n = dv.getUint32(80, true);
          return (84 + n*50) !== buffer.byteLength;
        })();

        const positions = [];
        if (isAscii) {
          const txt = new TextDecoder().decode(new Uint8Array(buffer));
          const re = /vertex\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)/g;
          let m; while ((m = re.exec(txt)) !== null) positions.push(+m[1], +m[2], +m[3]);
        } else {
          // Clamp the declared triangle count to what the file can actually hold —
          // a corrupt/hostile header would otherwise read past the buffer.
          if (buffer.byteLength < 84) throw new Error('STL file is truncated');
          const n = Math.min(dv.getUint32(80, true), Math.floor((buffer.byteLength - 84) / 50)); let off = 84;
          for (let i=0;i<n;i++){ off += 12; for (let j=0;j<3;j++){ positions.push(dv.getFloat32(off,true), dv.getFloat32(off+4,true), dv.getFloat32(off+8,true)); off += 12; } off += 2; }
        }
        if (!positions.length) throw new Error('No triangles found in this STL');
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.computeVertexNormals();
        return g;
      }

      function parseOBJ(text) {
        const v = [], positions = [];
        const lines = text.split('\n');
        for (const line of lines) {
          const p = line.trim().split(/\s+/);
          if (p[0] === 'v') v.push([+p[1], +p[2], +p[3]]);
          else if (p[0] === 'f') {
            const idx = p.slice(1).map(tok => { let i = parseInt(tok.split('/')[0],10); if (i<0) i = v.length + i + 1; return i-1; });
            for (let i=1;i<idx.length-1;i++){ [idx[0], idx[i], idx[i+1]].forEach(k => { const vert = v[k]; if (vert) positions.push(vert[0], vert[1], vert[2]); }); }
          }
        }
        if (!positions.length) throw new Error('No faces found in this OBJ');
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.computeVertexNormals();
        return g;
      }

      // Minimal ZIP reader supporting stored (0) and deflated (8) entries, using
      // the browser's DecompressionStream for deflate — no external libraries.
      // Also handles ZIP64 (both the whole-archive EOCD64 and per-entry 64-bit
      // size/offset fields), which larger 3MF packages commonly use — without
      // it, the placeholder 0xFFFFFFFF values were being read as real offsets,
      // walking the reader off the end of the buffer ("offset is outside the
      // bounds of the data view").
      function unzipStore(buffer) {
        const dv = new DataView(buffer); const files = {}; const u8 = new Uint8Array(buffer);
        // Find End Of Central Directory
        let eocd = -1;
        for (let i = buffer.byteLength - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
        if (eocd < 0) throw new Error('Bad 3MF (no EOCD)');

        let cdOff = dv.getUint32(eocd + 16, true);
        let count = dv.getUint16(eocd + 10, true);

        // ZIP64: standard EOCD fields are 0xFFFF/0xFFFFFFFF placeholders when
        // the real values don't fit. The real ones live in a separate ZIP64
        // EOCD record, found via a locator directly before the standard EOCD.
        if (count === 0xFFFF || cdOff === 0xFFFFFFFF) {
          const locatorOff = eocd - 20;
          if (locatorOff >= 0 && dv.getUint32(locatorOff, true) === 0x07064b50) {
            // 8-byte offset; the low 32 bits are enough for any file under 4GB,
            // which covers every realistic 3MF.
            const zip64EocdOff = dv.getUint32(locatorOff + 8, true);
            if (zip64EocdOff + 4 <= buffer.byteLength && dv.getUint32(zip64EocdOff, true) === 0x06064b50) {
              cdOff = dv.getUint32(zip64EocdOff + 48, true);
              count = dv.getUint32(zip64EocdOff + 32, true);
            }
          }
        }

        const decoded = [];
        for (let i=0;i<count;i++){
          if (cdOff + 46 > buffer.byteLength || dv.getUint32(cdOff,true) !== 0x02014b50) break;
          const method = dv.getUint16(cdOff+10, true);
          let compSize = dv.getUint32(cdOff+20, true);
          const nameLen = dv.getUint16(cdOff+28, true);
          const extraLen = dv.getUint16(cdOff+30, true);
          const commLen = dv.getUint16(cdOff+32, true);
          let lho = dv.getUint32(cdOff+42, true);
          const name = new TextDecoder().decode(u8.subarray(cdOff+46, cdOff+46+nameLen));

          // Per-entry ZIP64 extra field: real 64-bit values (low 32 bits used)
          // replace whichever standard fields were 0xFFFFFFFF placeholders, in
          // this fixed order: uncompressed size, compressed size, local header
          // offset, disk number — each present only if its standard field was
          // the placeholder.
          if (compSize === 0xFFFFFFFF || lho === 0xFFFFFFFF) {
            const uncompSizeStd = dv.getUint32(cdOff+24, true);
            let exOff = cdOff + 46 + nameLen;
            const exEnd = exOff + extraLen;
            while (exOff + 4 <= exEnd) {
              const tag = dv.getUint16(exOff, true);
              const size = dv.getUint16(exOff + 2, true);
              if (tag === 0x0001) {
                let p = exOff + 4;
                const pEnd = p + size;
                if (uncompSizeStd === 0xFFFFFFFF && p + 8 <= pEnd) { p += 8; }
                if (compSize === 0xFFFFFFFF && p + 8 <= pEnd) { compSize = dv.getUint32(p, true); p += 8; }
                if (lho === 0xFFFFFFFF && p + 8 <= pEnd) { lho = dv.getUint32(p, true); p += 8; }
              }
              exOff += 4 + size;
            }
          }

          // local header to find data start
          if (lho + 30 > buffer.byteLength) break;
          const lNameLen = dv.getUint16(lho+26, true);
          const lExtraLen = dv.getUint16(lho+28, true);
          const dataStart = lho + 30 + lNameLen + lExtraLen;
          const comp = u8.subarray(dataStart, dataStart + compSize);
          decoded.push({ name, method, comp });
          cdOff += 46 + nameLen + extraLen + commLen;
        }
        // synchronously return stored; inflate deflated via a fallback
        return new Promise(async (resolve) => {
          for (const e of decoded) {
            if (e.method === 0) files[e.name] = e.comp.slice();
            else files[e.name] = await inflateRaw(e.comp);
          }
          resolve(files);
        });
      }

      async function inflateRaw(bytes) {
        if (typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const stream = new Blob([bytes]).stream().pipeThrough(ds);
          // Read in chunks and stop at a cap, so a tiny "zip bomb" 3MF can't
          // inflate into gigabytes and take the tab down.
          const MAX_INFLATED = 512 * 1024 * 1024;
          const reader = stream.getReader();
          const chunks = []; let total = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_INFLATED) { reader.cancel(); throw new Error('3MF is too large to unpack safely'); }
            chunks.push(value);
          }
          const out = new Uint8Array(total); let o = 0;
          for (const c of chunks) { out.set(c, o); o += c.length; }
          return out;
        }
        throw new Error('Deflate not supported in this browser for 3MF import');
      }

      // Parses a 3MF package into one or more printable objects. Handles the
      // structure Bambu Studio / PrusaSlicer actually write: the mesh data for
      // each part commonly lives in its OWN file under 3D/Objects/*.model,
      // with the root 3D/3dmodel.model just referencing those object ids via
      // <build><item> and/or <components><component>. A naive reader that
      // only looks at the root file's own <vertex>/<triangle> tags finds
      // nothing there — which is exactly why those files were importing blank.
      async function parse3MF(buffer) {
        const files = await unzipStore(buffer);

        const modelParts = Object.keys(files).filter(f => f.toLowerCase().endsWith('.model'));
        if (!modelParts.length) throw new Error('No model part found in the 3MF');

        // Prefer the part named by the package relationships; fall back to the
        // conventional path, then to just the first .model file found.
        let rootPath = null;
        if (files['_rels/.rels']) {
          try {
            const relsXml = new TextDecoder().decode(files['_rels/.rels']);
            const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
            for (const rel of relsDoc.getElementsByTagName('Relationship')) {
              const type = rel.getAttribute('Type') || '';
              if (/3dmodel$/i.test(type)) {
                let target = rel.getAttribute('Target') || '';
                if (target.startsWith('/')) target = target.slice(1);
                if (files[target]) { rootPath = target; break; }
              }
            }
          } catch (e) { /* fall through to the conventional lookup below */ }
        }
        if (!rootPath) rootPath = modelParts.find(p => /3dmodel\.model$/i.test(p)) || modelParts[0];

        // Parse every .model part and index every <object> by id, regardless
        // of which file it came from — ids are unique across the whole
        // package, which is exactly what lets a root file reference a mesh
        // that physically lives in a different part.
        const objectsById = new Map();
        const parsedDocs = {};
        for (const path of modelParts) {
          const xml = new TextDecoder().decode(files[path]);
          const doc = new DOMParser().parseFromString(xml, 'application/xml');
          parsedDocs[path] = doc;
          for (const objEl of doc.getElementsByTagName('object')) {
            const id = objEl.getAttribute('id');
            if (id == null) continue;
            const meshEl = objEl.getElementsByTagName('mesh')[0];
            if (meshEl) {
              const vertsEl = meshEl.getElementsByTagName('vertices')[0];
              const trisEl = meshEl.getElementsByTagName('triangles')[0];
              const verts = vertsEl ? [...vertsEl.getElementsByTagName('vertex')].map(v => [+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z')]) : [];
              const tris = trisEl ? [...trisEl.getElementsByTagName('triangle')].map(t => [+t.getAttribute('v1'), +t.getAttribute('v2'), +t.getAttribute('v3')]) : [];
              objectsById.set(id, { verts, tris });
            } else {
              const compsEl = objEl.getElementsByTagName('components')[0];
              if (compsEl) {
                const comps = [...compsEl.getElementsByTagName('component')].map(c => ({
                  objectid: c.getAttribute('objectid'),
                  transform: c.getAttribute('transform') || null
                }));
                objectsById.set(id, { components: comps });
              }
            }
          }
        }

        // 3MF's 12-number transform is a row-vector (v·M) 4x3 matrix with
        // translation in the last row; convert to THREE's column-vector form.
        const parseTransform = (str) => {
          if (!str) return null;
          const n = str.trim().split(/\s+/).map(Number);
          if (n.length !== 12 || n.some(Number.isNaN)) return null;
          const m = new THREE.Matrix4();
          m.set(
            n[0], n[3], n[6], n[9],
            n[1], n[4], n[7], n[10],
            n[2], n[5], n[8], n[11],
            0,    0,    0,    1
          );
          return m;
        };

        // Resolves an object id into flat {verts, tris, matrix} leaves,
        // recursing through <components> and composing their transforms.
        function resolveObject(id, parentMatrix, seen) {
          if (seen.has(id)) return []; // guard against a cyclic component reference
          seen = new Set(seen); seen.add(id);
          const obj = objectsById.get(id);
          if (!obj) return [];
          if (obj.verts) return [{ verts: obj.verts, tris: obj.tris, matrix: parentMatrix }];
          const out = [];
          (obj.components || []).forEach(c => {
            const local = parseTransform(c.transform) || new THREE.Matrix4();
            out.push(...resolveObject(c.objectid, parentMatrix.clone().multiply(local), seen));
          });
          return out;
        }

        const rootDoc = parsedDocs[rootPath];
        const items = [...rootDoc.getElementsByTagName('item')].map(it => ({
          objectid: it.getAttribute('objectid'),
          transform: it.getAttribute('transform') || null
        }));
        if (!items.length) throw new Error('No build items found in the 3MF');

        const results = [];
        items.forEach((item, idx) => {
          const baseMatrix = parseTransform(item.transform) || new THREE.Matrix4();
          const leaves = resolveObject(item.objectid, baseMatrix, new Set());
          const positions = [];
          leaves.forEach(leaf => {
            leaf.tris.forEach(([a,b,c]) => {
              [a,b,c].forEach(vi => {
                const v = leaf.verts[vi];
                if (!v) return;
                const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(leaf.matrix);
                positions.push(p.x, p.y, p.z);
              });
            });
          });
          if (positions.length) results.push({ positions, name: `part_${idx+1}` });
        });
        return results;
      }

      async function importFile(file) {
        const name = file.name; const lower = name.toLowerCase();
        try {
          if (lower.endsWith('.stl')) {
            const buf = await file.arrayBuffer();
            addImportedGeometry(parseSTL(buf), name);
          } else if (lower.endsWith('.obj')) {
            const txt = await file.text();
            addImportedGeometry(parseOBJ(txt), name);
          } else if (lower.endsWith('.3mf')) {
            const buf = await file.arrayBuffer();
            const parts = await parse3MF(buf);
            if (!parts.length) throw new Error('No printable geometry found in this 3MF');
            const base = name.replace(/\.3mf$/i, '');
            const geoms = parts.map(part => {
              const g = new THREE.BufferGeometry();
              g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
              g.computeVertexNormals();
              return { geometry: g, name: `${base}_${part.name}` };
            });
            if (geoms.length > 1) addImportedGeometryParts(geoms, name);
            else addImportedGeometry(geoms[0].geometry, name);
          } else {
            banner("⚠️ Unsupported file type. Use STL, OBJ, or 3MF.");
          }
        } catch (err) { console.error(err); banner(`⚠️ Failed to import ${name}: ${err.message}`); }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      //   EXPORT  (STL binary · OBJ · 3MF)
      // ═══════════════════════════════════════════════════════════════════════════
      // ── Print check ─────────────────────────────────────────────────────────
      // Runs the checks that decide whether a model will actually print, before you
      // commit to hours on the machine. Everything here is measured from the mesh
      // itself rather than guessed at.
      function runPrintCheck(opts) {
        const o = Object.assign({ nozzle: 0.4, minWall: 0.8, overhang: 45, bed: [256, 256, 256] }, opts || {});
        const meshes = gatherExportMeshes();
        if (!meshes.length) return { empty: true };

        const weld = makeWelder(1e-4);
        const edges = new Map();          // welded edge -> use count
        let tris = 0, degenerate = 0, flipped = 0;
        let overhangArea = 0, totalArea = 0;
        const bbox = new THREE.Box3();
        const up = new THREE.Vector3(0, 0, 1);   // engine is Z-up

        meshes.forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          const m = mesh.matrixWorld;
          const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
          for (let i = 0; i < pos.count; i += 3) {
            a.fromBufferAttribute(pos, i).applyMatrix4(m);
            b.fromBufferAttribute(pos, i+1).applyMatrix4(m);
            c.fromBufferAttribute(pos, i+2).applyMatrix4(m);
            bbox.expandByPoint(a); bbox.expandByPoint(b); bbox.expandByPoint(c);
            tris++;

            const e1 = b.clone().sub(a), e2 = c.clone().sub(a);
            const n = e1.clone().cross(e2);
            const area = n.length() * 0.5;
            if (area < 1e-9) { degenerate++; continue; }
            totalArea += area;
            n.normalize();

            // Overhang: how far the face tips away from vertical. A downward-facing
            // face steeper than the threshold needs support.
            const tilt = Math.acos(Math.max(-1, Math.min(1, n.dot(up)))) * 180 / Math.PI;
            if (tilt > 90 + (90 - o.overhang)) overhangArea += area;

            // Edge bookkeeping for the watertight test.
            const wa = weld(a), wb = weld(b), wc = weld(c);
            const key = (p, q) => {
              const kp = p.x + ',' + p.y + ',' + p.z, kq = q.x + ',' + q.y + ',' + q.z;
              return kp < kq ? kp + '|' + kq : kq + '|' + kp;
            };
            [[wa, wb], [wb, wc], [wc, wa]].forEach(([p, q]) => {
              if (p === q) return;
              const k = key(p, q);
              edges.set(k, (edges.get(k) || 0) + 1);
            });
          }
        });

        // Measure ACTUAL wall thickness by ray casting.
        //
        // The obvious shortcut — flagging small triangles — is wrong: triangle size
        // is a function of tessellation, not thickness, so a finely meshed sphere
        // looks "thin" while being solid throughout. Instead we fire a ray from a
        // sample of surface points back into the solid along the inward normal and
        // measure how far it travels before leaving. That distance IS the wall.
        let thinSpots = 0, thinnest = Infinity, probes = 0;
        const maxSpan = bbox.getSize(new THREE.Vector3()).length() || 100;
        try {
          const ray = new THREE.Raycaster();
          ray.firstHitOnly = false;
          const sampleTargets = meshes.slice(0, 12);
          const step = Math.max(1, Math.floor(tris / 400));   // cap the work
          let t = 0;
          for (const mesh of sampleTargets) {
            const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
            const pos = g.attributes.position;
            const m = mesh.matrixWorld;
            const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
            for (let i = 0; i < pos.count; i += 3, t++) {
              if (t % step) continue;
              a.fromBufferAttribute(pos, i).applyMatrix4(m);
              b.fromBufferAttribute(pos, i+1).applyMatrix4(m);
              c.fromBufferAttribute(pos, i+2).applyMatrix4(m);
              const n = b.clone().sub(a).cross(c.clone().sub(a));
              if (n.lengthSq() < 1e-12) continue;
              n.normalize().multiplyScalar(-1);                 // point inward
              const centre = a.clone().add(b).add(c).multiplyScalar(1/3);
              ray.set(centre.clone().addScaledVector(n, 1e-3), n);
              // Range must comfortably exceed the wall being looked for. Capping it
              // at a small multiple of the minimum meant a thick part's far side sat
              // beyond the ray and nothing was ever measured — the check silently
              // reported "not measured" on perfectly good models.
              ray.far = Math.max(o.minWall * 20, maxSpan);
              // Raycasting skips back faces by default, and a ray travelling INTO a
              // solid only ever exits through one — so every probe missed and no
              // thickness was measured at all. Flip the material to double-sided for
              // the duration of the probe and restore it afterwards.
              const prevSide = mesh.material && mesh.material.side;
              if (mesh.material) mesh.material.side = THREE.DoubleSide;
              const hits = ray.intersectObject(mesh, false);
              if (mesh.material && prevSide !== undefined) mesh.material.side = prevSide;
              if (hits.length) {
                probes++;
                const d = hits[0].distance;
                if (d < thinnest) thinnest = d;
                if (d < o.minWall) thinSpots++;
              }
            }
          }
        } catch (e) { probes = 0; }

        let open = 0, nonManifold = 0;
        edges.forEach(count => {
          if (count === 1) open++;              // a boundary — the mesh has a hole
          else if (count > 2) nonManifold++;    // more than two faces share an edge
        });

        const size = new THREE.Vector3();
        bbox.getSize(size);
        const fitsBed = size.x <= o.bed[0] && size.y <= o.bed[1] && size.z <= o.bed[2];

        return {
          meshes: meshes.length, tris,
          open, nonManifold, degenerate,
          watertight: open === 0 && nonManifold === 0,
          thinSpots, thinnest: (thinnest === Infinity ? null : thinnest), probes,
          overhangPct: totalArea > 0 ? (overhangArea / totalArea) * 100 : 0,
          size: { x: size.x, y: size.y, z: size.z },
          fitsBed, bed: o.bed,
          minZ: bbox.min.z,
          nozzle: o.nozzle, minWall: o.minWall, overhang: o.overhang
        };
      }

      // Render the result as a readable report rather than a wall of numbers.
      function renderPrintCheck(r) {
        const box = document.getElementById('pc-results');
        if (!box) return;
        if (!r || r.empty) {
          box.innerHTML = '<div class="pc-row pc-warn"><span>Nothing to check — the scene is empty.</span></div>';
          return;
        }
        const rows = [];
        const row = (state, label, detail) =>
          rows.push('<div class="pc-row pc-' + state + '"><span class="pc-dot"></span><div><b>' +
                    label + '</b>' + (detail ? '<br><span class="pc-detail">' + detail + '</span>' : '') + '</div></div>');

        if (r.watertight) row('ok', 'Watertight', 'No holes or non-manifold edges — safe to slice.');
        else {
          const bits = [];
          if (r.open) bits.push(r.open + ' open edge' + (r.open === 1 ? '' : 's') + ' (holes in the surface)');
          if (r.nonManifold) bits.push(r.nonManifold + ' non-manifold edge' + (r.nonManifold === 1 ? '' : 's') + ' (faces meeting badly)');
          row('bad', 'Not watertight', bits.join(' · ') + '. Slicers may fill this in unpredictably.');
        }

        if (r.degenerate) row('warn', r.degenerate + ' zero-area triangle' + (r.degenerate === 1 ? '' : 's'),
          'Harmless to print, but they can upset booleans. Exporting cleans them up.');

        if (!r.probes) row('warn', 'Wall thickness not measured',
          'Couldn\'t sample this model — check thin areas by eye.');
        else if (r.thinSpots) row('bad', 'Thin walls',
          'Measured down to ' + r.thinnest.toFixed(2) + ' mm, below your ' + r.minWall +
          ' mm minimum. Thin areas may not print, or will come out weak.');
        else row('ok', 'Wall thickness',
          'Thinnest measured section is ' + (r.thinnest != null ? r.thinnest.toFixed(2) + ' mm' : 'above the limit') +
          ' — clears the ' + r.minWall + ' mm minimum.');

        const op = r.overhangPct;
        if (op > 25) row('bad', 'Heavy overhangs', op.toFixed(0) + '% of the surface is steeper than ' +
          r.overhang + '°. Expect supports, or reorient the part.');
        else if (op > 8) row('warn', 'Some overhangs', op.toFixed(0) + '% steeper than ' + r.overhang +
          '° — supports likely in places.');
        else row('ok', 'Overhangs', op.toFixed(0) + '% steep faces — should print unsupported.');

        const s = r.size;
        const dims = s.x.toFixed(1) + ' × ' + s.y.toFixed(1) + ' × ' + s.z.toFixed(1) + ' mm';
        if (r.fitsBed) row('ok', 'Fits the bed', dims + ' within ' + r.bed.join(' × ') + ' mm.');
        else row('bad', 'Too big for the bed', dims + ' exceeds ' + r.bed.join(' × ') +
          ' mm. Scale it down or split it.');

        if (Math.abs(r.minZ) > 0.05) row('warn', 'Not sitting on the build plate',
          'Lowest point is ' + r.minZ.toFixed(2) + ' mm from zero. Most slicers drop it automatically.');

        const bad = rows.filter(x => x.indexOf('pc-bad') >= 0).length;
        const warn = rows.filter(x => x.indexOf('pc-warn') >= 0).length;
        const head = '<div class="pc-summary">' +
          (bad ? '<b style="color:var(--danger,#e06c6c);">' + bad + ' problem' + (bad === 1 ? '' : 's') + '</b>'
               : (warn ? '<b style="color:var(--accent);">Ready, with ' + warn + ' note' + (warn === 1 ? '' : 's') + '</b>'
                       : '<b style="color:#6cc07a;">Ready to print</b>')) +
          ' · ' + r.meshes + ' part' + (r.meshes === 1 ? '' : 's') + ', ' + r.tris.toLocaleString() + ' triangles</div>';
        box.innerHTML = head + rows.join('');
      }

      function gatherExportMeshes() {
        // Collect renderable meshes, descending into groups. Some objects (combined
        // parts, imported multi-mesh models, baked sketch groups) are THREE.Groups
        // with no geometry of their own — their child meshes must still be exported,
        // otherwise those parts silently vanish from the STL/OBJ.
        const out = [];
        const visit = (o) => {
          if (!o.visible || o.userData.isSketch) return;
          if (o.geometry && o.type === 'Mesh') out.push(o);
          if (o.children && o.children.length) o.children.forEach(visit);
        };
        objects.forEach(visit);
        return out;
      }

      function collectWorldTriangles() {
        const tris = [];
        gatherExportMeshes().forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          for (let i=0;i<pos.count;i+=3){
            const a=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
            const b=new THREE.Vector3().fromBufferAttribute(pos,i+1).applyMatrix4(mesh.matrixWorld);
            const c=new THREE.Vector3().fromBufferAttribute(pos,i+2).applyMatrix4(mesh.matrixWorld);
            tris.push([a,b,c]);
          }
        });
        return tris;
      }

      // Save/share a generated file. Desktop browsers get a normal download. iOS
      // Safari ignores the <a download> attribute (the file silently never appears),
      // so when the Web Share API can handle files we hand the file to the native
      // share sheet instead — the user can then "Save to Files", AirDrop, etc. A
      // final fallback opens the blob in a new tab so it's never simply lost.
      async function downloadBlob(blob, filename) {
        const file = (typeof File !== 'undefined')
          ? new File([blob], filename, { type: blob.type || 'application/octet-stream' })
          : null;

        // Prefer native share on devices that support sharing files (iOS/iPadOS,
        // Android). This is what makes exports actually save on iPhone/iPad.
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') return;   // user dismissed the sheet
            // otherwise fall through to the download/open fallbacks
          }
        }

        // Standard desktop download path.
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = filename; link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();

        // iOS Safari without canShare: the click won't save, so also open the blob
        // in a new tab as a last resort so the data is reachable.
        const isIOS = /iP(hone|ad|od)/.test(navigator.platform) ||
          (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
        if (isIOS && !file) { try { window.open(url, '_blank'); } catch(e){} }

        setTimeout(() => { URL.revokeObjectURL(url); if (link.parentNode) link.parentNode.removeChild(link); }, 1500);
      }

      // Resolves the export filename: uses the name field, falls back to a prompt,
      // strips any extension the user typed, sanitizes it, and appends `.ext`.
      function resolveExportName(ext) {
        const field = document.getElementById('export-name');
        let name = field ? field.value.trim() : '';
        if (!name) {
          // No OS prompt here — the name field in the panel is the single place to
          // set this, so an empty field just falls back to a sensible default and
          // fills the field in so it's visible and editable.
          name = 'model';
          if (field) { field.value = name; field.focus(); }
          banner('Exporting as "model" — change the name in the field above if you want something else.');
        }
        if (!name) name = 'model';
        name = name.replace(/\.(stl|obj|3mf)$/i, '')       // drop any extension typed
                   .replace(/[^a-z0-9._ -]/gi, '_')        // sanitize
                   .replace(/\s+/g, '_');
        if (!name) name = 'model';
        return `${name}.${ext}`;
      }

      function exportSTL() {
        const tris = collectWorldTriangles();
        if (!tris.length) return banner("⚠️ Nothing to export.");
        const fname = resolveExportName('stl'); if (!fname) return;
        const buffer = new ArrayBuffer(84 + tris.length*50);
        const dv = new DataView(buffer);
        dv.setUint32(80, tris.length, true);
        let off = 84;
        tris.forEach(([a,b,c]) => {
          const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
          dv.setFloat32(off, n.x, true); dv.setFloat32(off+4, n.y, true); dv.setFloat32(off+8, n.z, true); off+=12;
          [a,b,c].forEach(p => { dv.setFloat32(off, p.x, true); dv.setFloat32(off+4, p.y, true); dv.setFloat32(off+8, p.z, true); off+=12; });
          dv.setUint16(off, 0, true); off+=2;
        });
        downloadBlob(new Blob([buffer], {type:'application/octet-stream'}), fname);
        banner(`Exported ${fname}`);
      }

      function exportOBJ() {
        const meshes = gatherExportMeshes();
        if (!meshes.length) return banner("⚠️ Nothing to export.");
        const fname = resolveExportName('obj'); if (!fname) return;

        // Painting apps like Procreate reject models whose UVs overlap or repeat
        // (which a triplanar/position-based projection always does). When "unwrap
        // for painting" is on, we instead give every triangle its own unique cell in
        // a packed 0..1 UV atlas — no overlaps, no repeats — so those apps accept it.
        const unwrapForPaint = !document.getElementById('export-keepuv') || !document.getElementById('export-keepuv').checked;

        let out = '# Exported from ModelSmith\n'; let base = 1;
        meshes.forEach((mesh, mi) => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          const nrm = g.attributes.normal;
          const uvAttr = g.attributes.uv; // real UVs if this mesh still has them
          const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
          out += `o object_${mi+1}\n`;

          for (let i=0;i<pos.count;i++){
            const p=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
            out += `v ${p.x.toFixed(5)} ${p.y.toFixed(5)} ${p.z.toFixed(5)}\n`;
          }

          const uvLines = [];
          if (unwrapForPaint) {
            // pack triangles into a square grid; each triangle → its own half-cell
            const triCount = pos.count / 3;
            const cols = Math.max(1, Math.ceil(Math.sqrt(triCount)));
            const cell = 1 / cols;
            const pad = cell * 0.06;      // small gutter so bleed doesn't cross cells
            for (let t=0;t<triCount;t++){
              const cx = (t % cols) * cell, cy = Math.floor(t / cols) * cell;
              const x0=cx+pad, y0=cy+pad, x1=cx+cell-pad, y1=cy+cell-pad;
              // three corners of a triangle inside the cell
              uvLines.push(`vt ${x0.toFixed(5)} ${y0.toFixed(5)}\n`);
              uvLines.push(`vt ${x1.toFixed(5)} ${y0.toFixed(5)}\n`);
              uvLines.push(`vt ${x0.toFixed(5)} ${y1.toFixed(5)}\n`);
            }
          } else {
            for (let i=0;i<pos.count;i++){
              const p=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
              let uv;
              if (uvAttr) { uv = { x: uvAttr.getX(i), y: uvAttr.getY(i) }; }
              else {
                let n = new THREE.Vector3(0,0,1);
                if (nrm) n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
                uv = window.CSGEngine.triplanarUV(p, n);
              }
              uvLines.push(`vt ${uv.x.toFixed(5)} ${uv.y.toFixed(5)}\n`);
            }
          }
          out += uvLines.join('');

          for (let i=0;i<pos.count;i+=3){
            const a=base+i, b=base+i+1, c=base+i+2;
            out += `f ${a}/${a} ${b}/${b} ${c}/${c}\n`;
          }
          base += pos.count;
        });
        downloadBlob(new Blob([out], {type:'text/plain'}), fname);
        banner(`Exported ${fname}`);
      }

      function export3MF() {
        const meshes = gatherExportMeshes();
        if (!meshes.length) return banner("⚠️ Nothing to export.");
        const fname = resolveExportName('3mf'); if (!fname) return;

        // One shared colour list for the whole file — every object (or, for a
        // vertex-painted mesh, every vertex) just references an index into it.
        const colorList = [];
        const tmpColor = new THREE.Color();
        const colorIndex = (hexStr) => {
          let idx = colorList.indexOf(hexStr);
          if (idx === -1) { idx = colorList.length; colorList.push(hexStr); }
          return idx;
        };
        const hexOf = (r, g, b) => {
          tmpColor.setRGB(r, g, b);
          return '#' + tmpColor.getHexString().toUpperCase();
        };

        const objectsXml = [];
        const buildItems = [];
        let nextId = 2; // id 1 is the shared colour group

        meshes.forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          const hasVertexColor = !Array.isArray(mesh.material) && mesh.material.vertexColors && g.attributes.color;
          const colAttr = hasVertexColor ? g.attributes.color : null;

          // Dedup vertices (position-based), same technique as before, but also
          // remember which colour-group index each deduped vertex maps to.
          const map = new Map(); const verts = []; const vertColorIdx = [];
          const key = (p) => `${p.x.toFixed(4)}_${p.y.toFixed(4)}_${p.z.toFixed(4)}`;
          const indices = [];
          for (let i = 0; i < pos.count; i++) {
            const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            const k = key(p);
            let id = map.get(k);
            if (id === undefined) {
              id = verts.length; verts.push(p); map.set(k, id);
              if (colAttr) vertColorIdx.push(colorIndex(hexOf(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i))));
            }
            indices.push(id);
          }

          const objId = nextId++;
          let defaultColorIdx;
          if (colAttr) {
            defaultColorIdx = vertColorIdx[0] || 0;
          } else {
            const mc = (!Array.isArray(mesh.material) && mesh.material.color) ? mesh.material.color : new THREE.Color(0x8a9bb8);
            defaultColorIdx = colorIndex(hexOf(mc.r, mc.g, mc.b));
          }

          let xml = `  <object id="${objId}" type="model" pid="1" pindex="${defaultColorIdx}">\n   <mesh>\n    <vertices>\n`;
          verts.forEach(p => { xml += `     <vertex x="${p.x.toFixed(5)}" y="${p.y.toFixed(5)}" z="${p.z.toFixed(5)}"/>\n`; });
          xml += `    </vertices>\n    <triangles>\n`;
          for (let i = 0; i < indices.length; i += 3) {
            const a = indices[i], b = indices[i+1], c = indices[i+2];
            const perVert = colAttr ? ` p1="${vertColorIdx[a]}" p2="${vertColorIdx[b]}" p3="${vertColorIdx[c]}"` : '';
            xml += `     <triangle v1="${a}" v2="${b}" v3="${c}"${perVert}/>\n`;
          }
          xml += `    </triangles>\n   </mesh>\n  </object>\n`;
          objectsXml.push(xml);
          buildItems.push(`  <item objectid="${objId}"/>\n`);
        });

        const colorGroupXml = `  <m:colorgroup id="1">\n` +
          colorList.map(hex => `   <m:color color="${hex}"/>\n`).join('') +
          `  </m:colorgroup>\n`;

        const model = `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n` +
          ` <resources>\n${colorGroupXml}${objectsXml.join('')} </resources>\n` +
          ` <build>\n${buildItems.join('')} </build>\n</model>\n`;

        const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n`;
        const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n`;

        const zipBlob = zipStore([
          { name: '[Content_Types].xml', data: contentTypes },
          { name: '_rels/.rels', data: rels },
          { name: '3D/3dmodel.model', data: model }
        ]);
        downloadBlob(zipBlob, fname);
        banner(`Exported ${fname} — ${meshes.length} separate object${meshes.length > 1 ? 's' : ''}, coloured.`);
      }

      // Minimal STORED (no compression) ZIP writer — valid .3mf container.
      function zipStore(entries) {
        const enc = new TextEncoder();
        const parts = []; const central = []; let offset = 0;
        const crcTable = (function(){ let c, t=[]; for(let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++) c = (c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
        function crc32(bytes){ let crc=0xFFFFFFFF; for(let i=0;i<bytes.length;i++) crc=(crc>>>8)^crcTable[(crc^bytes[i])&0xFF]; return (crc^0xFFFFFFFF)>>>0; }
        function u16(n){ return new Uint8Array([n&0xff,(n>>8)&0xff]); }
        function u32(n){ return new Uint8Array([n&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>24)&0xff]); }

        entries.forEach(e => {
          const nameBytes = enc.encode(e.name);
          const dataBytes = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
          const crc = crc32(dataBytes);
          const local = [];
          local.push(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length), u16(0), nameBytes, dataBytes);
          const localBlob = concatU8(local);
          parts.push(localBlob);
          const cen = [];
          cen.push(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes);
          central.push(concatU8(cen));
          offset += localBlob.length;
        });
        const centralBlob = concatU8(central);
        const eocd = concatU8([ u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBlob.length), u32(offset), u16(0) ]);
        return new Blob([concatU8(parts), centralBlob, eocd], { type: 'model/3mf' });
      }

      function concatU8(arrs) {
        let len = 0; arrs.forEach(a => len += a.length); const out = new Uint8Array(len); let o=0;
        arrs.forEach(a => { out.set(a, o); o += a.length; }); return out;
      }

      // Ensure the mesh has fine enough triangles for the current brush before
      // sculpting. If the average triangle edge in the hit region is large relative
      // to the brush, subdivide the whole mesh a step. This is what makes sculpting
      // high-resolution: the brush always has plenty of vertices to move.
      function ensureSculptResolution(mesh, worldBrushRadius) {
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        // sample a few triangle edge lengths (in local space) → world scale
        const scale = (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3;
        let sampleN = Math.min(pos.count, 300);
        let sumEdge = 0, cnt = 0;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        for (let i = 0; i < sampleN; i += 3) {
          a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i+1);
          sumEdge += a.distanceTo(b); cnt++;
        }
        const avgEdgeWorld = (cnt ? sumEdge / cnt : 1) * scale;
        // aim for ~6 vertices across the brush; subdivide (up to 3 passes) if coarse
        let passes = 0;
        let edge = avgEdgeWorld;
        while (edge > worldBrushRadius / 3 && passes < 3 && (geo.attributes.position.count/3) < 400000) {
          passes++; edge /= 2;
        }
        if (passes > 0) {
          const sub = subdivideGeometry(mesh.geometry, passes);
          mesh.geometry.dispose();
          mesh.geometry = sub;
        }
      }

      function handleSculptStroke() {
        const targetable = objects.filter(o => !o.userData.isSketch && o.visible);
        const intersects = raycaster.intersectObjects(targetable, true);
        if (intersects.length === 0) return;

        const hit = intersects[0];
        const mesh = hit.object;

        // Densify under the brush the first time we touch a too-coarse mesh so the
        // stroke has fine vertices to work with (high-resolution sculpting).
        if (!mesh.userData._sculptDensified) {
          ensureSculptResolution(mesh, sculptBrush.radius);
          mesh.userData._sculptDensified = true;
        }

        const geo = mesh.geometry;
        const posAttr = geo.attributes.position;
        if (!posAttr) return;

        if (!hit.face) return;
        const localHitPoint = hit.point.clone();
        mesh.worldToLocal(localHitPoint);

        const localNormal = hit.face.normal.clone().normalize();
        const localRadius = sculptBrush.radius / mesh.scale.x;
        // Gentle per-stroke displacement. The multiplier is deliberately small so
        // sculpting builds up gradually instead of denting the surface in one pass;
        // hold or drag repeatedly to push further. (Was 0.05 — far too aggressive.)
        const strength = sculptBrush.intensity * (sculptBrush.type === 'add' ? 0.008 : -0.008);

        let changed = false;
        const r2 = localRadius * localRadius;
        for (let i = 0; i < posAttr.count; i++) {
          const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
          const dx = vx - localHitPoint.x, dy = vy - localHitPoint.y, dz = vz - localHitPoint.z;
          const d2 = dx*dx + dy*dy + dz*dz;
          if (d2 < r2) {
            const dist = Math.sqrt(d2);
            // smooth cosine falloff → rounder, cleaner deformation than pow(,2)
            const t = dist / localRadius;
            const weight = 0.5 * (1 + Math.cos(Math.PI * t));
            posAttr.setX(i, vx + localNormal.x * strength * weight);
            posAttr.setY(i, vy + localNormal.y * strength * weight);
            posAttr.setZ(i, vz + localNormal.z * strength * weight);
            changed = true;
          }
        }

        if (changed) {
          posAttr.needsUpdate = true;
          geo.computeVertexNormals();
        }
      }

      function initSketchPlane(origin, norm) {
        activeSketch.origin.copy(origin); activeSketch.n.copy(norm).normalize();
        activeSketch.plane.setFromNormalAndCoplanarPoint(activeSketch.n, activeSketch.origin);

        // Build a right-handed frame (u × v = n) whose orientation follows the face's
        // tilt. We derive u by projecting the world "up" (Z) onto the face plane, so
        // the drawing axes lean with the surface — a rectangle drawn on a slightly
        // tilted face lies flat and stays aligned to that tilt, rather than snapping
        // to world axes. Only when the face is itself nearly horizontal (normal ≈ ±Z,
        // where world-up projects to nothing) do we fall back to world X.
        const n = activeSketch.n;
        let up = new THREE.Vector3(0, 0, 1);
        if (Math.abs(n.dot(up)) > 0.94) up = new THREE.Vector3(1, 0, 0); // face is horizontal
        // u = component of up lying in the face plane
        activeSketch.u.copy(up).addScaledVector(n, -up.dot(n)).normalize();
        activeSketch.v.crossVectors(n, activeSketch.u).normalize(); // v = n × u ⇒ u × v = n

        activeSketch.gridVisual.position.copy(activeSketch.origin);
        activeSketch.gridVisual.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), activeSketch.n);
        activeSketch.gridVisual.visible = true;

        activeSketch.segments = []; activeSketch.tempPoints = []; activeSketch.arcStage = 0;
        clearSketchHistory();
        currentMode = 'sketching'; transformControl.detach(); selected=[]; updateFloatingHUD();
        document.getElementById('sketch-tools').style.display = 'block';
        banner("Sketch plane set to the face. Draw your profile — it follows the surface tilt.");
      }

      function getSketchPt2D() {
        const pt = new THREE.Vector3();
        if(raycaster.ray.intersectPlane(activeSketch.plane, pt)) {
          let rel = pt.sub(activeSketch.origin);
          return new THREE.Vector2(rel.dot(activeSketch.u), rel.dot(activeSketch.v));
        }
        return null;
      }

      function pt3D(x, y) {
        return activeSketch.origin.clone().addScaledVector(activeSketch.u, x).addScaledVector(activeSketch.v, y);
      }

      function findLineIntersection(p1, p2, p3, p4) {
        let d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
        if (Math.abs(d) < 1e-6) return null;
        let u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
        let v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
        if (u >= 0.001 && u <= 0.999 && v >= 0.001 && v <= 0.999) return new THREE.Vector2(p1.x + u * (p2.x - p1.x), p1.y + u * (p2.y - p1.y));
        return null;
      }

      function splitAllIntersections() {
        let segments = activeSketch.segments;
        for (let p = 0; p < 3; p++) {
          let newSegments = []; let splitOccurred = false;
          for (let i = 0; i < segments.length; i++) {
            let s1 = segments[i]; let splitPoints = [];
            for (let j = 0; j < segments.length; j++) {
              if (i === j) continue;
              let hit = findLineIntersection(s1.p1, s1.p2, segments[j].p1, segments[j].p2);
              if (hit && !splitPoints.some(pt => pt.distanceTo(hit) < 1e-3)) splitPoints.push(hit);
            }
            if (splitPoints.length > 0) {
              splitOccurred = true;
              let pts = [s1.p1, ...splitPoints, s1.p2];
              pts.sort((a, b) => a.distanceTo(s1.p1) - b.distanceTo(s1.p1));
              for (let k = 0; k < pts.length - 1; k++) newSegments.push({ p1: pts[k], p2: pts[k+1] });
            } else newSegments.push(s1);
          }
          segments = newSegments; if (!splitOccurred) break;
        }
        activeSketch.segments = segments;
      }

      function injectRawSegment(p1, p2) {
        if (p1.distanceTo(p2) < 1e-2) return;
        activeSketch.segments.push({ p1: p1.clone(), p2: p2.clone() });
      }

      // ── Corner fillet: round the join between two straight segments ──────────
      // Click near a corner; find the two segments meeting there, then replace the
      // sharp vertex with a tangent arc of the chosen radius (like filleting the
      // corner of a square). Both lines are trimmed back to their tangent points.
      function filletCornerAt(clickPt) {
        const radius = parseFloat(document.getElementById('sk-fillet-rad').value) || 5;

        // 1. Find the segment endpoint (vertex) nearest the click.
        let bestVert = null, bestDist = 6.0; // click tolerance in mm
        activeSketch.segments.forEach(seg => {
          [seg.p1, seg.p2].forEach(v => {
            const d = clickPt.distanceTo(v);
            if (d < bestDist) { bestDist = d; bestVert = v; }
          });
        });
        if (!bestVert) { banner("Click nearer a corner where two straight lines meet."); return; }

        // 2. Collect straight segments that touch this vertex (within a small eps).
        const eps = 0.05;
        const touching = [];
        activeSketch.segments.forEach((seg, idx) => {
          if (seg.p1.distanceTo(bestVert) < eps) touching.push({ idx, seg, near: 'p1', far: seg.p2 });
          else if (seg.p2.distanceTo(bestVert) < eps) touching.push({ idx, seg, near: 'p2', far: seg.p1 });
        });
        if (touching.length !== 2) {
          banner(touching.length < 2 ? "Need two lines meeting at that corner." : "That corner has more than two lines — can't fillet it cleanly.");
          return;
        }

        const A = touching[0], B = touching[1];
        // Direction unit vectors pointing AWAY from the corner along each line.
        const dirA = new THREE.Vector2(A.far.x - bestVert.x, A.far.y - bestVert.y);
        const dirB = new THREE.Vector2(B.far.x - bestVert.x, B.far.y - bestVert.y);
        const lenA = dirA.length(), lenB = dirB.length();
        if (lenA < 1e-4 || lenB < 1e-4) { banner("Degenerate corner."); return; }
        dirA.multiplyScalar(1/lenA); dirB.multiplyScalar(1/lenB);

        // 3. Corner half-angle: cos(theta) = dirA·dirB.
        let cosT = Math.max(-1, Math.min(1, dirA.x*dirB.x + dirA.y*dirB.y));
        const theta = Math.acos(cosT);          // full interior angle between the lines
        if (theta < 0.05 || theta > Math.PI - 0.05) {
          banner("Those lines are nearly straight or overlapping — no corner to round.");
          return;
        }
        // Setback distance from the corner to each tangent point.
        const setback = radius / Math.tan(theta / 2);
        if (setback > lenA - 1e-3 || setback > lenB - 1e-3) {
          banner(`Radius too big for these lines (max ≈ ${(Math.min(lenA,lenB)*Math.tan(theta/2)).toFixed(1)} mm here).`);
          return;
        }

        sketchSnapshot();

        // 4. Tangent points on each line.
        const tanA = new THREE.Vector2(bestVert.x + dirA.x*setback, bestVert.y + dirA.y*setback);
        const tanB = new THREE.Vector2(bestVert.x + dirB.x*setback, bestVert.y + dirB.y*setback);

        // 5. Arc centre: along the bisector, at distance radius/sin(theta/2) from corner.
        const bis = new THREE.Vector2(dirA.x + dirB.x, dirA.y + dirB.y);
        const bisLen = bis.length();
        if (bisLen < 1e-6) { banner("Degenerate corner."); return; }
        bis.multiplyScalar(1/bisLen);
        const centreDist = radius / Math.sin(theta / 2);
        const centre = new THREE.Vector2(bestVert.x + bis.x*centreDist, bestVert.y + bis.y*centreDist);

        // 6. Trim the two original segments so they end at their tangent points.
        if (A.near === 'p1') A.seg.p1.copy(tanA); else A.seg.p2.copy(tanA);
        if (B.near === 'p1') B.seg.p1.copy(tanB); else B.seg.p2.copy(tanB);

        // 7. Build the arc from tanA to tanB around centre (short way).
        let a0 = Math.atan2(tanA.y - centre.y, tanA.x - centre.x);
        let a1 = Math.atan2(tanB.y - centre.y, tanB.x - centre.x);
        let sweep = a1 - a0;
        while (sweep <= -Math.PI) sweep += Math.PI*2;
        while (sweep >   Math.PI) sweep -= Math.PI*2;   // take the minor arc
        const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI/24)));
        let prev = tanA.clone();
        for (let i = 1; i <= steps; i++) {
          const a = a0 + sweep * (i/steps);
          const p = new THREE.Vector2(centre.x + Math.cos(a)*radius, centre.y + Math.sin(a)*radius);
          activeSketch.segments.push({ p1: prev.clone(), p2: p.clone() });
          prev = p;
        }

        renderSegments();
        banner(`Corner rounded — ${radius.toFixed(1)} mm radius.`);
      }

      // ── Sketch-level undo (per drawn element) ─────────────────────────────
      // Call sketchSnapshot() BEFORE an action that changes segments (drawing a
      // line, rect, circle, arc, spline, or erasing). Undo/redo swap between the
      // saved segment states so Ctrl+Z rolls back one drawn element at a time.
      function cloneSegments(segs) {
        return segs.map(s => ({ p1: s.p1.clone(), p2: s.p2.clone() }));
      }
      function sketchSnapshot() {
        activeSketch.undoStack.push(cloneSegments(activeSketch.segments));
        if (activeSketch.undoStack.length > 60) activeSketch.undoStack.shift();
        activeSketch.redoStack.length = 0;   // a new action clears the redo branch
      }
      function sketchUndo() {
        if (activeSketch.undoStack.length === 0) { banner("Nothing to undo in this sketch."); return; }
        activeSketch.redoStack.push(cloneSegments(activeSketch.segments));
        activeSketch.segments = activeSketch.undoStack.pop();
        activeSketch.tempPoints = []; activeSketch.arcStage = 0;
        renderSegments(); hideDimOverlay();
        banner("Undo (sketch)");
      }
      function sketchRedo() {
        if (activeSketch.redoStack.length === 0) { banner("Nothing to redo in this sketch."); return; }
        activeSketch.undoStack.push(cloneSegments(activeSketch.segments));
        activeSketch.segments = activeSketch.redoStack.pop();
        activeSketch.tempPoints = []; activeSketch.arcStage = 0;
        renderSegments(); hideDimOverlay();
        banner("Redo (sketch)");
      }
      function clearSketchHistory() {
        activeSketch.undoStack.length = 0;
        activeSketch.redoStack.length = 0;
      }

      function handleSketchDown() {
        let pt = getSketchPt2D(); if(!pt) return;
        const tool = activeSketch.tool;

        if (tool === 'erase') {
          let bestIdx = -1, minDist = 3.0;
          activeSketch.segments.forEach((seg, idx) => {
            let d = distanceToSegment(pt, seg.p1, seg.p2);
            if (d < minDist) { minDist = d; bestIdx = idx; }
          });
          if (bestIdx !== -1) {
            sketchSnapshot();
            activeSketch.segments.splice(bestIdx, 1);
            renderSegments(); banner("Segment erased.");
          }
          return;
        }

        if (tool === 'fillet') {
          filletCornerAt(pt);
          return;
        }

        pt = snapPoint(pt);

        if (tool === 'arc3') {
          if (activeSketch.arcStage === 0) {
            activeSketch.tempPoints = [pt.clone()];
            activeSketch.arcStage = 1;
            banner("Arc Stage 1: Point 1 fixed. Click destination endpoint.");
          } 
          else if (activeSketch.arcStage === 1) {
            activeSketch.tempPoints.push(pt.clone());
            activeSketch.arcStage = 2;
            banner("Arc Stage 2: Target fixed. Move mouse to bend curve geometry, then click to bake.");
          } 
          else if (activeSketch.arcStage === 2) {
            let pStart = activeSketch.tempPoints[0];
            let pEnd = activeSketch.tempPoints[1];
            let pCtrl = pt.clone();
            
            sketchSnapshot();
            let cv = new THREE.QuadraticBezierCurve(pStart, pCtrl, pEnd);
            let pts = cv.getPoints(24);
            for(let i=0; i<pts.length-1; i++) injectRawSegment(pts[i], pts[i+1]);
            
            splitAllIntersections();
            
            activeSketch.tempPoints = [pEnd.clone()];
            activeSketch.arcStage = 1; 
            banner("Arc profile successfully generated.");
          }
          renderSegments(pt);
          return;
        }

        if (tool === 'line' || tool === 'spline') {
          activeSketch.tempPoints.push(pt);
          if (tool === 'line' && activeSketch.tempPoints.length >= 2) {
            let len = activeSketch.tempPoints.length;
            sketchSnapshot();
            injectRawSegment(activeSketch.tempPoints[len-2], activeSketch.tempPoints[len-1]);
            activeSketch.tempPoints = [activeSketch.tempPoints[len-1]];
            splitAllIntersections();
          }
          if (tool === 'line' && activeSketch.tempPoints.length === 1) focusDimEntry();
        } 
        else if (tool === 'rect') {
          // Second corner: apply aspect-lock (square) if Shift is held or the toggle is on.
          if (activeSketch.tempPoints.length === 1 && (shiftHeld || aspectLock3D)) {
            pt = squareSketchPt(activeSketch.tempPoints[0], pt);
          }
          activeSketch.tempPoints.push(pt);
          if (activeSketch.tempPoints.length === 1) { focusDimEntry(); }
          else if (activeSketch.tempPoints.length === 2) {
            buildRect(activeSketch.tempPoints[0], activeSketch.tempPoints[1]);
            activeSketch.tempPoints = [];
            hideDimOverlay();
          }
        } 
        else if (tool === 'circle') {
          activeSketch.tempPoints.push(pt);
          if (activeSketch.tempPoints.length === 1) { focusDimEntry(); }
          else if (activeSketch.tempPoints.length === 2) {
            buildCircle(activeSketch.tempPoints[0], activeSketch.tempPoints[0].distanceTo(activeSketch.tempPoints[1]));
            activeSketch.tempPoints = [];
            hideDimOverlay();
          }
        }
        renderSegments(pt);
      }

      // Reusable geometry builders (shared by drag-to-size and typed entry).
      function buildRect(corner, opposite) {
        sketchSnapshot();
        const n0 = corner, n1 = opposite;
        const tr = new THREE.Vector2(n1.x, n0.y), bl = new THREE.Vector2(n0.x, n1.y);
        injectRawSegment(n0, tr); injectRawSegment(tr, n1); injectRawSegment(n1, bl); injectRawSegment(bl, n0);
        splitAllIntersections();
      }
      function buildCircle(center, radius) {
        if (radius < 1e-3) return;
        sketchSnapshot();
        const steps = 48; let lastPt = new THREE.Vector2(center.x + radius, center.y);
        for (let i = 1; i <= steps; i++) {
          const ang = (i / steps) * Math.PI * 2;
          const nextPt = new THREE.Vector2(center.x + Math.cos(ang)*radius, center.y + Math.sin(ang)*radius);
          injectRawSegment(lastPt, nextPt); lastPt = nextPt;
        }
        splitAllIntersections();
      }

      // Force a sketch point to make a square relative to the anchor (equal |dx|,|dy|),
      // used when Shift is held or the aspect-lock toggle is on while drawing a rect.
      function squareSketchPt(anchor, pt) {
        const dx = pt.x - anchor.x, dy = pt.y - anchor.y;
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        return new THREE.Vector2(anchor.x + Math.sign(dx || 1) * s, anchor.y + Math.sign(dy || 1) * s);
      }
      function handleSketchMove() {
        let pt = getSketchPt2D(); if(!pt) return;
        pt = snapPoint(pt);
        // Aspect-lock: while drawing a rectangle with Shift (or the toggle), keep it square.
        if (activeSketch.tool === 'rect' && activeSketch.tempPoints.length === 1 && (shiftHeld || aspectLock3D)) {
          pt = squareSketchPt(activeSketch.tempPoints[0], pt);
        }
        renderSegments(pt);
        updateDimOverlay(pt);
      }

      // Live dimension readout while sketching. The box is docked (bottom-center)
      // so it can be clicked and typed into. It shows the field(s) for the active
      // tool:  line → length · circle → radius · rect → width × height · arc → radius.
      function updateDimOverlay(cursor) {
        const box    = document.getElementById('dim-entry');
        const input  = document.getElementById('dim-entry-input');
        const input2 = document.getElementById('dim-entry-input2');
        const lead   = document.getElementById('dim-lead');
        const sep    = document.getElementById('dim-sep');
        const unit2  = document.getElementById('dim-unit2');

        const tool = activeSketch.tool;
        const started = activeSketch.tempPoints.length > 0;
        const drawingLine   = (tool === 'line'   && started);
        const drawingCircle = (tool === 'circle' && started);
        const drawingRect   = (tool === 'rect'   && started);
        const drawingArc    = (tool === 'arc3'   && activeSketch.arcStage === 1);

        if (!(drawingLine || drawingCircle || drawingRect || drawingArc)) { box.classList.remove('show'); setViewBadgeSketch(null); return; }

        // Remember the live cursor so a typed value knows which direction to grow.
        activeSketch.liveCursor = cursor.clone ? cursor.clone() : new THREE.Vector2(cursor.x, cursor.y);

        const anchor = activeSketch.tempPoints[0];
        const showSecond = drawingRect;
        sep.style.display    = showSecond ? '' : 'none';
        input2.style.display = showSecond ? '' : 'none';
        unit2.style.display  = showSecond ? '' : 'none';

        if (drawingRect) {
          lead.textContent = 'W';
          const w = Math.abs(cursor.x - anchor.x), h = Math.abs(cursor.y - anchor.y);
          if (document.activeElement !== input)  input.value  = w.toFixed(1);
          if (document.activeElement !== input2) input2.value = h.toFixed(1);
          setViewBadgeSketch(`${w.toFixed(1)} × ${h.toFixed(1)} mm`);
        } else if (drawingCircle) {
          lead.textContent = 'Radius';
          const r = anchor.distanceTo(cursor);
          if (document.activeElement !== input) input.value = r.toFixed(1);
          setViewBadgeSketch(`r ${r.toFixed(1)} mm · ⌀ ${(r*2).toFixed(1)} mm`);
        } else {
          lead.textContent = drawingArc ? 'Radius' : 'Len';
          const from = drawingArc ? anchor : activeSketch.tempPoints[activeSketch.tempPoints.length - 1];
          const len = from.distanceTo(cursor);
          if (document.activeElement !== input) input.value = len.toFixed(1);
          // For a running polyline, also show the total length drawn so far.
          if (drawingArc) {
            setViewBadgeSketch(`r ${len.toFixed(1)} mm`);
          } else {
            const total = sketchPathLength() + len;
            setViewBadgeSketch(activeSketch.tempPoints.length > 1
              ? `seg ${len.toFixed(1)} mm · total ${total.toFixed(1)} mm`
              : `${len.toFixed(1)} mm`);
          }
        }
        box.classList.add('show');
      }

      // Sum the length of the segments already placed in the current polyline draw.
      function sketchPathLength() {
        const pts = activeSketch.tempPoints;
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += pts[i-1].distanceTo(pts[i]);
        return total;
      }

      // Swap the top-right badge between its idle "mm · Z-up" label and a live
      // measurement while sketching. Passing null restores the idle label.
      function setViewBadgeSketch(text) {
        const el = document.getElementById('view-badge-text');
        if (!el) return;
        el.textContent = text || 'mm · Z-up';
        const badge = document.getElementById('view-badge');
        if (badge) badge.classList.toggle('measuring', !!text);
      }

      function hideDimOverlay() {
        const box = document.getElementById('dim-entry');
        box.classList.remove('show');
        const i1 = document.getElementById('dim-entry-input');
        const i2 = document.getElementById('dim-entry-input2');
        if (document.activeElement === i1 || document.activeElement === i2) { i1.blur(); i2.blur(); }
        dimTypedActive = false;
        setViewBadgeSketch(null);   // restore the idle "mm · Z-up" label
      }

      // Show the dimension box when a shape starts. On desktop we also focus the
      // field so you can type a size right away. On touch devices we DON'T auto-focus
      // — that would pop the on-screen keyboard up every time you pick a tool; instead
      // the box just appears and you tap it when you actually want to type a value.
      const IS_TOUCH = (typeof window !== 'undefined') &&
        ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
      function focusDimEntry() {
        const box = document.getElementById('dim-entry');
        box.classList.add('show');
        if (IS_TOUCH) return;   // leave the keyboard closed on phones/tablets
        const input = document.getElementById('dim-entry-input');
        // slight delay so the box is visible/laid out before focusing
        setTimeout(() => { input.focus(); input.select(); }, 0);
      }

      // Commit typed dimensions for whichever tool is active.
      function commitTypedDimension() {
        const input  = document.getElementById('dim-entry-input');
        const input2 = document.getElementById('dim-entry-input2');
        const tool = activeSketch.tool;
        if (activeSketch.tempPoints.length === 0) return;

        const anchor = activeSketch.tempPoints[0];
        const cursor = activeSketch.liveCursor || getSketchPt2D() || new THREE.Vector2(anchor.x + 1, anchor.y);

        if (tool === 'line') {
          const val = parseFloat(input.value);
          if (isNaN(val) || val <= 0) return;
          const last = activeSketch.tempPoints[activeSketch.tempPoints.length - 1];
          let dir = new THREE.Vector2(cursor.x - last.x, cursor.y - last.y);
          if (dir.length() < 1e-6) dir.set(1, 0);
          dir.normalize();
          const next = new THREE.Vector2(last.x + dir.x * val, last.y + dir.y * val);
          sketchSnapshot();
          injectRawSegment(last, next);
          activeSketch.tempPoints = [next];
          splitAllIntersections(); renderSegments(next);
          banner(`Line: ${val.toFixed(1)} mm`);
          // keep drawing the chain: refocus for the next segment
          focusDimEntry();
          return;
        }
        if (tool === 'circle') {
          const r = parseFloat(input.value);
          if (isNaN(r) || r <= 0) return;
          buildCircle(anchor, r);
          activeSketch.tempPoints = [];
          renderSegments(); hideDimOverlay();
          banner(`Circle: radius ${r.toFixed(1)} mm`);
          return;
        }
        if (tool === 'rect') {
          const w = parseFloat(input.value), h = parseFloat(input2.value);
          if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return;
          const dirX = (cursor.x < anchor.x) ? -1 : 1;
          const dirY = (cursor.y < anchor.y) ? -1 : 1;
          buildRect(anchor, new THREE.Vector2(anchor.x + dirX * w, anchor.y + dirY * h));
          activeSketch.tempPoints = [];
          renderSegments(); hideDimOverlay();
          banner(`Rectangle: ${w.toFixed(1)} × ${h.toFixed(1)} mm`);
          return;
        }
      }

      function distanceToSegment(p, a, b) {
        let l2 = a.distanceToSquared(b); if (l2 === 0) return p.distanceTo(a);
        let l = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
        return p.distanceTo(new THREE.Vector2(a.x + l * (b.x - a.x), a.y + l * (b.y - a.y)));
      }

      function renderSegments(cursor = null) {
        while(activeSketch.visualizerGroup.children.length > 0) { activeSketch.visualizerGroup.remove(activeSketch.visualizerGroup.children[0]); }
        
        const matLine = new THREE.LineBasicMaterial({ color: 0x2dd4a0, linewidth: 2, depthTest: false });
        const matTemp = new THREE.LineBasicMaterial({ color: 0xa8ff78, linewidth: 1, transparent: true, opacity: 0.6, depthTest: false });
        const nodeGeo = new THREE.CircleGeometry(0.35, 16);
        const matNode = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });

        activeSketch.segments.forEach(seg => {
          let geo = new THREE.BufferGeometry().setFromPoints([pt3D(seg.p1.x, seg.p1.y), pt3D(seg.p2.x, seg.p2.y)]);
          activeSketch.visualizerGroup.add(new THREE.Line(geo, matLine));
          let n1 = new THREE.Mesh(nodeGeo, matNode); n1.position.copy(pt3D(seg.p1.x, seg.p1.y)); activeSketch.visualizerGroup.add(n1);
          let n2 = new THREE.Mesh(nodeGeo, matNode); n2.position.copy(pt3D(seg.p2.x, seg.p2.y)); activeSketch.visualizerGroup.add(n2);
        });

        if (cursor) {
          let cColor = activeSketch.isSnapped ? 0xff0055 : 0x3d8ef5;
          let cSize = activeSketch.isSnapped ? 0.7 : 0.4;
          let cursorIndicator = new THREE.Mesh(new THREE.CircleGeometry(cSize, 16), new THREE.MeshBasicMaterial({ color: cColor, depthTest: false }));
          cursorIndicator.position.copy(pt3D(cursor.x, cursor.y));
          activeSketch.visualizerGroup.add(cursorIndicator);
        }

        if (cursor && activeSketch.tempPoints.length > 0) {
          let last = activeSketch.tempPoints[activeSketch.tempPoints.length - 1];
          let tool = activeSketch.tool;
          let tPts = [];

          if (tool === 'line') { tPts = [pt3D(last.x, last.y), pt3D(cursor.x, cursor.y)]; } 
          else if (tool === 'rect') {
            let n0 = activeSketch.tempPoints[0];
            tPts = [pt3D(n0.x, n0.y), pt3D(cursor.x, n0.y), pt3D(cursor.x, cursor.y), pt3D(n0.x, cursor.y), pt3D(n0.x, n0.y)];
          } 
          else if (tool === 'circle') {
            let n0 = activeSketch.tempPoints[0]; let r = n0.distanceTo(cursor);
            for(let i=0; i<=32; i++) { let a=(i/32)*Math.PI*2; tPts.push(pt3D(n0.x+Math.cos(a)*r, n0.y+Math.sin(a)*r)); }
          } 
          else if (tool === 'arc3') {
            if (activeSketch.arcStage === 1) { 
              tPts = [pt3D(activeSketch.tempPoints[0].x, activeSketch.tempPoints[0].y), pt3D(cursor.x, cursor.y)]; 
            } 
            else if (activeSketch.arcStage === 2) {
              let pA = activeSketch.tempPoints[0];
              let pB = activeSketch.tempPoints[1];
              let pC = cursor;
              
              let cv = new THREE.QuadraticBezierCurve(pA, pC, pB);
              cv.getPoints(30).forEach(p => tPts.push(pt3D(p.x, p.y)));
            }
          }
          else if (tool === 'spline') {
            let arr = [...activeSketch.tempPoints, cursor];
            if(arr.length >= 2) {
              let cv = new THREE.SplineCurve(arr);
              cv.getPoints(40).forEach(p => tPts.push(pt3D(p.x, p.y)));
            }
          }

          if (tPts.length > 0) activeSketch.visualizerGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tPts), matTemp));
        }
      }

      function extractClosedShapes() {
        let loops = [];
        let segments = activeSketch.segments.map(s => ({ p1: s.p1.clone(), p2: s.p2.clone(), used: false }));
        
        const getConnectedSegment = (pt) => {
          for (let s of segments) {
            if (s.used) continue;
            if (pt.distanceTo(s.p1) < 1e-2) { s.used = true; return { nextPt: s.p2, seg: s }; }
            if (pt.distanceTo(s.p2) < 1e-2) { s.used = true; return { nextPt: s.p1, seg: s }; }
          }
          return null;
        };

        for (let i = 0; i < segments.length; i++) {
          if (segments[i].used) continue;
          let currentLoop = [segments[i].p1];
          segments[i].used = true;
          let next = segments[i].p2;
          let active = true; let closed = false;

          while (active) {
            currentLoop.push(next);
            let edge = getConnectedSegment(next);
            if (edge) {
              next = edge.nextPt;
              if (next.distanceTo(currentLoop[0]) < 1e-2) { closed = true; active = false; }
            } else active = false;
          }

          if (closed && currentLoop.length >= 3) {
            let shape = new THREE.Shape();
            shape.moveTo(currentLoop[0].x, currentLoop[0].y);
            for (let k = 1; k < currentLoop.length; k++) { shape.lineTo(currentLoop[k].x, currentLoop[k].y); }
            loops.push(shape);
          }
        }
        return loops;
      }

      function bakeSketch() {
        let loops = extractClosedShapes();
        if (loops.length === 0) return banner("⚠️ Extrusion Guard: No airtight loop discovered.");

        sketchLayerCount++;
        let bakeGroup = new THREE.Group();
        
        const tf = new THREE.Matrix4().makeBasis(activeSketch.u, activeSketch.v, activeSketch.n).setPosition(activeSketch.origin);

        loops.forEach(ts => {
          let sGeo = new THREE.ShapeGeometry(ts);
          sGeo.applyMatrix4(tf); 
          
          let m = new THREE.Mesh(sGeo, new THREE.MeshStandardMaterial({color:0xa8ff78, roughness: 0.4, side:THREE.DoubleSide, transparent:true, opacity:0.3}));
          let eGeo = new THREE.EdgesGeometry(sGeo);
          let l = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({color:0x2dd4a0}));
          bakeGroup.add(m); bakeGroup.add(l);
        });

        bakeGroup.userData = {
          isSketch: true,
          shapes: loops,
          projectionMatrix: tf.clone(),
          // Everything needed to re-open this sketch for editing later:
          segments: activeSketch.segments.map(s => ({ p1: s.p1.clone(), p2: s.p2.clone() })),
          planeOrigin: activeSketch.origin.clone(),
          planeU: activeSketch.u.clone(),
          planeV: activeSketch.v.clone(),
          planeN: activeSketch.n.clone()
        };
        bakeGroup.name = `Sketch Layer ${sketchLayerCount}`;

        // Put the group's origin on the shape (not the plane centre) so the
        // move/scale/rotate gizmo appears on the geometry.
        recenterSketchGroup(bakeGroup);

        scene.add(bakeGroup); objects.push(bakeGroup);
        activeSketch.gridVisual.visible = false;
        while(activeSketch.visualizerGroup.children.length>0) activeSketch.visualizerGroup.remove(activeSketch.visualizerGroup.children[0]);
        document.getElementById('sketch-tools').style.display = 'none';
        currentMode = 'select';
        activeSketch.arcStage = 0;
        
        saveHistory(); updateStatus();
        banner(`Baked ${loops.length} profiles cleanly to absolute World Space.`);
      }

      // Reopen a previously baked sketch layer for editing: restore its plane and
      // segments into the live sketch, remove the baked mesh, and re-enter drawing
      // mode. Re-baking creates a fresh layer with the edited profile.
      function editBakedSketch(grp) {
        if (!grp || !grp.userData.isSketch) return;
        if (!grp.userData.segments) { banner("This sketch was made before edit support — redraw it to enable editing."); return; }

        // Switch to the Sketch tool so the panel/tools are visible.
        setActiveTool('sketch');

        // Restore the plane basis this sketch was drawn on.
        activeSketch.origin.copy(grp.userData.planeOrigin);
        activeSketch.u.copy(grp.userData.planeU);
        activeSketch.v.copy(grp.userData.planeV);
        activeSketch.n.copy(grp.userData.planeN);
        activeSketch.plane.setFromNormalAndCoplanarPoint(activeSketch.n, activeSketch.origin);

        activeSketch.gridVisual.position.copy(activeSketch.origin);
        activeSketch.gridVisual.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), activeSketch.n);
        activeSketch.gridVisual.visible = true;

        // Restore the segments to edit.
        activeSketch.segments = grp.userData.segments.map(s => ({ p1: s.p1.clone(), p2: s.p2.clone() }));
        activeSketch.tempPoints = []; activeSketch.arcStage = 0; activeSketch.tool = null;
        clearSketchHistory();

        // Remove the old baked layer (the edit replaces it on re-bake).
        detachGroupPivot && detachGroupPivot();
        scene.remove(grp);
        objects = objects.filter(o => o !== grp);
        if (selected.includes(grp)) { selected = []; transformControl.detach(); }

        currentMode = 'sketching';
        transformControl.detach();
        document.getElementById('sketch-tools').style.display = 'block';
        renderSegments();
        saveHistory(); updateStatus();
        banner("Editing sketch — adjust it, then Bake closed loops again.");
      }

      // ── Direct face push/pull ────────────────────────────────────────────
      // Finds every triangle connected to (and coplanar with) the clicked one,
      // so a face that's tessellated into many small triangles still reads as
      // one clickable face. Returns null if the geometry can't be read.
      function findCoplanarFaceTriangles(mesh, seedTriIndex) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const triCount = pos.count / 3;
        if (seedTriIndex >= triCount) return null;

        const triNormal = (t) => {
          const a = new THREE.Vector3().fromBufferAttribute(pos, t*3+0);
          const b = new THREE.Vector3().fromBufferAttribute(pos, t*3+1);
          const c = new THREE.Vector3().fromBufferAttribute(pos, t*3+2);
          return new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
        };
        const triVerts = (t) => [0,1,2].map(k => new THREE.Vector3().fromBufferAttribute(pos, t*3+k));

        const normal = triNormal(seedTriIndex);
        const seedV = triVerts(seedTriIndex);
        const planeConst = normal.dot(seedV[0]);
        const planeEps = 5e-3, normalEps = 0.999;

        const keyOf = (p) => `${p.x.toFixed(4)}_${p.y.toFixed(4)}_${p.z.toFixed(4)}`;
        const edgeKey = (a,b) => { const ka=keyOf(a), kb=keyOf(b); return ka<kb ? ka+'|'+kb : kb+'|'+ka; };
        const edgeToTris = new Map();
        for (let t = 0; t < triCount; t++) {
          const v = triVerts(t);
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(v[e], v[(e+1)%3]);
            if (!edgeToTris.has(k)) edgeToTris.set(k, []);
            edgeToTris.get(k).push(t);
          }
        }

        const isCoplanar = (t) => {
          if (triNormal(t).dot(normal) < normalEps) return false;
          return triVerts(t).every(v => Math.abs(normal.dot(v) - planeConst) < planeEps);
        };

        const included = new Set([seedTriIndex]);
        const queue = [seedTriIndex];
        while (queue.length) {
          const t = queue.pop();
          const v = triVerts(t);
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(v[e], v[(e+1)%3]);
            (edgeToTris.get(k) || []).forEach(t2 => {
              if (!included.has(t2) && isCoplanar(t2)) { included.add(t2); queue.push(t2); }
            });
          }
        }
        return { included, normal, triCount, point: seedV[0].clone(), planeConst };
      }

      function clearPushPullFaceHighlight() {
        pushPullFaceState.faces.forEach(f => { if (f.highlightMesh) scene.remove(f.highlightMesh); });
        pushPullFaceState.faces = [];
      }

      // Find a triangle on the mesh's current geometry lying on the given plane
      // (local normal + constant). Used to re-locate a picked face after the mesh
      // geometry was rebuilt by an earlier push/pull on the same object.
      function findSeedTriByPlane(mesh, planeNormal, planeConst) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const triCount = pos.count / 3;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < triCount; t++) {
          a.fromBufferAttribute(pos, t*3); b.fromBufferAttribute(pos, t*3+1); c.fromBufferAttribute(pos, t*3+2);
          const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
          if (n.dot(planeNormal) < 0.999) continue;
          if (Math.abs(n.dot(a) - planeConst) < 0.01) return t;
        }
        return -1;
      }

      function makeFaceHighlightMesh(mesh, found) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const positions = [];
        found.included.forEach(t => {
          for (let k = 0; k < 3; k++) {
            const v = new THREE.Vector3().fromBufferAttribute(pos, t*3+k).addScaledVector(found.normal, 0.05);
            positions.push(v.x, v.y, v.z);
          }
        });
        const hGeo = new THREE.BufferGeometry();
        hGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const hMat = new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.45, depthTest: true, side: THREE.DoubleSide });
        const hMesh = new THREE.Mesh(hGeo, hMat);
        hMesh.position.copy(mesh.position); hMesh.quaternion.copy(mesh.quaternion); hMesh.scale.copy(mesh.scale);
        hMesh.renderOrder = 999;
        scene.add(hMesh);
        return hMesh;
      }

      // Add a face to the push/pull selection (or toggle it off if already picked).
      // additive = keep existing picks (multi-select / shift); otherwise replace.
      function addPushPullFace(mesh, found, additive) {
        const seed = [...found.included][0];
        const existingIdx = pushPullFaceState.faces.findIndex(f => f.mesh === mesh && f.included && f.included.has(seed));
        if (existingIdx >= 0) {
          scene.remove(pushPullFaceState.faces[existingIdx].highlightMesh);
          pushPullFaceState.faces.splice(existingIdx, 1);
          return;
        }
        if (!additive) clearPushPullFaceHighlight();
        const highlightMesh = makeFaceHighlightMesh(mesh, found);
        // Record the face's local-space plane (normal + constant) so we can re-find
        // its triangles even after another face on the same mesh rebuilds geometry.
        pushPullFaceState.faces.push({
          mesh, triIndex: seed, included: found.included, highlightMesh,
          planeNormal: found.normal.clone(), planeConst: found.normal.dot(found.point || new THREE.Vector3())
        });
      }

      function handlePushPullFaceClick(e) {
        const selectable = objects.filter(o => o.visible && !o.userData.isSketch);
        const intersects = raycaster.intersectObjects(selectable, true);
        if (!intersects.length || intersects[0].faceIndex == null) {
          clearPushPullFaceHighlight();
          banner("⚠️ Click a flat face on a solid to select it.");
          return true;
        }
        let mesh = intersects[0].object;
        while (mesh.parent && mesh.parent !== scene && mesh.parent !== groupPivot && !mesh.userData.isSketch) mesh = mesh.parent;
        const found = findCoplanarFaceTriangles(mesh, intersects[0].faceIndex);
        if (!found) { banner("⚠️ Couldn't read that face."); return true; }
        const additive = multiSelectMode || (e && e.shiftKey);
        addPushPullFace(mesh, found, additive);
        selected = []; transformControl.detach();
        const n = pushPullFaceState.faces.length;
        banner(n === 0 ? "Face deselected."
          : n === 1 ? `Face selected — set direction & distance, then Apply. (Shift-click or multi-select to add more faces.)`
          : `${n} faces selected — set direction & distance, then Apply.`);
        return true;
      }

      // Extends (pull) or insets (push) a directly-picked face in place: moves
      // that coplanar patch of triangles along its own normal and stitches new
      // side walls to the rest of the (unchanged) solid, so the mesh stays
      // watertight. Vertex colours (if the object is painted) are carried over.
      function applyFacePushPull(mesh, seedTriIndex, depth) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const colAttr = geo.attributes.color;
        const triCount = pos.count / 3;

        const readTri = (t) => {
          const v = [], c = [];
          for (let k = 0; k < 3; k++) {
            v.push(new THREE.Vector3().fromBufferAttribute(pos, t*3+k));
            c.push(colAttr ? new THREE.Vector3(colAttr.getX(t*3+k), colAttr.getY(t*3+k), colAttr.getZ(t*3+k)) : null);
          }
          return { v, c };
        };
        const allTris = []; for (let t = 0; t < triCount; t++) allTris.push(readTri(t));
        const triNormal = (tri) => new THREE.Vector3().crossVectors(tri.v[1].clone().sub(tri.v[0]), tri.v[2].clone().sub(tri.v[0])).normalize();

        const seed = allTris[seedTriIndex];
        const normal = triNormal(seed);
        const planeConst = normal.dot(seed.v[0]);
        const planeEps = 5e-3, normalEps = 0.999;

        const keyOf = (p) => `${p.x.toFixed(4)}_${p.y.toFixed(4)}_${p.z.toFixed(4)}`;
        const edgeKey = (a,b) => { const ka=keyOf(a), kb=keyOf(b); return ka<kb ? ka+'|'+kb : kb+'|'+ka; };
        const edgeToTris = new Map();
        allTris.forEach((tri, t) => {
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(tri.v[e], tri.v[(e+1)%3]);
            if (!edgeToTris.has(k)) edgeToTris.set(k, []);
            edgeToTris.get(k).push(t);
          }
        });
        const isCoplanar = (t) => {
          if (triNormal(allTris[t]).dot(normal) < normalEps) return false;
          return allTris[t].v.every(v => Math.abs(normal.dot(v) - planeConst) < planeEps);
        };
        const included = new Set([seedTriIndex]);
        const queue = [seedTriIndex];
        while (queue.length) {
          const t = queue.pop();
          const tri = allTris[t];
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(tri.v[e], tri.v[(e+1)%3]);
            (edgeToTris.get(k) || []).forEach(t2 => {
              if (!included.has(t2) && isCoplanar(t2)) { included.add(t2); queue.push(t2); }
            });
          }
        }

        const moveVec = normal.clone().multiplyScalar(depth);

        // Boundary edges of the patch: an edge with only one incident triangle
        // from WITHIN the patch borders the rest of the solid.
        const patchEdgeCount = new Map();
        included.forEach(t => {
          const tri = allTris[t];
          for (let e = 0; e < 3; e++) patchEdgeCount.set(edgeKey(tri.v[e], tri.v[(e+1)%3]), (patchEdgeCount.get(edgeKey(tri.v[e], tri.v[(e+1)%3]))||0) + 1);
        });
        const boundaryEdges = [];
        included.forEach(t => {
          const tri = allTris[t];
          for (let e = 0; e < 3; e++) {
            const a = tri.v[e], b = tri.v[(e+1)%3];
            if (patchEdgeCount.get(edgeKey(a,b)) === 1) boundaryEdges.push({ a, b, ca: tri.c[e], cb: tri.c[(e+1)%3] });
          }
        });

        const centroid = new THREE.Vector3(); let ncount = 0;
        included.forEach(t => allTris[t].v.forEach(v => { centroid.add(v); ncount++; }));
        centroid.multiplyScalar(1 / Math.max(1, ncount));

        const hasColor = !!colAttr;
        const outPos = [], outCol = [];
        const pushTri = (a,b,c, ca,cb,cc) => {
          [a,b,c].forEach(v => outPos.push(v.x, v.y, v.z));
          if (hasColor) [ca,cb,cc].forEach(cv => outCol.push(cv?cv.x:1, cv?cv.y:1, cv?cv.z:1));
        };

        allTris.forEach((tri, t) => { if (!included.has(t)) pushTri(tri.v[0], tri.v[1], tri.v[2], tri.c[0], tri.c[1], tri.c[2]); });
        included.forEach(t => {
          const tri = allTris[t];
          const mv = tri.v.map(v => v.clone().add(moveVec));
          pushTri(mv[0], mv[1], mv[2], tri.c[0], tri.c[1], tri.c[2]);
        });
        boundaryEdges.forEach(({a,b,ca,cb}) => {
          const a2 = a.clone().add(moveVec), b2 = b.clone().add(moveVec);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const hint = new THREE.Vector3().crossVectors(normal, b.clone().sub(a));
          if (hint.lengthSq() < 1e-10) return;
          hint.normalize();
          if (hint.dot(mid.clone().sub(centroid)) < 0) hint.negate();
          const n2 = new THREE.Vector3().crossVectors(b.clone().sub(a), b2.clone().sub(a));
          if (n2.dot(hint) < 0) { pushTri(a, a2, b2, ca, ca, cb); pushTri(a, b2, b, ca, cb, cb); }
          else { pushTri(a, b, b2, ca, cb, cb); pushTri(a, b2, a2, ca, cb, ca); }
        });

        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
        if (hasColor) newGeo.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
        newGeo.computeVertexNormals();

        mesh.geometry.dispose();
        mesh.geometry = newGeo;
        mesh.geometry.computeBoundingBox();
        return { faceTriCount: included.size, boundaryCount: boundaryEdges.length };
      }

      function extrudeSelectedSketch() {


        if(selected.length === 0 || !selected[0].userData.isSketch) return banner("⚠️ Select a sketch layer from the list first.");
        const sketchGrp = selected[0];
        const depth = Math.abs(parseFloat(document.getElementById('bld-exh').value) || 15);
        const shapes = sketchGrp.userData.shapes;

        // Full world transform of the sketch plane (bake-time projection composed
        // with any recenter + move the user applied to the layer since).
        const tf = sketchWorldMatrix(sketchGrp);

        // Push in = extrude along the plane's -normal; pull out = along +normal.
        // ExtrudeGeometry always extrudes toward +Z, so for "push" we negate Z
        // before applying the plane transform.
        const dirMatrix = new THREE.Matrix4();
        if (pushDir === 'push') dirMatrix.makeScale(1, 1, -1);

        const baseMat = new THREE.MeshStandardMaterial({color: 0x3d8ef5, roughness: 0.4});

        shapes.forEach(sh => {
          let geo = new THREE.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: false, steps: 1 });
          // Keep the extrusion's clean flat faces (straight edges, no chopped-up
          // triangles). The sculpt brush densifies on demand now, so there's no need
          // to pre-tessellate here — that was what left tiny triangles on the walls.
          geo = makeGeometryCSGReady(geo);

          // Apply direction flip, then bake the plane transform into the vertices so
          // they sit at true WORLD positions; recenter with identity mesh rotation so
          // the solid behaves like a primitive under the move/scale gizmo.
          geo.applyMatrix4(dirMatrix);
          geo.applyMatrix4(tf);
          geo.computeBoundingBox();
          const center = new THREE.Vector3();
          geo.boundingBox.getCenter(center);
          geo.translate(-center.x, -center.y, -center.z);

          const mesh = new THREE.Mesh(geo, baseMat.clone());
          mesh.position.copy(center);
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.updateMatrixWorld(true);
          scene.add(mesh); objects.push(mesh);
        });

        sketchGrp.visible = false;
        selected = []; transformControl.detach();
        saveHistory(); updateStatus();
        banner(`${pushDir === 'push' ? 'Pushed in' : 'Pulled out'} ${shapes.length} profile(s) by ${depth} mm.`);
      }

      function updateLayersUI() {
        const list = document.getElementById('layers-list');
        list.innerHTML = '';
        const sketches = objects.filter(o => o.userData.isSketch);
        
        if (sketches.length === 0) {
          list.innerHTML = `<div class="empty-note">No sketches baked yet.</div>`;
          return;
        }

        const layerIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/></svg>`;
        const eyeOn = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
        const eyeOff = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-1.7 2.5M6.6 6.6A13 13 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/></svg>`;
        const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>`;
        const trashIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;

        sketches.forEach((sk) => {
          const div = document.createElement('div');
          div.className = `layer-item ${selected.includes(sk) ? 'active' : ''}`;
          div.innerHTML = `
            <span class="layer-name">${layerIcon}${sk.name || 'Sketch'}</span>
            <div class="layer-actions">
              <span class="layer-action edit-btn" title="Edit sketch">${editIcon}</span>
              <span class="layer-action vis-toggle" title="Toggle visibility">${sk.visible ? eyeOn : eyeOff}</span>
              <span class="layer-action del-btn" title="Delete layer">${trashIcon}</span>
            </div>
          `;
          
          div.querySelector('.layer-name').onclick = () => {
            clearPushPullFaceHighlight();
            selectOnly(sk);
          };

          div.querySelector('.edit-btn').onclick = (e) => {
            e.stopPropagation();
            editBakedSketch(sk);
          };

          div.querySelector('.vis-toggle').onclick = (e) => {
            e.stopPropagation();
            sk.visible = !sk.visible;
            updateStatus(); 
          };

          div.querySelector('.del-btn').onclick = (e) => {
            e.stopPropagation();
            scene.remove(sk);
            objects = objects.filter(o => o !== sk);
            if(selected.includes(sk)) { selected = []; transformControl.detach(); }
            saveHistory(); updateStatus();
          };
          list.appendChild(div);
        });
      }

      // Rebuilds the build-plate grid at a new size (GridHelper's size is baked
      // into its geometry at construction, so growing it means replacing it).
      function rebuildGrid(size) {
        const divisions = Math.max(10, Math.round(size / 10));
        scene.remove(grid);
        grid.geometry.dispose(); grid.material.dispose();
        grid = new THREE.GridHelper(size, divisions, 0xc2895f, 0x262b34);
        grid.rotation.x = Math.PI / 2;
        grid.material.opacity = 0.5; grid.material.transparent = true;
        scene.add(grid);
        currentGridSize = size;
      }

      // Checks the current model's footprint against the build plate and grows
      // the plate (never shrinks it, to avoid distracting resize "thrashing"
      // while editing) if something now extends past its edge.
      function updateGridExtent() {
        const box = new THREE.Box3();
        let any = false;
        objects.forEach(o => { if (o.visible && !o.userData.isSketch) { box.expandByObject(o); any = true; } });
        if (!any || !isFinite(box.min.x)) return;
        const spanX = box.max.x - box.min.x;
        const spanY = box.max.y - box.min.y; // Y is the other horizontal axis (Z is vertical)
        const neededSpan = Math.max(spanX, spanY) * 1.6; // margin so the plate clearly reads bigger than the model
        const targetSize = Math.max(300, Math.ceil(neededSpan / 50) * 50);
        if (targetSize > currentGridSize) rebuildGrid(targetSize);
      }

      // ── Session autosave / crash recovery ────────────────────────────────
      // Serialise the current objects (geometry + transform + colour) into
      // localStorage every few seconds and after edits, so an accidental close or
      // crash doesn't lose work. Restored on next launch if a session is found.
      const SESSION_KEY = 'modelsmith_session_v1';
      let sessionSaveTimer = null;

      function serializeScene() {
        const out = [];
        const collect = (o) => {
          if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) {
            if (o.children && o.children.length) o.children.forEach(collect);
            return;
          }
          o.updateMatrixWorld(true);
          const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
          const pos = g.attributes.position;
          const col = g.attributes.color;
          const P = new Float32Array(pos.count * 3);
          const v = new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); P[i*3]=v.x; P[i*3+1]=v.y; P[i*3+2]=v.z; }
          let C = null;
          if (col) { C = new Array(col.count*3); for (let i=0;i<col.count;i++){ C[i*3]=+col.getX(i).toFixed(4); C[i*3+1]=+col.getY(i).toFixed(4); C[i*3+2]=+col.getZ(i).toFixed(4); } }
          const mat = Array.isArray(o.material) ? o.material[0] : o.material;
          out.push({
            p: Array.from(P, x => +x.toFixed(4)),
            c: C,
            color: mat && mat.color ? mat.color.getHex() : 0xb0b8c8,
            vColors: !!(mat && mat.vertexColors),
            isSketch: !!o.userData.isSketch,
            name: o.name || ''
          });
        };
        objects.forEach(collect);
        return out;
      }

      // Cheap fingerprint of everything serializeScene() would write. The 20-second
      // safety timer compares it with the last saved one, so an idle (or Paint-mode)
      // session no longer re-serialises every vertex of every object for nothing.
      let _lastSessionSig = null;
      function sessionSignature() {
        let s = objects.length + '|';
        objects.forEach(o => {
          s += o.uuid + ':' + o.name + ':' + o.matrix.elements.join(',');
          o.traverse(c => {
            const pos = c.geometry && c.geometry.attributes && c.geometry.attributes.position;
            if (!pos) return;
            const col = c.geometry.attributes.color;
            const m = Array.isArray(c.material) ? c.material[0] : c.material;
            s += '#' + c.geometry.uuid + '.' + pos.version + '.' + pos.count + (col ? '.' + col.version : '') + (m && m.color ? '.' + m.color.getHex() : '');
          });
          s += ';';
        });
        return s;
      }
      function autosaveTick() {
        const paintEl = document.getElementById('paint-app');
        if (paintEl && paintEl.style.display !== 'none') return;   // 3D scene can't change while painting
        if (objects.length && sessionSignature() === _lastSessionSig) return;
        saveSession();
      }

      function saveSession() {
        try {
          if (!objects.length) {
            localStorage.removeItem(SESSION_KEY);
            if (window.Store && Store.available) Store.del(SESSION_KEY).catch(() => {});
            updateSessionStatus(); return;
          }
          _lastSessionSig = sessionSignature();
          const data = { v: 1, savedAt: Date.now(), objects: serializeScene() };
          const json = JSON.stringify(data);
          // IndexedDB first: it has room for models that localStorage simply could
          // not hold, which is why dense meshes used to fail to autosave entirely.
          if (window.Store && Store.available) {
            Store.set(SESSION_KEY, json)
              .then(() => { localStorage.removeItem(SESSION_KEY); updateSessionStatus(); })
              .catch(() => {
                // Fall back so a storage failure never means losing the session.
                try {
                  if (json.length <= 4.8 * 1024 * 1024) localStorage.setItem(SESSION_KEY, json);
                  else banner("⚠️ Model too large to auto-save — export to keep it safe.");
                } catch (e2) {}
                updateSessionStatus();
              });
            return;
          }
          if (json.length > 4.8 * 1024 * 1024) { banner("⚠️ Model too large to auto-save — export to keep it safe."); return; }
          localStorage.setItem(SESSION_KEY, json);
          updateSessionStatus();
        } catch (e) { /* private mode / quota — ignore */ }
      }

      function scheduleSessionSave() {
        if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
        sessionSaveTimer = setTimeout(saveSession, 1200);
      }

      // IndexedDB is asynchronous but the callers here are not, so the session is
      // pulled into a small cache as soon as it's available and read synchronously
      // from there. localStorage is still checked as a fallback for anyone whose
      // data hasn't migrated yet.
      let _sessionCache = null, _sessionReady = false;
      function loadSessionData() {
        if (_sessionCache) return _sessionCache;
        try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
        catch (e) { return null; }
      }
      function primeSessionCache() {
        if (!(window.Store && Store.available)) return Promise.resolve(null);
        return Store.get(SESSION_KEY).then(raw => {
          if (raw) { try { _sessionCache = JSON.parse(raw); } catch (e) {} }
          _sessionReady = true;
          return _sessionCache;
        }).catch(() => { _sessionReady = true; return null; });
      }

      function restoreSession(data) {
        if (!data || !data.objects) return;
        objects.slice().forEach(o => scene.remove(o));
        objects = []; selected = []; transformControl.detach();
        data.objects.forEach(rec => {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rec.p), 3));
          if (rec.c) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rec.c), 3));
          g.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: rec.color, roughness: 0.55, metalness: 0.0, vertexColors: !!rec.vColors, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(g, mat);
          mesh.castShadow = true; mesh.receiveShadow = true;
          if (rec.name) mesh.name = rec.name;
          if (rec.isSketch) mesh.userData.isSketch = true;
          scene.add(mesh); objects.push(mesh);
        });
        historyTimeline = []; historyIndex = -1;
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Recovered your previous session — ${objects.length} object${objects.length!==1?'s':''}.`);
      }

      function clearSession() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        updateSessionStatus();
      }

      function updateSessionStatus() {
        const el = document.getElementById('session-status');
        if (!el) return;
        const data = loadSessionData();
        if (data && data.savedAt) {
          const secs = Math.round((Date.now() - data.savedAt)/1000);
          const when = secs < 60 ? 'just now' : secs < 3600 ? `${Math.round(secs/60)} min ago` : `${Math.round(secs/3600)} hr ago`;
          el.textContent = `Auto-saved ${when} · ${data.objects.length} object${data.objects.length!==1?'s':''}`;
        } else {
          el.textContent = 'No auto-saved session yet.';
        }
      }

      // Deep-clone userData for history snapshots WITHOUT destroying THREE.js objects.
      // A plain JSON round-trip turns THREE.Shape / Matrix4 / Vector3 into dead plain
      // objects (losing .getPoints(), etc.), which is why revolve/push-pull/loft broke
      // on a sketch after an undo. Here we copy plain values but keep any object that
      // has a .clone() method (Shapes, matrices, vectors) as a real clone.
      function cloneUserData(ud) {
        const cloneVal = (v) => {
          if (v == null || typeof v !== 'object') return v;
          if (typeof v.clone === 'function') return v.clone();      // THREE.Shape, Matrix4, Vector3, …
          if (Array.isArray(v)) return v.map(cloneVal);
          const out = {};
          for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = cloneVal(v[k]);
          return out;
        };
        return cloneVal(ud || {});
      }

      function saveHistory(label) {
        updateGridExtent();
        // If a group pivot is active, release it first so every object's transform
        // is expressed in world/scene space before we snapshot, then rebuild it.
        const hadPivot = !!groupPivot;
        if (hadPivot) detachGroupPivot();

        if (historyIndex < historyTimeline.length - 1) { historyTimeline = historyTimeline.slice(0, historyIndex + 1); }
        objects.forEach(stableId);   // give each object an identity that survives clone()
        const snapshot = objects.map(obj => {
          const clone = obj.clone();
          if (obj.geometry) clone.geometry = obj.geometry.clone();
          if (obj.material) {
            if (Array.isArray(obj.material)) clone.material = obj.material.map(m => m.clone());
            else clone.material = obj.material.clone();
          }
          clone.userData = cloneUserData(obj.userData);
          clone.name = obj.name;
          return clone;
        });
        // Carry a label and a small preview alongside the objects, so the history
        // panel can show what each step was. Non-enumerable-ish extras on the array
        // keep the rest of the restore path untouched.
        snapshot.label = label || describeChange(historyTimeline[historyIndex], snapshot);
        snapshot.at = Date.now();
        snapshot.thumb = null;
        historyTimeline.push(snapshot);
        if (historyTimeline.length > HISTORY_LIMIT) historyTimeline.shift();
        // Work out what this step changed while both snapshots are to hand; the
        // render loop uses it to ring the affected areas on the thumbnail.
        _thumbWanted = snapshot;
        _thumbMarks = changedObjects(historyTimeline[historyTimeline.length - 2], snapshot);
        historyIndex = historyTimeline.length - 1;

        if (hadPivot && selected.length > 1) attachGizmoToSelection();
        scheduleSessionSave();   // keep the crash-recovery copy fresh
        renderHistoryPanel();
      }

      // Work out a readable label by diffing against the previous snapshot, so the
      // ~46 existing saveHistory() calls don't all need updating by hand.
      function describeChange(prev, next) {
        if (!prev) return 'Start';
        const a = prev.length, b = next.length;
        if (b > a) return b - a === 1 ? `Added ${next[next.length - 1].name || 'object'}` : `Added ${b - a} objects`;
        if (b < a) return a - b === 1 ? 'Deleted object' : `Deleted ${a - b} objects`;
        return 'Edited';
      }

      // Render the live scene into a small square preview for the history list.
      // The WebGL canvas is created without preserveDrawingBuffer, so its pixels
      // are only readable immediately after a draw — we therefore grab the thumb
      // inside the render loop rather than straight away, and patch it into the
      // snapshot once it arrives.
      let _thumbWanted = null;   // the snapshot awaiting its preview
      let _thumbMarks = null;    // { added, removed } for that snapshot's glow
      function captureThumb() { return null; }
      // three.js assigns a fresh uuid on clone(), so snapshots can't be diffed by
      // uuid — every object would look both added and removed. We stamp our own id
      // into userData instead, which cloneUserData carries across faithfully.
      let _msIdSeq = 0;
      function stableId(obj) {
        if (!obj.userData) obj.userData = {};
        if (!obj.userData.msId) obj.userData.msId = 'ms' + (++_msIdSeq);
        return obj.userData.msId;
      }

      // Work out which objects appeared or vanished between two snapshots, so the
      // thumbnail can highlight them. Frame-diffing would be wrong here: orbiting
      // the camera changes every pixel without changing the model.
      function changedObjects(prev, next) {
        const key = o => (o.userData && o.userData.msId) || o.uuid;
        const prevIds = new Set((prev || []).map(key));
        const nextIds = new Set((next || []).map(key));
        const added = (next || []).filter(o => !prevIds.has(key(o)));
        const removed = (prev || []).filter(o => !nextIds.has(key(o)));
        return { added, removed };
      }


      // Ring the region an object occupies, so the history thumb shows at a glance
      // what this step added (green) or removed (red).
      // Trace the silhouette of the objects that changed, rather than boxing them.
      // We re-render just those objects to an offscreen target, read back which
      // pixels they cover, and outline that shape — so the highlight follows the
      // actual item (as the paint side's glow does) instead of drawing a rectangle
      // around empty space.
      function silhouetteMask(objs, S) {
        if (!objs || !objs.length || !renderer) return null;
        try {
          const rt = new THREE.WebGLRenderTarget(S, S);
          const stencil = new THREE.Scene();
          const flat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const clones = [];
          objs.forEach(o => {
            if (!o.geometry) return;
            const m = new THREE.Mesh(o.geometry, flat);
            m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
            stencil.add(m); clones.push(m);
          });
          if (!clones.length) { rt.dispose(); return null; }
          const prevTarget = renderer.getRenderTarget();
          const prevClear = renderer.getClearColor(new THREE.Color()).clone();
          const prevAlpha = renderer.getClearAlpha();
          renderer.setRenderTarget(rt);
          renderer.setClearColor(0x000000, 1);
          renderer.clear();
          renderer.render(stencil, camera);
          const buf = new Uint8Array(S * S * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
          renderer.setRenderTarget(prevTarget);
          renderer.setClearColor(prevClear, prevAlpha);
          rt.dispose(); flat.dispose();

          // readRenderTargetPixels gives bottom-up rows; flip to match the canvas
          const mask = new Uint8Array(S * S);
          let any = false;
          for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
              const src = ((S - 1 - y) * S + x) * 4;
              if (buf[src] > 40) { mask[y * S + x] = 1; any = true; }
            }
          }
          return any ? mask : null;
        } catch (e) { return null; }
      }

      // Outline a mask on the thumbnail, matching the paint side's change-glow look.
      function glowMask(g, mask, S, rgb) {
        const k = S / 40;
        const R = Math.max(1, Math.round(1.4 * k));
        const grown = new Uint8Array(S * S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if (!mask[y * S + x]) continue;
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy > R * R) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < S && ny < S) grown[ny * S + nx] = 1;
          }
        }
        const edge = [];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const p = y * S + x;
          if (!grown[p]) continue;
          const l = x > 0 && grown[p - 1], r = x < S - 1 && grown[p + 1];
          const u = y > 0 && grown[p - S], d = y < S - 1 && grown[p + S];
          if (!l || !r || !u || !d) edge.push(p);
        }
        if (!edge.length) return;
        const stamp = (colour, thick, alpha) => {
          const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
          const cx = cv.getContext('2d');
          const im = cx.createImageData(S, S);
          const put = (x, y) => {
            if (x < 0 || y < 0 || x >= S || y >= S) return;
            const i = (y * S + x) * 4;
            im.data[i] = colour[0]; im.data[i+1] = colour[1]; im.data[i+2] = colour[2]; im.data[i+3] = 255;
          };
          for (const p of edge) {
            const x = p % S, y = (p / S) | 0;
            put(x, y);
            if (thick) { put(x-1,y); put(x+1,y); put(x,y-1); put(x,y+1); }
          }
          cx.putImageData(im, 0, 0);
          g.save(); g.globalAlpha = alpha; g.drawImage(cv, 0, 0); g.restore();
        };
        stamp([8, 10, 14], true, 0.5);
        stamp(rgb, false, 1);
      }

      function grabThumbNow(marks) {
        try {
          if (!renderer) return null;
          const src = renderer.domElement;
          if (!src.width || !src.height) return null;
          const S = 48;
          const c = document.createElement('canvas');
          c.width = S; c.height = S;
          const g = c.getContext('2d');
          g.fillStyle = '#12161c'; g.fillRect(0, 0, S, S);
          const s = Math.min(src.width, src.height);
          g.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, S, S);
          if (marks) {
            // Added objects are still in the scene, so their silhouette can be
            // rendered. Removed ones are gone — fall back to projecting the
            // bounding box of the copy held in the previous snapshot.
            const addMask = silhouetteMask(marks.added, S);
            if (addMask) glowMask(g, addMask, S, [45, 212, 160]);
            const remMask = silhouetteMask(marks.removed, S);
            if (remMask) glowMask(g, remMask, S, [245, 101, 101]);
          }
          return c.toDataURL('image/png');
        } catch (e) { return null; }
      }
      // Called from the render loop right after renderer.render(), while the
      // drawing buffer still holds this frame. Tracks the snapshot by identity so
      // it stays correct even when the timeline shifts at its cap.
      // ── Object browser ──────────────────────────────────────────────────────
      // Renders each top-level object on its own so you can see what's in the
      // scene. Thumbnails are drawn once into a shared offscreen renderer and
      // cached against the object's geometry, so a scene of 30 parts doesn't cost
      // 30 live renderers — that would be the obvious way to do this and it would
      // bring a tablet to a halt.
      let _obRenderer = null, _obScene = null, _obCam = null;
      const _obCache = new Map();          // uuid -> { url, key }

      function obEnsureRenderer() {
        if (_obRenderer) return true;
        try {
          _obRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
          _obRenderer.setSize(128, 128);
          _obScene = new THREE.Scene();
          _obCam = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
          const key = new THREE.DirectionalLight(0xffffff, 0.95);
          key.position.set(3, -4, 6);
          const fill = new THREE.DirectionalLight(0xffffff, 0.35);
          fill.position.set(-4, 3, 2);
          _obScene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));
          return true;
        } catch (e) { _obRenderer = null; return false; }
      }

      // A cheap signature that changes whenever the look of an object changes, so
      // cached thumbnails refresh when they should and not otherwise.
      function obKey(o) {
        let tris = 0, mat = '';
        o.traverse(c => {
          if (c.isMesh && c.geometry && c.geometry.attributes.position) {
            tris += c.geometry.attributes.position.count;
            if (!mat && c.material && c.material.color) mat = c.material.color.getHexString();
          }
        });
        return tris + '|' + mat + '|' + (o.userData.name || o.name || '');
      }

      function obThumb(o) {
        const cached = _obCache.get(o.uuid);
        const key = obKey(o);
        if (cached && cached.key === key) return cached.url;
        if (!obEnsureRenderer()) return null;
        // Clone so the live scene is never disturbed by the framing we do here.
        let clone;
        try { clone = o.clone(true); } catch (e) { return null; }
        clone.position.set(0, 0, 0);
        clone.rotation.set(0, 0, 0);
        clone.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(clone);
        if (box.isEmpty()) return null;
        const c = box.getCenter(new THREE.Vector3());
        const r = box.getSize(new THREE.Vector3()).length() * 0.5 || 1;
        clone.position.sub(c);
        _obScene.add(clone);
        const d = r / Math.tan((35 * Math.PI / 180) / 2) * 1.25;
        _obCam.position.set(d * 0.62, -d * 0.72, d * 0.55);
        _obCam.up.set(0, 0, 1);
        _obCam.lookAt(0, 0, 0);
        _obCam.near = Math.max(0.01, d - r * 4); _obCam.far = d + r * 6;
        _obCam.updateProjectionMatrix();
        let url = null;
        try {
          _obRenderer.render(_obScene, _obCam);
          url = _obRenderer.domElement.toDataURL('image/png');
        } catch (e) { url = null; }
        _obScene.remove(clone);
        if (url) _obCache.set(o.uuid, { url, key });
        return url;
      }

      // Most objects carry no name, so derive something readable from what they
      // are. A tile labelled "Object" three times over is no more use than no
      // label at all.
      function obLabel(o, kids) {
        if (o.userData && o.userData.name) return o.userData.name;
        if (o.name) return o.name;
        if (kids > 1) return 'Group (' + kids + ')';
        let type = '';
        o.traverse(c => { if (!type && c.isMesh && c.geometry) type = c.geometry.type || ''; });
        const map = {
          BoxGeometry: 'Cube', SphereGeometry: 'Sphere', CylinderGeometry: 'Cylinder',
          ConeGeometry: 'Cone', TorusGeometry: 'Torus', TextGeometry: 'Text',
          ExtrudeGeometry: 'Extrusion', LatheGeometry: 'Revolve', PlaneGeometry: 'Plane'
        };
        if (map[type]) return map[type];
        // Anything booleaned or edited becomes a plain BufferGeometry, so fall
        // back to its size, which at least distinguishes one part from another.
        try {
          const b = new THREE.Box3().setFromObject(o);
          const s = b.getSize(new THREE.Vector3());
          return Math.round(s.x) + '\u00d7' + Math.round(s.y) + '\u00d7' + Math.round(s.z) + ' mm';
        } catch (e) { return 'Object'; }
      }

      function renderObjectBrowser() {
        const grid = document.getElementById('ob-grid');
        if (!grid) return;
        const list = objects.filter(o => o && !o.userData.isSketch);
        const cnt = document.getElementById('ob-count');
        if (cnt) cnt.textContent = list.length ? String(list.length) : '';
        grid.innerHTML = '';
        if (!list.length) {
          const e = document.createElement('div');
          e.className = 'ob-empty';
          e.textContent = 'Nothing in the scene yet.';
          grid.appendChild(e);
          return;
        }
        list.forEach(o => {
          // A div rather than a button: the rename field sits inside the tile, and
          // pressing space inside an input nested in a <button> activates the
          // button and steals focus — which committed the name early, turning
          // "Heel wedge" into "Heel".
          const t = document.createElement('div');
          t.setAttribute('role', 'button');
          t.tabIndex = 0;
          t.className = 'ob-tile' + (selected.includes(o) ? ' sel' : '') + (o.visible === false ? ' ob-hidden' : '');
          const url = obThumb(o);
          if (url) {
            const img = document.createElement('img');
            img.src = url; img.alt = '';
            img.style.cssText = 'width:100%; height:100%; display:block; object-fit:cover;';
            t.appendChild(img);
          }
          // Groups select as one thing, so they read as one tile — the badge says
          // how many parts are inside.
          let kids = 0;
          if (o.type === 'Group' || (o.children && o.children.some(c => c.isMesh))) {
            o.traverse(c => { if (c.isMesh) kids++; });
          }
          if (kids > 1) {
            const b = document.createElement('span');
            b.className = 'ob-badge'; b.textContent = kids;
            t.appendChild(b);
          }
          const nm = document.createElement('span');
          nm.className = 'ob-name';
          nm.textContent = obLabel(o, kids);
          t.appendChild(nm);
          t.title = nm.textContent + ' — click the name to rename';
          // Click the name to rename, the way Finder and Explorer do. The first
          // click on a tile selects it; clicking the name after that renames,
          // so selecting never accidentally starts an edit.
          nm.onclick = (ev) => {
            if (!selected.includes(o)) return;      // let the tile handle selection
            ev.stopPropagation();
            msInlineRename(nm, o.userData.name || o.name || '', (v) => {
              o.userData.name = v;
              renderObjectBrowser(); updateStatus(); saveHistory();
            }, () => renderObjectBrowser());
          };
          t.onclick = (e) => {
            if (e.shiftKey || multiSelectMode) {
              const i = selected.indexOf(o);
              if (i >= 0) selected.splice(i, 1); else selected.push(o);
            } else selected = [o];
            refreshSelectionVisual(); attachGizmoToSelection();
            updateStatus(); updateFloatingHUD(); renderObjectBrowser();
            if (window.invalidate3D) invalidate3D();
          };
          t.ondblclick = () => {
            selected = [o];
            refreshSelectionVisual(); attachGizmoToSelection();
            const b = document.getElementById('bld-frame-sel'); if (b) b.click();
            renderObjectBrowser();
          };
          grid.appendChild(t);
        });
      }
      window.renderObjectBrowser = renderObjectBrowser;

      function serviceThumbQueue() {
        if (!_thumbWanted) return;
        const snap = _thumbWanted; _thumbWanted = null;
        const marks = _thumbMarks; _thumbMarks = null;
        snap.thumb = grabThumbNow(marks);
        renderHistoryPanel();
      }

      function triggerUndo() {
        if (currentMode === 'sketching') { sketchUndo(); return; }
        if (historyIndex > 0) {
          historyIndex--; restoreStateFromSnapshot(historyTimeline[historyIndex]); banner("Undo");
          renderHistoryPanel();
        } else banner("Nothing to undo.");
      }

      function triggerRedo() {
        if (currentMode === 'sketching') { sketchRedo(); return; }
        if (historyIndex < historyTimeline.length - 1) {
          historyIndex++; restoreStateFromSnapshot(historyTimeline[historyIndex]); banner("Redo");
          renderHistoryPanel();
        } else banner("Nothing to redo.");
      }

      // Jump straight to any point in the timeline. Stepping back doesn't discard
      // anything — the later steps stay available until you make a new edit, which
      // is what replaces them.
      function jumpToHistory(i) {
        if (i < 0 || i >= historyTimeline.length || i === historyIndex) return;
        historyIndex = i;
        restoreStateFromSnapshot(historyTimeline[i]);
        renderHistoryPanel();
        banner(historyTimeline[i].label || 'Jumped');
      }

      // ── Edit actions (shared by toolbar buttons and keyboard shortcuts) ──
      function deleteSelected() {
        if (!selected.length) { banner("Nothing selected to delete."); return; }
        detachGroupPivot();
        const n = selected.length;
        selected.forEach(s => scene.remove(s));
        objects = objects.filter(o => !selected.includes(o));
        selected = []; transformControl.detach();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(n > 1 ? `Deleted ${n} objects.` : "Deleted.");
      }

      // Drop each selected solid straight down (along the build-plate's vertical
      // axis) so its lowest point rests exactly on the plate — like letting go
      // of it and having gravity settle it flat. Each object settles on its own;
      // horizontal position is untouched.
      function settleSelected() {
        const targets = selected.filter(o => !o.userData.isSketch);
        if (!targets.length) return banner("⚠️ Select one or more solids to settle onto the build plate.");
        targets.forEach(obj => {
          const box = new THREE.Box3().setFromObject(obj);
          if (!isFinite(box.min.z)) return;
          obj.position.z -= box.min.z;
        });
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(targets.length > 1 ? `Settled ${targets.length} objects onto the build plate.` : "Settled onto the build plate.");
      }

      // Centres the selection on the build plate (X0, Y0) and settles it.
      // A multi-object selection or a group is treated as ONE unit for the X/Y
      // move — the combined bounding box straddles the origin, so objects keep
      // their positions relative to each other rather than collapsing onto one
      // point. Settling afterwards stays per-object, matching settleSelected()
      // above, so each part still rests flush on the plate rather than being
      // offset by whichever object happens to be tallest.
      function centreSelected() {
        const targets = selected.filter(o => !o.userData.isSketch);
        if (!targets.length) return banner("⚠️ Select one or more objects to centre on the plate.");
        const box = new THREE.Box3();
        targets.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
        if (!isFinite(box.min.x)) return;
        const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
        targets.forEach(o => { o.position.x -= cx; o.position.y -= cy; });
        targets.forEach(o => {
          const b = new THREE.Box3().setFromObject(o);
          if (isFinite(b.min.z)) o.position.z -= b.min.z;
        });
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(targets.length > 1 ? `Centred ${targets.length} objects on the plate.` : "Centred on the plate.");
      }

      function cloneObject(src, offset = 25) {
        const c = src.clone();
        if (src.geometry) c.geometry = src.geometry.clone();
        if (src.material) c.material = Array.isArray(src.material) ? src.material.map(m => m.clone()) : src.material.clone();
        c.position.x += offset;
        c.userData = cloneUserData(src.userData || {});
        return c;
      }

      // ── Group / Ungroup / Merge ─────────────────────────────────────────────
      // Group: bundle the selected objects under one container so they move, copy
      // and delete as a single unit (reversible). Ungroup: dissolve it back into
      // its members. Merge: fuse selected solids into one mesh via boolean union
      // (not reversible except by undo).
      function groupSelected() {
        if (selected.length < 2) { banner("Select two or more objects to group."); return; }
        detachGroupPivot();

        const grp = new THREE.Group();
        grp.userData.isGroup = true;
        grp.name = "Group " + (objects.filter(o => o.userData.isGroup).length + 1);

        // Centre the group on the members so its gizmo pivot is sensible.
        const box = new THREE.Box3();
        selected.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
        const centre = new THREE.Vector3(); box.getCenter(centre);
        grp.position.copy(centre);
        scene.add(grp); grp.updateMatrixWorld(true);

        const members = [...selected];
        members.forEach(o => {
          attachKeepWorld(o, grp);
          objects = objects.filter(x => x !== o);   // members live inside the group now
        });
        objects.push(grp);

        selectOnly(grp);
        saveHistory(); updateStatus();
        banner(`Grouped ${members.length} objects.`);
      }

      // Ungroup does two things: it dissolves a group into its members, and it
      // splits a single mesh that is really several loose, non-touching pieces
      // (typical of an imported OBJ/3MF/STL scan or assembly) into one object per
      // piece, each keeping its place in the scene.
      function ungroupSelected() {
        const groups = selected.filter(o => o.userData.isGroup);
        const meshes = selected.filter(o => !o.userData.isGroup && !o.userData.isSketch &&
          o.geometry && o.geometry.attributes && o.geometry.attributes.position);
        if (groups.length === 0 && meshes.length === 0) {
          banner("Select a group to ungroup, or a model made of separate parts to split.");
          return;
        }
        detachGroupPivot();

        let freed = [];
        groups.forEach(grp => {
          [...grp.children].forEach(child => {
            attachKeepWorld(child, scene);
            objects.push(child);
            freed.push(child);
          });
          scene.remove(grp);
          objects = objects.filter(o => o !== grp);
        });
        const dissolved = freed.length;

        // Loose parts. Largest piece first so "part 1" is the main body.
        let split = 0, tooMany = 0;
        const MAX_PARTS = 500;
        meshes.forEach(m => {
          let parts = null;
          try { parts = splitDisconnectedShells(m, true); } catch (e) { parts = null; }
          if (!parts) return;
          if (parts.length > MAX_PARTS) { tooMany = parts.length; return; }
          const tris = (p) => p.geometry.attributes.position.count;
          parts.sort((a, b) => tris(b) - tris(a));
          const base = (m.userData && m.userData.name) || m.name || '';
          scene.remove(m);
          objects = objects.filter(o => o !== m);
          parts.forEach((p, i) => {
            p.userData.name = base ? base + ' \u2013 part ' + (i + 1) : 'Part ' + (i + 1);
            scene.add(p); p.updateMatrixWorld(true);
            objects.push(p);
            freed.push(p);
          });
          split += parts.length;
        });

        if (!freed.length) {
          banner(tooMany
            ? `\u26a0\ufe0f That model has ${tooMany} loose pieces \u2014 too many to split into separate objects (limit ${MAX_PARTS}).`
            : "Nothing to ungroup \u2014 it's one connected piece.");
          return;
        }

        selected = freed;
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(split && !dissolved ? `Split into ${split} separate parts.`
             : split ? `Ungrouped and split into ${freed.length} objects.`
             : `Ungrouped into ${freed.length} objects.`);
      }

      // Fuse all selected solids into a single mesh (chained boolean union).
      function mergeSelected() {
        const solids = selected.filter(o => !o.userData.isSketch && !o.userData.isGroup && o.geometry);
        if (solids.length < 2) { banner("Select two or more solids to merge."); return; }
        detachGroupPivot();
        banner("Merging solids…");

        setTimeout(() => {
          try {
            const CSG = window.CSGEngine;
            let acc = CSG.fromMesh(solids[0]);
            for (let i = 1; i < solids.length; i++) {
              acc = acc.union(CSG.fromMesh(solids[i]));
            }
            const merged = csgToRecenteredMesh(acc, solids[0].material.clone());
            merged.castShadow = true; merged.receiveShadow = true;

            solids.forEach(s => { scene.remove(s); });
            objects = objects.filter(o => !solids.includes(o));
            scene.add(merged); objects.push(merged);

            selectOnly(merged);
            saveHistory(); updateStatus(); updateFloatingHUD();
            banner(`Merged ${solids.length} solids into one.`);
          } catch (err) {
            console.error(err); banner("⚠️ Merge failed — try nudging the solids so they overlap, or merge fewer at once.");
          }
        }, 30);
      }

      function duplicateSelected() {
        if (!selected.length) { banner("Nothing selected to duplicate."); return; }
        detachGroupPivot();
        const copies = selected.map(s => cloneObject(s, 25));
        objects.forEach(o => setEmissive(o, 0x000000));
        copies.forEach(c => { scene.add(c); objects.push(c); });
        selected = copies;
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(copies.length > 1 ? `Duplicated ${copies.length} objects.` : "Duplicated.");
      }

      let mirrorKeepOriginal = false;

      // Mirror an object's geometry across a plane through its own centre, along the
      // given world axis. We flip that coordinate of every vertex and reverse the
      // triangle winding so faces still point outward (otherwise the solid renders
      // inside-out). With "keep original" on, a mirrored copy is added alongside.
      function mirrorGeometryInPlace(mesh, axis) {
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        const pos = g.attributes.position;
        const arr = pos.array;
        const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        // flip the axis coordinate on every vertex
        for (let i = 0; i < pos.count; i++) arr[i*3 + ai] = -arr[i*3 + ai];
        // reverse winding per triangle (swap vertices 2 and 3) so faces stay outward
        for (let i = 0; i < pos.count; i += 3) {
          for (let k = 0; k < 3; k++) {
            const a = (i+1)*3 + k, b = (i+2)*3 + k;
            const tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
          }
        }
        pos.needsUpdate = true;
        // carry vertex colours if present (swap the same way)
        if (g.attributes.color) {
          const col = g.attributes.color.array;
          for (let i = 0; i < pos.count; i += 3) {
            for (let k = 0; k < 3; k++) {
              const a = (i+1)*3 + k, b = (i+2)*3 + k;
              const tmp = col[a]; col[a] = col[b]; col[b] = tmp;
            }
          }
          g.attributes.color.needsUpdate = true;
        }
        g.computeVertexNormals();
        mesh.geometry.dispose();
        mesh.geometry = g;
      }

      function mirrorSelected(axis) {
        const targets = selected.filter(o => o.geometry && !o.userData.isSketch);
        if (!targets.length) { banner("Select a solid to mirror."); return; }
        detachGroupPivot();

        if (mirrorKeepOriginal) {
          // Add mirrored copies, keep originals; mirror the copy's local geometry and
          // reflect its position across the selection's centre on that axis.
          const centre = new THREE.Vector3();
          const box = new THREE.Box3(); targets.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
          box.getCenter(centre);
          const ai = axis === 'x' ? 'x' : axis === 'y' ? 'y' : 'z';
          const copies = targets.map(s => {
            const c = cloneObject(s, 0);
            mirrorGeometryInPlace(c, axis);
            c.position[ai] = 2 * centre[ai] - s.position[ai];  // reflect position across centre
            return c;
          });
          objects.forEach(o => setEmissive(o, 0x000000));
          copies.forEach(c => { scene.add(c); objects.push(c); });
          selected = copies;
        } else {
          targets.forEach(s => mirrorGeometryInPlace(s, axis));
        }
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(mirrorKeepOriginal ? `Added mirrored copy across ${axis.toUpperCase()}.` : `Mirrored across ${axis.toUpperCase()}.`);
      }

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

      // ── Tool rail: switch active tool and show only the relevant panels ──
      let activeTool = 'select';
      // Which sidebar sections are visible for each tool. Shared sections
      // (layers, extrude, import/export, workspace) always stay available.
      const TOOL_PANELS = {
        sketch: ['sketch-panel', 'layer-panel', 'sec-array'],
        sculpt: ['sec-sculpt', 'sec-smooth'],
        pushpull: ['layer-panel', 'sec-extrude', 'sec-revolve', 'sec-loft'],
        slice:  ['sec-slice'],
        mold:   ['sec-mold'],
        fillet: ['sec-fillet', 'sec-chamfer'],
        paint: ['sec-paint'],
        measure: ['sec-measure']
      };
      // While the Select tool is active, the sidebar shows one of these four
      // groups depending on which tab is chosen — instead of dumping every
      // section on screen at once.
      const TAB_PANELS = {
        select: ['sec-select-mini', 'sec-workspace', 'sec-align'],
        create: ['sec-primitives', 'sec-text3d', 'sec-img3d', 'sec-thread', 'sec-qr3d'],
        edit:   ['sec-mirror', 'sec-combine', 'sec-booleans', 'sec-shell', 'sec-array'],
        ie:     ['sec-saves', 'sec-printcheck', 'sec-import', 'sec-export', 'sec-session']
      };
      // Select is the resting tab again now that it holds the object browser.
      let activePanelTab = 'select';
      const ALL_PANELS = ['sec-select-mini','sec-primitives','sec-text3d','sec-img3d','sec-qr3d','sec-booleans','sec-fillet','sec-paint','sec-sculpt','sketch-panel','layer-panel','sec-extrude','sec-slice','sec-import','sec-export','sec-printcheck','sec-saves','sec-session','sec-workspace','sec-mirror','sec-combine','sec-measure','sec-thread','sec-shell','sec-chamfer','sec-array','sec-align','sec-smooth','sec-revolve','sec-loft','sec-mold'];

      function setActivePanelTab(tab) {
        activePanelTab = tab;
        document.querySelectorAll('#side-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        // Looking at another panel should NOT cancel the tool you're using. This
        // used to call setActiveTool('select'), so glancing at Edit mid-sketch
        // dropped you out of the sketch tool and its tab vanished from the bar —
        // which read as tabs disappearing at random. The tool stays active and
        // keeps its tab; only picking a different tool changes it.
        const visible = TAB_PANELS[tab] || [];
        ALL_PANELS.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = visible.includes(id) ? '' : 'none';
        });
        const title = document.getElementById('panel-title');
        if (title) title.textContent = { select:'Select', create:'Create', edit:'Edit', ie:'Files' }[tab] || 'Panel';
      }

      // Nice display names for the dynamic tool tab.
      const TOOL_TAB_LABEL = { sketch: 'Sketch', sculpt: 'Sculpt', pushpull: 'Push/Pull', slice: 'Slice', fillet: 'Fillet', paint: 'Paint', measure: 'Measure' };

      function setActiveTool(tool) {
        activeTool = tool;

        // Rail button highlight (skip the multi-select toggle, which isn't a tool)
        document.querySelectorAll('#tool-rail button[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));

        // Dynamic tool tab: when a real tool is active, reveal a tab for it next to
        // Edit and mark it active (instead of the tool silently taking over whatever
        // main tab was selected). Picking Select hides the tool tab again.
        const toolTab = document.getElementById('tool-tab');
        if (toolTab) {
          if (tool === 'select') {
            // Keep the label showing the last real tool used — the tab is hidden
            // now, but when it reappears it should not flash a generic "Tool".
            toolTab.style.display = 'none';
            document.querySelectorAll('#side-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === activePanelTab));
          } else {
            toolTab.textContent = TOOL_TAB_LABEL[tool] || tool;
            toolTab.style.display = '';
            document.querySelectorAll('#side-tabs button').forEach(b => b.classList.toggle('active', b === toolTab));
          }
        }

        // Show/hide sidebar sections
        const visible = tool === 'select' ? (TAB_PANELS[activePanelTab] || []) : (TOOL_PANELS[tool] || []);
        ALL_PANELS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = visible.includes(id) ? '' : 'none'; });

        // Leaving sketch/sculpt/slice cleanly resets their transient state
        if (tool !== 'sketch') {
          document.getElementById('sketch-tools').style.display = 'none';
          hideDimOverlay();
          if (currentMode === 'sketching' || currentMode === 'arm_plane') {
            activeSketch.gridVisual.visible = false;
            while (activeSketch.visualizerGroup.children.length) activeSketch.visualizerGroup.remove(activeSketch.visualizerGroup.children[0]);
          }
        }
        if (tool !== 'sculpt') {
          const stg = document.getElementById('bld-sculpt-toggle');
          stg.classList.remove('active');
          stg.textContent = 'Arm sculpting brush';
          if (sculptBrush.ring) sculptBrush.ring.visible = false;
        }
        if (tool !== 'slice') {
          sliceState.armed = false; sliceState.planeHelper.visible = false;
          const sa = document.getElementById('bld-slice-arm'); if (sa) sa.classList.remove('active');
        }
        if (tool !== 'fillet') {
          clearFilletHighlights();
          filletState.edges = []; filletState.picked = new Set(); filletState.hovered = -1;
        }
        if (tool !== 'measure') { clearMeasure(); clearMeasureHover(); }
        if (tool !== 'pushpull') { clearPushPullFaceHighlight(); }

        // Panel title + contextual footer tip per tool
        const TITLES = { select: 'Select', sketch: 'Sketch', sculpt: 'Sculpt', pushpull: 'Push / Pull', slice: 'Slice / Cut', mold: 'Mold / Cast', fillet: 'Fillet Edges', paint: 'Paint', measure: 'Measure' };
        const TAB_TITLES = { select: 'Select', create: 'Create', edit: 'Edit', ie: 'Import / Export' };
        const TIPS = {
          select: 'Click to select. Drag the gizmo or type sizes below.',
          sketch: 'Define a plane, draw a closed profile, then bake it into a layer.',
          sculpt: 'Arm the brush, then drag across a surface to add or carve.',
          pushpull: 'Pick a baked layer, set direction and distance, then apply.',
          slice: 'Arm the plane, dial in the cut, then perform the slice.',
          mold: 'Select a solid, pick print & pour mould or silicone mould box, then generate.',
          fillet: 'Select a solid, set the radius, then round its sharp edges.',
          paint: 'Pick a colour, then click the model to paint it.',
          measure: 'Click two points to measure the distance between them.'
        };
        const pt = document.getElementById('panel-title');
        if (pt) pt.textContent = tool === 'select' ? (TAB_TITLES[activePanelTab] || 'Select') : (TITLES[tool] || tool);
        const ft = document.getElementById('bld-footer-tip'); if (ft) ft.textContent = TIPS[tool] || '';

        // Set the interaction mode
        if (tool === 'select') { currentMode = 'select'; banner("Select — click objects to transform them."); }
        else if (tool === 'sketch') { currentMode = 'select'; banner("Sketch — define a plane, then draw profiles."); }
        else if (tool === 'sculpt') {
          currentMode = 'select'; // arms only when the brush button is pressed
          transformControl.detach(); selected = [];
          banner("Sculpt — arm the brush, then drag a surface.");
        }
        else if (tool === 'slice') { currentMode = 'select'; banner("Slice — select a solid, arm the plane, then perform slice."); }
        else if (tool === 'mold') {
          // Selection must stay live and clickable: the mold is generated from
          // whatever solid you have selected, so this behaves like Select.
          currentMode = 'select';
          banner("Mold — select a solid, set the options, then Generate mold.");
        }
        else if (tool === 'fillet') {
          currentMode = 'select';
          transformControl.detach();
          if (selected.length && !selected[0].userData.isSketch && selected[0].geometry) {
            beginFilletEdgePicking();
            banner("Fillet — click edges to pick them, then Fillet picked.");
          } else {
            banner("Fillet — select a solid, then click its edges.");
          }
        }
        else if (tool === 'paint') {
          currentMode = 'select';
          transformControl.detach();
          banner("Paint — pick a colour, then click the model.");
        }
        else if (tool === 'measure') {
          currentMode = 'measure';
          transformControl.detach();
          selected = [];
          banner("Measure — click a point, then a second point, to see the distance between them.");
        }
        else if (tool === 'pushpull') {
          currentMode = 'select';
          const sketches = objects.filter(o => o.userData.isSketch);
          if (sketches.length === 0) banner("Push / Pull — first draw and bake a sketch in the Sketch tool.");
          else banner("Push / Pull — pick a baked layer, set direction and distance, then apply.");
        }

        updateStatus(); updateFloatingHUD();
      }

      // Shows the field group that matches the active gizmo mode and fills every
      // group from the selected object, so switching Move/Rotate/Scale instantly
      // reveals position (mm), roll/pitch/yaw (°), or size (mm) respectively.
      function updateFloatingHUD() {
        const hud = document.getElementById('floating-hud');
        if (selected.length === 0) { hud.style.display = 'none'; return; }
        hud.style.display = 'flex';
        // With 2+ objects, the gizmo drives the pivot — reflect the pivot's transform.
        const obj = (selected.length > 1 && groupPivot) ? groupPivot : selected[0];

        const mode = (transformControl && transformControl.getMode) ? transformControl.getMode() : 'translate';
        const moveG = document.getElementById('hud-move');
        const rotG  = document.getElementById('hud-rotate');
        const scaleG= document.getElementById('hud-scale');
        moveG.style.display  = mode === 'translate' ? 'flex' : 'none';
        rotG.style.display   = mode === 'rotate'    ? 'flex' : 'none';
        scaleG.style.display = mode === 'scale'     ? 'flex' : 'none';

        // Position (world mm)
        const setIf = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
        setIf('hud-pos-x', obj.position.x.toFixed(1));
        setIf('hud-pos-y', obj.position.y.toFixed(1));
        setIf('hud-pos-z', obj.position.z.toFixed(1));

        // Rotation as roll (X) / pitch (Y) / yaw (Z) in degrees
        setIf('hud-rot-x', Math.round(THREE.MathUtils.radToDeg(obj.rotation.x)));
        setIf('hud-rot-y', Math.round(THREE.MathUtils.radToDeg(obj.rotation.y)));
        setIf('hud-rot-z', Math.round(THREE.MathUtils.radToDeg(obj.rotation.z)));

        // Size (world-aligned bounding box, mm) — sketches have no meaningful size
        if (!obj.userData.isSketch && obj.geometry && obj.geometry.attributes.position) {
          const sz = new THREE.Vector3(); new THREE.Box3().setFromObject(obj).getSize(sz);
          setIf('hud-size-x', sz.x.toFixed(1));
          setIf('hud-size-y', sz.y.toFixed(1));
          setIf('hud-size-z', sz.z.toFixed(1));
        }
      }

      function applyHUDSize() {
        if(selected.length===0 || selected[0].userData.isSketch) return;
        const obj = selected[0];
        const gBox = new THREE.Box3().setFromBufferAttribute(obj.geometry.attributes.position);
        const sz = new THREE.Vector3(); gBox.getSize(sz);
        const tx=parseFloat(document.getElementById('hud-size-x').value), ty=parseFloat(document.getElementById('hud-size-y').value), tz=parseFloat(document.getElementById('hud-size-z').value);
        if(tx>0 && sz.x>0) obj.scale.x = tx/sz.x; if(ty>0 && sz.y>0) obj.scale.y = ty/sz.y; if(tz>0 && sz.z>0) obj.scale.z = tz/sz.z;
        saveHistory(); banner("Size applied.");
      }

      // Live edit of position / rotation fields — typing moves the object immediately.
      function bindHudLiveFields() {
        const posMap = { 'hud-pos-x':'x', 'hud-pos-y':'y', 'hud-pos-z':'z' };
        Object.entries(posMap).forEach(([id, axis]) => {
          document.getElementById(id).oninput = (e) => {
            if (selected.length === 0) return;
            const v = parseFloat(e.target.value); if (isNaN(v)) return;
            selected[0].position[axis] = v;
            selected[0].updateMatrixWorld();
          };
        });
        const rotMap = { 'hud-rot-x':'x', 'hud-rot-y':'y', 'hud-rot-z':'z' };
        Object.entries(rotMap).forEach(([id, axis]) => {
          document.getElementById(id).oninput = (e) => {
            if (selected.length === 0) return;
            const v = parseFloat(e.target.value); if (isNaN(v)) return;
            selected[0].rotation[axis] = THREE.MathUtils.degToRad(v);
            selected[0].updateMatrixWorld();
          };
        });
        // Commit position/rotation changes to history on blur/Enter
        ['hud-pos-x','hud-pos-y','hud-pos-z','hud-rot-x','hud-rot-y','hud-rot-z'].forEach(id => {
          const el = document.getElementById(id);
          el.onchange = () => { if (selected.length) saveHistory(); };
          el.onkeydown = (e) => { if (e.key === 'Enter') el.blur(); };
        });
      }

      function setupDOMEvents() {
        // Undo/redo for the 3D scene. When the Paint studio is on screen a
        // capture-phase handler (wired near the Paint module) intercepts these
        // first and routes them to the artwork history instead.
        document.getElementById('bld-undo').onclick = triggerUndo;
        document.getElementById('bld-redo').onclick = triggerRedo;

        // Tool rail
        document.querySelectorAll('#tool-rail button[data-tool]').forEach(b => { b.onclick = () => setActiveTool(b.dataset.tool); });

        function setGizmoMode(mode, btnId) {
          transformControl.setMode(mode);
          // While the slice plane is armed the gizmo belongs to the plane, so
          // switching Move/Rotate must keep it there rather than snapping back to
          // the object — otherwise Rotate would spin the model instead of the cut.
          if (sliceState.armed && sliceState.planeHelper) {
            moveGizmoTarget = null;
            transformControl.attach(sliceState.planeHelper);
            ['gizmo-translate','gizmo-rotate','gizmo-scale'].forEach(id => document.getElementById(id).classList.toggle('active', id === btnId));
            updateFloatingHUD();
            return;
          }
          const target = (selected.length > 1 && groupPivot) ? groupPivot : selected[0];
          if (target) attachGizmoTarget(target);
          ['gizmo-translate','gizmo-rotate','gizmo-scale'].forEach(id => document.getElementById(id).classList.toggle('active', id === btnId));
          updateFloatingHUD();   // swap which field group is shown
        }
        document.getElementById('gizmo-translate').onclick=()=>setGizmoMode('translate','gizmo-translate');
        document.getElementById('gizmo-rotate').onclick=()=>setGizmoMode('rotate','gizmo-rotate');
        document.getElementById('gizmo-scale').onclick=()=>setGizmoMode('scale','gizmo-scale');
        const aspBtn = document.getElementById('gizmo-aspect');
        if (aspBtn) aspBtn.onclick = () => {
          aspectLock3D = !aspectLock3D;
          aspBtn.classList.toggle('active', aspectLock3D);
          banner(aspectLock3D ? 'Lock ratio on — even scaling and square sketches. (Or hold Shift.)' : 'Lock ratio off.');
        };
        document.getElementById('hud-apply-size').onclick=applyHUDSize;
        bindHudLiveFields();

        document.querySelectorAll('.bld-prim').forEach(b => b.onclick = () => {
          let g, t=b.dataset.prim;
          // Higher default tessellation so shapes read as smooth, and so they hold up
          // when scaled up. Spheres/cylinders/cones especially benefit from more
          // segments; the box is subdivided so it takes fillets and sculpting well.
          if(t==='box') g=new THREE.BoxGeometry(20,20,20,24,24,24); else if(t==='cylinder') g=new THREE.CylinderGeometry(10,10,25,96,32);
          else if(t==='sphere') g=new THREE.SphereGeometry(12,96,64); else if(t==='cone') g=new THREE.ConeGeometry(10,25,96,32);
          else if(t==='wedge') g=makeWedgeGeometry(20,20,20);
          // These are all authored with their natural "height" along Y; stand
          // them up so height runs along Z, the app's vertical axis.
          g.rotateX(Math.PI / 2);

          g = makeGeometryCSGReady(g);
          let m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color:0xb0b8c8, roughness:0.38, metalness:0.05})); m.castShadow=true; m.receiveShadow=true;
          // Sit it exactly on the build plate (the old fixed height left the cube
          // floating 2 mm up and the cylinder/cone sunk 0.5 mm into the plate).
          g.computeBoundingBox(); m.position.z = -g.boundingBox.min.z;
          // Record what this started as. makeGeometryCSGReady() returns a plain
          // BufferGeometry, so the original type is gone by the time anything
          // wants to label it — the object browser included.
          m.userData.name = { box:'Cube', cylinder:'Cylinder', sphere:'Sphere', cone:'Cone', wedge:'Wedge' }[t] || 'Object';
          scene.add(m); objects.push(m); saveHistory(); updateStatus();
        });

        document.getElementById('bld-boolean-subtract').onclick = () => executeAutoBoolean('subtract');
        document.getElementById('bld-boolean-intersect').onclick = () => executeAutoBoolean('intersect');
        document.getElementById('bld-boolean-split').onclick = () => executeAutoBoolean('split');

        // Fillet
        let filletProfile = 'round';
        document.querySelectorAll('#fillet-profile .toggle-btn').forEach(b => b.onclick = () => {
          document.querySelectorAll('#fillet-profile .toggle-btn').forEach(x => x.classList.toggle('active', x === b));
          filletProfile = b.dataset.fprof;
          document.getElementById('bld-fillet-rad-lbl').textContent = filletProfile === 'chamfer' ? 'Bevel size' : 'Radius';
          const run = document.getElementById('bld-fillet-run');
          if (run) run.textContent = filletProfile === 'chamfer' ? 'Chamfer picked' : 'Fillet picked';
        });
        document.getElementById('bld-fillet-run').onclick = () => {
          if (filletProfile === 'chamfer') {
            const cs = document.getElementById('chamfer-size');
            if (cs) cs.value = document.getElementById('bld-fillet-rad').value;
            filletPickedEdges(true);
          } else filletPickedEdges(false);
        };
        document.getElementById('bld-fillet-clear').onclick = clearFilletPicks;
        document.querySelectorAll('#fillet-pickmode .toggle-btn').forEach(b => b.onclick = () => {
          document.querySelectorAll('#fillet-pickmode .toggle-btn').forEach(x => x.classList.toggle('active', x === b));
          filletPickOpts.connected = b.dataset.fpm === 'connected';
          document.getElementById('fillet-tol-row').style.display = filletPickOpts.connected ? '' : 'none';
          filletState.hovered = -1; filletState.hoverSet = null;
        });
        document.getElementById('fillet-tol').oninput = (e) => {
          filletPickOpts.tol = +e.target.value;
          document.getElementById('fillet-tol-val').textContent = e.target.value;
          filletState.hovered = -1; filletState.hoverSet = null;
        };
        const filletSlider = document.getElementById('bld-fillet-rad');
        const filletExact  = document.getElementById('bld-fillet-exact');
        filletSlider.oninput = (e) => {
          document.getElementById('bld-fillet-rad-val').textContent = parseFloat(e.target.value).toFixed(1) + " mm";
          if (filletExact) filletExact.value = e.target.value;
        };
        if (filletExact) filletExact.oninput = (e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) { document.getElementById('bld-fillet-rad-val').textContent = v.toFixed(1) + " mm"; if (v>=0.3 && v<=20) filletSlider.value = v; }
        };

        // ── Paint tool wiring ──
        const paintColorInput = document.getElementById('paint-color');
        const paintHexInput = document.getElementById('paint-hex');
        const setPaintColor = (hex) => {
          hex = hex.trim();
          if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
          paintColor = hex;
          paintColorInput.value = hex;
          paintHexInput.value = hex.toUpperCase();
        };
        paintColorInput.oninput = (e) => setPaintColor(e.target.value);
        paintHexInput.oninput = (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value.trim())) setPaintColor(e.target.value); };

        document.querySelectorAll('#paint-mode .toggle-btn').forEach(b => {
          b.onclick = () => {
            paintMode = b.dataset.pmode;
            document.querySelectorAll('#paint-mode .toggle-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            const brushOpts = document.getElementById('paint-brush-opts');
            if (brushOpts) brushOpts.style.display = paintMode === 'brush' ? '' : 'none';
            document.getElementById('paint-hint').textContent =
              paintMode === 'object' ? 'Object mode — click any solid to recolour the whole thing.'
              : paintMode === 'face' ? 'Face mode — click a face to flood just that surface.'
              : 'Brush mode — click and drag across the surface to paint freehand.';
          };
        });

        document.getElementById('paint-brush-size').oninput = (e) => {
          paintBrushSize = parseFloat(e.target.value);
          document.getElementById('paint-brush-val').textContent = e.target.value + " mm";
        };
        document.getElementById('paint-opacity').oninput = (e) => {
          paintOpacity = parseFloat(e.target.value) / 100;
          document.getElementById('paint-opacity-val').textContent = e.target.value + "%";
        };

        // Preset swatches (a practical clinical/material palette + primaries).
        const PAINT_SWATCHES = ['#4CC4D6','#E0A84A','#5EC98A','#E0685F','#8A9BB8','#B7E36A','#C77DFF','#F5F5F5',
                                '#2B6CB0','#D69E2E','#276749','#9B2C2C','#1A202C','#718096','#DD6B20','#000000'];
        const swWrap = document.getElementById('paint-swatches');
        PAINT_SWATCHES.forEach(hex => {
          const sw = document.createElement('button');
          sw.style.cssText = `width:100%; aspect-ratio:1; border-radius:5px; border:1px solid var(--line); background:${hex}; cursor:pointer; padding:0;`;
          sw.title = hex;
          sw.onclick = () => setPaintColor(hex);
          swWrap.appendChild(sw);
        });

        document.getElementById('paint-reset').onclick = () => {
          const targets = selected.length ? selected.filter(o => o.geometry && !o.userData.isSketch) : [];
          if (!targets.length) { banner("Select an object first, or click one with Paint to reset it."); return; }
          targets.forEach(resetObjectColor);
          saveHistory(); banner("Reset to default grey.");
        };

        const sculptToggle = document.getElementById('bld-sculpt-toggle');
        sculptToggle.onclick = () => {
          if (currentMode === 'sculpt') {
            currentMode = 'select';
            sculptToggle.classList.remove('active');
            sculptToggle.textContent = 'Arm sculpting brush';
            if (sculptBrush.ring) sculptBrush.ring.visible = false;
            banner("Sculpt brush disarmed.");
          } else {
            currentMode = 'sculpt';
            transformControl.detach();
            selected = [];
            sculptToggle.classList.add('active');
            sculptToggle.textContent = 'Disarm brush';
            banner("Sculpt brush active — drag across a surface.");
          }
          updateStatus();
        };

        document.getElementById('sculpt-add-btn').onclick = () => {
          sculptBrush.type = 'add';
          document.getElementById('sculpt-add-btn').classList.add('active');
          document.getElementById('sculpt-rem-btn').classList.remove('active');
        };
        document.getElementById('sculpt-rem-btn').onclick = () => {
          sculptBrush.type = 'remove';
          document.getElementById('sculpt-rem-btn').classList.add('active');
          document.getElementById('sculpt-add-btn').classList.remove('active');
        };

        document.getElementById('bld-sculpt-rad').oninput = (e) => {
          sculptBrush.radius = parseFloat(e.target.value);
          document.getElementById('bld-sculpt-rad-val').textContent = e.target.value + " mm";
        };
        document.getElementById('bld-sculpt-str').oninput = (e) => {
          sculptBrush.intensity = parseFloat(e.target.value);
          document.getElementById('bld-sculpt-str-val').textContent = e.target.value;
        };
        document.getElementById('bld-sculpt-subdivide').onclick = subdivideSelected;

        document.getElementById('bld-plane-arm').onclick = () => { currentMode='arm_plane'; transformControl.detach(); hideDimOverlay(); banner("Select baseline grid or solid face to map drawing canvas."); };
        
        document.querySelectorAll('.bld-sketch-tool').forEach(b => {
          b.onclick = () => {
            activeSketch.tempPoints = []; activeSketch.arcStage = 0; activeSketch.tool = b.dataset.stool;
            document.querySelectorAll('.bld-sketch-tool').forEach(btn=>btn.classList.remove('active')); 
            b.classList.add('active'); renderSegments(); hideDimOverlay();
            if (b.dataset.stool === 'line') banner("Line — click to start, then type a length or click to place. Double-click to finish.");
            else if (b.dataset.stool === 'fillet') banner("Round corner — set the radius, then click a corner where two lines meet.");
          }
        });
        document.getElementById('bld-sketch-bake').onclick = bakeSketch;

        // Sketch snapping controls
        const skSnapPoints = document.getElementById('sk-snap-points');
        if (skSnapPoints) skSnapPoints.onchange = e => { sketchSnap.points = e.target.checked; };
        const skSnapAngle = document.getElementById('sk-snap-angle');
        if (skSnapAngle) skSnapAngle.onchange = e => {
          sketchSnap.angle = e.target.checked;
          document.getElementById('sk-snap-angle-row').style.display = e.target.checked ? '' : 'none';
        };
        const skSnapAngleStep = document.getElementById('sk-snap-angle-step');
        if (skSnapAngleStep) skSnapAngleStep.onchange = e => { sketchSnap.angleStep = parseInt(e.target.value) || 15; };
        const skSnapGrid = document.getElementById('sk-snap-grid');
        if (skSnapGrid) skSnapGrid.onchange = e => {
          sketchSnap.grid = e.target.checked;
          document.getElementById('sk-snap-grid-row').style.display = e.target.checked ? '' : 'none';
        };
        const skSnapGridSize = document.getElementById('sk-snap-grid-size');
        if (skSnapGridSize) skSnapGridSize.oninput = e => {
          sketchSnap.gridSize = parseInt(e.target.value) || 5;
          document.getElementById('sk-snap-grid-val').textContent = e.target.value + ' mm';
        };

        // Corner-fillet radius: keep slider and exact box in sync.
        const skFilletSlider = document.getElementById('sk-fillet-rad');
        const skFilletExact  = document.getElementById('sk-fillet-exact');
        skFilletSlider.oninput = (e) => {
          document.getElementById('sk-fillet-rad-val').textContent = e.target.value + " mm";
          if (skFilletExact) skFilletExact.value = e.target.value;
        };
        if (skFilletExact) skFilletExact.oninput = (e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) { document.getElementById('sk-fillet-rad-val').textContent = v + " mm"; if (v >= 0.5 && v <= 40) skFilletSlider.value = v; }
        };

        // Dimension box: Enter commits, Esc cancels the shape. For the rectangle,
        // Tab hops width → height; Enter from either field builds the shape.
        const dimInput  = document.getElementById('dim-entry-input');
        const dimInput2 = document.getElementById('dim-entry-input2');
        [dimInput, dimInput2].forEach(inp => {
          // Tapping the field (on mobile especially) selects its contents so the
          // shown value can be typed over immediately.
          inp.addEventListener('focus', () => { setTimeout(() => inp.select(), 0); });
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              commitTypedDimension();
            } else if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation();
              activeSketch.tempPoints = []; activeSketch.arcStage = 0;
              renderSegments(); hideDimOverlay();
            } else if (e.key === 'Tab' && inp === dimInput && dimInput2.style.display !== 'none') {
              e.preventDefault(); dimInput2.focus(); dimInput2.select();
            }
          });
        });
        // Push / Pull: keep slider and exact-value input in sync
        const exhSlider = document.getElementById('bld-exh');
        const exactInput = document.getElementById('pushpull-exact');
        exhSlider.oninput = (e) => {
          document.getElementById('bld-exh-val').textContent = e.target.value + " mm";
          if (exactInput) exactInput.value = e.target.value;
        };
        if (exactInput) exactInput.oninput = (e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) { document.getElementById('bld-exh-val').textContent = v + " mm"; if (v >= 1 && v <= 100) exhSlider.value = v; }
        };
        document.querySelectorAll('#pushpull-dir .toggle-btn').forEach(b => {
          b.onclick = () => {
            pushDir = b.dataset.dir;
            document.querySelectorAll('#pushpull-dir .toggle-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
          };
        });
        document.getElementById('bld-extrude-btn').onclick = () => {
          if (pushPullFaceState.faces.length) {
            const depth = Math.abs(parseFloat(document.getElementById('bld-exh').value) || 15);
            const signedDepth = pushDir === 'push' ? -depth : depth;
            // Apply to each picked face. Re-find each face's seed triangle by its
            // stored plane just before applying, because pushing one face rebuilds
            // that mesh's geometry and invalidates triangle indices for the rest.
            const faces = [...pushPullFaceState.faces];
            let count = 0;
            faces.forEach(f => {
              try {
                let seed = f.triIndex;
                if (f.planeNormal) {
                  const found = findSeedTriByPlane(f.mesh, f.planeNormal, f.planeConst);
                  if (found >= 0) seed = found;
                }
                const res = applyFacePushPull(f.mesh, seed, signedDepth);
                if (res) count++;
              } catch (err) { console.error('push/pull face failed', err); }
            });
            clearPushPullFaceHighlight();
            saveHistory(); updateStatus(); updateFloatingHUD();
            banner(`${pushDir === 'push' ? 'Pushed in' : 'Pulled out'} ${count} face${count!==1?'s':''} by ${depth} mm.`);
          } else {
            extrudeSelectedSketch();
          }
        };

        // ── Slice tool ────────────────────────────────────────────────
        document.getElementById('bld-slice-arm').onclick = armSlice;
        // Mold tool
        const moldGo = document.getElementById('bld-mold-go');
        if (moldGo) moldGo.onclick = generateMold;
        [['mold-wall','mold-wall-val',' mm'], ['mold-sprue','mold-sprue-val',' mm'],
         ['mold-peg','mold-peg-val',' mm'], ['mold-clear','mold-clear-val',' mm'],
         ['mold-peglen','mold-peglen-val','\u00d7']]
          .forEach(([id, valId, suffix]) => {
            const el = document.getElementById(id), out = document.getElementById(valId);
            if (!el || !out) return;
            const upd = () => { out.textContent = el.value + suffix; };
            el.oninput = upd; upd();
          });
        document.getElementById('bld-slice-run').onclick = performSlice;
        // Touching a tilt slider clears any hand-rotation, so the sliders take back
        // control rather than appearing dead after the plane has been dragged round.
        document.getElementById('slice-rx').oninput = e => { sliceState.customNormal = null; sliceState.rotX = parseFloat(e.target.value); document.getElementById('slice-rx-val').textContent = e.target.value + "°"; };
        document.getElementById('slice-ry').oninput = e => { sliceState.customNormal = null; sliceState.rotY = parseFloat(e.target.value); document.getElementById('slice-ry-val').textContent = e.target.value + "°"; };
        document.getElementById('slice-rz').oninput = e => { sliceState.customNormal = null; sliceState.rotZ = parseFloat(e.target.value); document.getElementById('slice-rz-val').textContent = e.target.value + "°"; };
        document.getElementById('slice-off').oninput = e => { sliceState.offset = parseFloat(e.target.value); document.getElementById('slice-off-val').textContent = e.target.value + " mm"; };
        [['slice-keep-both','both'],['slice-keep-pos','positive'],['slice-keep-neg','negative']].forEach(([id,val]) => {
          document.getElementById(id).onclick = () => { sliceState.keep = val; ['slice-keep-both','slice-keep-pos','slice-keep-neg'].forEach(x=>document.getElementById(x).classList.remove('active')); document.getElementById(id).classList.add('active'); };
        });

        // ── Import ────────────────────────────────────────────────────
        const dropzone = document.getElementById('bld-dropzone');
        const fileInput = document.getElementById('bld-file-input');
        dropzone.onclick = () => fileInput.click();
        fileInput.onchange = e => { Array.from(e.target.files).forEach(f => importFile(f)); fileInput.value = ''; };
        ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
        ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
        dropzone.addEventListener('drop', e => { if (e.dataTransfer.files.length) Array.from(e.dataTransfer.files).forEach(f => importFile(f)); });

        // ── Image → 3D ────────────────────────────────────────────────
        const img3dZone = document.getElementById('bld-img3d-dropzone');
        const img3dInput = document.getElementById('bld-img3d-input');
        const loadImg3d = (file) => {
          lastImage3DFile = file;
          importImageTo3D(file);
        };
        // Mode toggle: outline (silhouette stamp) vs relief (brightness as height).
        const relOpts = document.getElementById('img3d-relief-opts');
        document.querySelectorAll('#img3d-mode .toggle-btn').forEach(btn => {
          btn.onclick = () => {
            document.querySelectorAll('#img3d-mode .toggle-btn').forEach(x => x.classList.toggle('active', x === btn));
            if (relOpts) relOpts.style.display = btn.dataset.mode === 'relief' ? '' : 'none';
          };
        });
        [['img3d-relief','img3d-relief-val',' mm'], ['img3d-base','img3d-base-val',' mm'],
         ['img3d-res','img3d-res-val',''], ['img3d-rsmooth','img3d-rsmooth-val',''],
         ['img3d-flatten','img3d-flatten-val','%']].forEach(([id,valId,suffix]) => {
          const el = document.getElementById(id), out = document.getElementById(valId);
          if (!el || !out) return;
          const upd = () => { out.textContent = el.value + suffix; };
          el.oninput = upd; upd();
        });
        img3dZone.onclick = () => img3dInput.click();
        img3dInput.onchange = e => { if (e.target.files.length) loadImg3d(e.target.files[0]); img3dInput.value = ''; };
        ['dragenter','dragover'].forEach(ev => img3dZone.addEventListener(ev, e => { e.preventDefault(); img3dZone.classList.add('dragover'); }));
        ['dragleave','drop'].forEach(ev => img3dZone.addEventListener(ev, e => { e.preventDefault(); img3dZone.classList.remove('dragover'); }));
        img3dZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) loadImg3d(e.dataTransfer.files[0]); });
        document.getElementById('bld-img3d-regen').onclick = () => {
          if (lastImage3DFile) importImageTo3D(lastImage3DFile);
          else banner("Load an image first.");
        };

        // Show/hide toggles for the Image and Text panels: users can collapse them
        // to keep the sidebar tidy, or open them to set up options before importing.
        // 3D Text, Image → 3D, Screw Thread and Shell each used to carry their own
        // small show/hide button next to the standard section chevron, so those
        // headers showed two controls that did the same thing. They now collapse
        // from the header like every other section, and the helper that drove the
        // old buttons has gone with them.

        const img3dSize = document.getElementById('img3d-size');
        img3dSize.oninput = e => { document.getElementById('img3d-size-val').textContent = e.target.value + " mm"; };
        const img3dDepth = document.getElementById('img3d-depth');
        img3dDepth.oninput = e => { document.getElementById('img3d-depth-val').textContent = e.target.value + " mm"; };
        const img3dThresh = document.getElementById('img3d-thresh');
        img3dThresh.oninput = e => { document.getElementById('img3d-thresh-val').textContent = e.target.value; };
        const img3dDetail = document.getElementById('img3d-detail');
        img3dDetail.oninput = e => { document.getElementById('img3d-detail-val').textContent = e.target.value + " px"; };
        const img3dSmooth = document.getElementById('img3d-smooth');
        img3dSmooth.oninput = e => { document.getElementById('img3d-smooth-val').textContent = e.target.value; };
        document.querySelectorAll('#img3d-polarity .toggle-btn').forEach(b => {
          b.onclick = () => {
            document.querySelectorAll('#img3d-polarity .toggle-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
          };
        });

        // ── 3D Text ───────────────────────────────────────────────────
        // ── Named save states ────────────────────────────────────────────────
        // A full snapshot of the 3D scene under a name you choose, so you can get
        // back to a specific agreed version rather than stepping through undo.
        function svRender(list) {
          const box = document.getElementById('sv-list');
          if (!box) return;
          if (!list || !list.length) {
            box.innerHTML = '<div class="pc-row"><span class="pc-detail">No saved versions yet.</span></div>';
            return;
          }
          box.innerHTML = '';
          list.forEach(rec => {
            const row = document.createElement('div');
            row.className = 'pc-row';
            row.style.justifyContent = 'space-between';
            const age = (() => {
              const s = Math.round((Date.now() - rec.savedAt) / 1000);
              if (s < 60) return 'just now';
              if (s < 3600) return Math.round(s/60) + ' min ago';
              if (s < 86400) return Math.round(s/3600) + ' hr ago';
              return new Date(rec.savedAt).toLocaleDateString();
            })();
            const info = document.createElement('div');
            // Built with textContent: rec.name is user-supplied (and can come back from an
            // imported/stored session), so it must never be parsed as HTML.
            const nameEl = document.createElement('b');
            nameEl.textContent = rec.name || 'Untitled';
            const detailEl = document.createElement('span');
            detailEl.className = 'pc-detail';
            detailEl.textContent = age + ' · ' + (rec.count || 0) + ' object' + (rec.count === 1 ? '' : 's');
            info.append(nameEl, document.createElement('br'), detailEl);
            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex; gap:5px; flex-shrink:0;';
            const load = document.createElement('button');
            load.className = 'mini-btn'; load.textContent = 'Open';
            load.onclick = () => {
              if (objects.length && !confirm('Open "' + rec.name + '"? The current scene will be replaced.')) return;
              Store.getSave(rec.id).then(full => {
                if (!full || !full.data) return banner('⚠️ That version could not be read.');
                restoreSession(full.data);
                banner('Opened "' + rec.name + '".');
              }).catch(() => banner('⚠️ Could not open that version.'));
            };
            const del = document.createElement('button');
            del.className = 'mini-btn danger'; del.textContent = 'Delete';
            del.onclick = () => {
              if (!confirm('Delete "' + rec.name + '" permanently?')) return;
              Store.delSave(rec.id).then(svRefresh).catch(() => {});
            };
            btns.append(load, del);
            row.append(info, btns);
            box.appendChild(row);
          });
        }
        function svRefresh() {
          if (!(window.Store && Store.available)) return;
          Store.listSaves().then(svRender).catch(() => {});
          Store.usage().then(u => {
            const el = document.getElementById('sv-usage');
            if (!el || !u || !u.quota) return;
            const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
            el.textContent = 'Using ' + mb(u.used) + ' of about ' + mb(u.quota) + ' available on this device.';
          }).catch(() => {});
        }
        const svSave = document.getElementById('sv-save');
        if (svSave) svSave.onclick = () => {
          if (!(window.Store && Store.available)) return banner('⚠️ This browser cannot store saved versions.');
          if (!objects.length) return banner('⚠️ Nothing to save yet.');
          const field = document.getElementById('sv-name');
          const name = (field && field.value.trim()) || ('Version ' + new Date().toLocaleString());
          const rec = {
            id: 'sv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name, savedAt: Date.now(), count: objects.length,
            data: { v: 1, savedAt: Date.now(), objects: serializeScene() }
          };
          Store.putSave(rec)
            .then(() => { if (field) field.value = ''; svRefresh(); banner('Saved "' + name + '".'); })
            .catch(err => { console.error(err); banner('⚠️ Could not save that version.'); });
        };
        svRefresh();

        // ── Mould type switch ─────────────────────────────────────────────────
        // Two different jobs share this panel: the print-and-pour mould you pour the
        // final part straight into, and the silicone mould box you cast a rubber
        // mould in. Only the settings that apply to the chosen one are shown.
        let moldKind = 'block';
        const MOLD_NOTES = {
          block: 'A printed block with your model\u2019s shape left hollow inside, a pour funnel and air vent from the top, split in two with alignment pegs. Clamp the halves together and pour resin, plaster or wax straight in.',
          cast: 'An open box, plus a lid that holds your model hanging inside it by its pour funnel, leaving an even gap all round to fill with silicone. Once cured, cut the rubber open to free the model and cast copies in it.'
        };
        function syncMoldKind() {
          const note = document.getElementById('mold-kind-note');
          if (note) note.textContent = MOLD_NOTES[moldKind];
          const blockOpts = document.getElementById('block-opts'), castOpts = document.getElementById('cast-opts');
          if (blockOpts) blockOpts.style.display = (moldKind === 'cast') ? 'none' : '';
          if (castOpts) castOpts.style.display = (moldKind === 'cast') ? '' : 'none';
          const go = document.getElementById('bld-mold-go');
          if (go) go.textContent = (moldKind === 'cast') ? 'Generate silicone mould box' : 'Generate mould';
        }
        document.querySelectorAll('#mold-kind .toggle-btn').forEach(b => {
          b.onclick = () => {
            moldKind = b.dataset.kind;
            document.querySelectorAll('#mold-kind .toggle-btn').forEach(x => x.classList.toggle('active', x === b));
            syncMoldKind();
          };
        });
        [['cast-gap','cast-gap-val',' mm'], ['cast-wall','cast-wall-val',' mm'], ['cast-base','cast-base-val',' mm'],
         ['cast-lid','cast-lid-val',' mm'], ['cast-clear','cast-clear-val',' mm']]
          .forEach(([id, vid, suf]) => {
            const el = document.getElementById(id), out = document.getElementById(vid);
            if (!el || !out) return;
            const upd = () => { out.textContent = el.value + suf; };
            el.oninput = upd; upd();
          });
        syncMoldKind();
        window.currentMoldKind = () => moldKind;

        // Print check
        const pcRun = document.getElementById('pc-run');
        if (pcRun) pcRun.onclick = () => {
          const num = (id, dflt) => { const e = document.getElementById(id); return e ? (parseFloat(e.value) || dflt) : dflt; };
          banner('Checking model…');
          try {
            const r = runPrintCheck({
              nozzle: num('pc-nozzle', 0.4),
              minWall: num('pc-wall', 0.8),
              overhang: num('pc-over', 45),
              bed: [num('pc-bed-x', 256), num('pc-bed-y', 256), num('pc-bed-z', 256)]
            });
            renderPrintCheck(r);
            banner(r.empty ? 'Nothing to check yet.'
                 : (r.watertight && r.fitsBed ? 'Check complete — no blocking problems.'
                                              : 'Check complete — see the report.'));
          } catch (err) {
            console.error('Print check failed:', err);
            banner('⚠️ Couldn\'t finish the check: ' + ((err && err.message) || err));
          }
        };
        [['pc-nozzle','pc-nozzle-val',' mm'], ['pc-wall','pc-wall-val',' mm'],
         ['pc-over','pc-over-val','\u00b0']].forEach(([id, valId, suffix]) => {
          const el = document.getElementById(id), out = document.getElementById(valId);
          if (!el || !out) return;
          const upd = () => { out.textContent = el.value + suffix; };
          el.oninput = upd; upd();
        });

        document.getElementById('bld-text3d-run').onclick = generate3DText;
        // If stale (pre-fix) uploaded fonts were discarded on load, say so once —
        // otherwise the font would just silently vanish from the list.
        if (window.__fontsRetired) {
          const n = window.__fontsRetired; window.__fontsRetired = 0;
          setTimeout(() => banner(n + ' uploaded font' + (n===1?'':'s') +
            ' had to be re-read after a glyph fix — please upload again.'), 1200);
        }
        const t3dAmt = document.getElementById('text3d-warp-amt');
        const t3dAmtVal = document.getElementById('text3d-warp-amt-val');
        if (t3dAmt && t3dAmtVal) {
          const upd = () => { t3dAmtVal.textContent = t3dAmt.value + '%'; };
          t3dAmt.oninput = upd; upd();
        }
        const fontFileInput = document.getElementById('bld-text3d-fontfile');
        document.getElementById('bld-text3d-upload').onclick = () => fontFileInput.click();
        fontFileInput.onchange = e => { if (e.target.files.length) handleFontUpload(e.target.files[0]); fontFileInput.value = ''; };
        const text3dSize = document.getElementById('text3d-size');
        const text3dSizeExact = document.getElementById('text3d-size-exact');
        text3dSize.oninput = e => {
          document.getElementById('text3d-size-val').textContent = parseFloat(e.target.value).toFixed(1) + " mm";
          if (text3dSizeExact) text3dSizeExact.value = e.target.value;
        };
        if (text3dSizeExact) text3dSizeExact.oninput = e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) { document.getElementById('text3d-size-val').textContent = v.toFixed(1) + " mm"; if (v>=2 && v<=60) text3dSize.value = v; }
        };
        const text3dDepth = document.getElementById('text3d-depth');
        const text3dDepthExact = document.getElementById('text3d-depth-exact');
        text3dDepth.oninput = e => {
          document.getElementById('text3d-depth-val').textContent = parseFloat(e.target.value).toFixed(1) + " mm";
          if (text3dDepthExact) text3dDepthExact.value = e.target.value;
        };
        if (text3dDepthExact) text3dDepthExact.oninput = e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) { document.getElementById('text3d-depth-val').textContent = v.toFixed(1) + " mm"; if (v>=0.5 && v<=30) text3dDepth.value = v; }
        };

        // ── Export ────────────────────────────────────────────────────
        document.getElementById('bld-repair-mesh').onclick = repairModelMeshes;
        document.getElementById('bld-export-stl').onclick = exportSTL;
        document.getElementById('bld-export-obj').onclick = exportOBJ;
        document.getElementById('bld-export-3mf').onclick = export3MF;

        // ── Session (auto-save / crash recovery) ──
        const sessSave = document.getElementById('bld-session-save');
        if (sessSave) sessSave.onclick = () => { saveSession(); banner("Session saved to this device."); };
        const sessClear = document.getElementById('bld-session-clear');
        if (sessClear) sessClear.onclick = () => {
          if (!confirm("Delete the auto-saved session and clear everything on screen?\n\nThis can't be undone.")) return;
          objects.slice().forEach(o => scene.remove(o));
          objects = []; selected = []; transformControl.detach();
          historyTimeline = []; historyIndex = -1;
          clearSession();
          saveHistory(); updateStatus(); updateFloatingHUD();
          banner("Scene cleared and saved session deleted.");
        };
        updateSessionStatus();
        setInterval(updateSessionStatus, 15000);

        document.getElementById('bld-duplicate').onclick = duplicateSelected;
        const frameSelBtn = document.getElementById('bld-frame-sel');
        if (frameSelBtn) frameSelBtn.onclick = () => frameObjects(selected);
        const frameAllBtn = document.getElementById('bld-frame-all');
        if (frameAllBtn) frameAllBtn.onclick = () => frameObjects(null);
        document.getElementById('bld-settle').onclick = settleSelected;
        document.getElementById('bld-centre').onclick = centreSelected;
        document.getElementById('bld-delete').onclick = deleteSelected;

        // ── Mirror ────────────────────────────────────────────────────
        document.getElementById('bld-mirror-x').onclick = () => mirrorSelected('x');
        document.getElementById('bld-mirror-y').onclick = () => mirrorSelected('y');
        document.getElementById('bld-mirror-z').onclick = () => mirrorSelected('z');
        document.getElementById('bld-mirror-keep').onclick = (e) => {
          mirrorKeepOriginal = !mirrorKeepOriginal;
          const btn = e.currentTarget;
          btn.classList.toggle('active', mirrorKeepOriginal);
          btn.textContent = 'Keep original: ' + (mirrorKeepOriginal ? 'on' : 'off');
        };
        document.getElementById('bld-measure-clear').onclick = () => { clearMeasure(); banner("Measurement cleared."); };

        // ── Screw Thread ──────────────────────────────────────────────
        const linkSliderExact = (sliderId, exactId, valId, unit, decimals=1) => {
          const slider = document.getElementById(sliderId);
          const exact = document.getElementById(exactId);
          const val = document.getElementById(valId);
          if (!slider) return;
          slider.oninput = e => {
            const v = parseFloat(e.target.value);
            if (val) val.textContent = v.toFixed(decimals) + (unit ? ' ' + unit : '');
            if (exact) exact.value = v;
          };
          if (exact) exact.oninput = e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) { if (val) val.textContent = v.toFixed(decimals) + (unit ? ' ' + unit : ''); if (v >= slider.min && v <= slider.max) slider.value = v; }
          };
        };
        linkSliderExact('thread-dia', 'thread-dia-exact', 'thread-dia-val', 'mm', 1);
        linkSliderExact('thread-pitch', 'thread-pitch-exact', 'thread-pitch-val', 'mm', 1);
        linkSliderExact('thread-len', 'thread-len-exact', 'thread-len-val', 'mm', 0);
        document.querySelectorAll('#thread-type .toggle-btn').forEach(b => {
          b.onclick = () => {
            document.querySelectorAll('#thread-type .toggle-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            const help = document.getElementById('thread-type-help');
            if (help) help.textContent = b.dataset.tt === 'internal'
              ? 'A cutting tool for a threaded hole. Position it where the hole goes, select it and your part, then Booleans → Cut to leave threads inside the hole (like a nut).'
              : 'A threaded rod — like a bolt or screw. Use it as-is, or combine it with your part.';
          };
        });
        document.querySelectorAll('#thread-hand .toggle-btn').forEach(b => {
          b.onclick = () => { document.querySelectorAll('#thread-hand .toggle-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); };
        });
        document.getElementById('bld-thread-run').onclick = createScrewThread;

        document.getElementById('bld-group').onclick = groupSelected;
        document.getElementById('bld-ungroup').onclick = ungroupSelected;
        document.getElementById('bld-merge').onclick = mergeSelected;

        document.getElementById('bld-snap-toggle').onclick = (e) => {
          snapEnabled = !snapEnabled;
          const btn = e.currentTarget;
          btn.classList.toggle('active', snapEnabled);
          btn.innerHTML = btn.innerHTML.replace(/Face snap: (on|off)/, 'Face snap: ' + (snapEnabled ? 'on' : 'off'));
          banner(snapEnabled ? "Face snapping on — drag a solid near another to snap flush." : "Face snapping off.");
        };

        document.getElementById('bld-center-snap-toggle').onclick = (e) => {
          centerSnapEnabled = !centerSnapEnabled;
          const btn = e.currentTarget;
          btn.classList.toggle('active', centerSnapEnabled);
          btn.innerHTML = btn.innerHTML.replace(/Center\/inline snap: (on|off)/, 'Center/inline snap: ' + (centerSnapEnabled ? 'on' : 'off'));
          banner(centerSnapEnabled ? "Center/inline snapping on — drag a solid so its middle lines up with another." : "Center/inline snapping off.");
        };

        // ── New modeling tools wiring ──
        // Shell / hollow
        document.getElementById('shell-thick').oninput = e => document.getElementById('shell-thick-val').textContent = e.target.value + ' mm';
        document.getElementById('bld-shell-run').onclick = () => shellSelected(parseFloat(document.getElementById('shell-thick').value));

        // Chamfer
        document.getElementById('chamfer-size').oninput = e => document.getElementById('chamfer-size-val').textContent = e.target.value + ' mm';
        document.getElementById('bld-chamfer-pick').onclick = () => { setActiveTool('fillet'); banner("Pick edges with the Fillet tool, then come back and Chamfer."); };
        document.getElementById('bld-chamfer-run').onclick = () => chamferPickedEdges();

        // Array
        document.querySelectorAll('#array-type .toggle-btn').forEach(b => b.onclick = () => {
          document.querySelectorAll('#array-type .toggle-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          const linear = b.dataset.atype === 'linear';
          document.getElementById('array-linear-opts').style.display = linear ? '' : 'none';
          document.getElementById('array-circ-hint').style.display = linear ? 'none' : '';
          const cc = document.getElementById('array-circ-centre'); if (cc) cc.style.display = linear ? 'none' : '';
        });
        document.getElementById('array-count').oninput = e => document.getElementById('array-count-val').textContent = e.target.value;
        ['dx','dy','dz'].forEach(ax => { const el = document.getElementById('array-'+ax); if (el) el.oninput = e => document.getElementById('array-'+ax+'-val').textContent = e.target.value + ' mm'; });
        const pickCentreBtn = document.getElementById('bld-array-pickcentre');
        if (pickCentreBtn) pickCentreBtn.onclick = () => beginArrayCentrePick();
        document.getElementById('bld-array-run').onclick = () => {
          const count = parseInt(document.getElementById('array-count').value);
          const type = (document.querySelector('#array-type .toggle-btn.active')||{}).dataset.atype;
          if (type === 'circular') arrayCircular(count);
          else arrayLinear(count, parseFloat(document.getElementById('array-dx').value), parseFloat(document.getElementById('array-dy').value), parseFloat(document.getElementById('array-dz').value));
          // clear the picked centre after use so the next array defaults to middle
          arrayCentrePoint = null;
          const st = document.getElementById('array-centre-status'); if (st) st.textContent = 'Centre: middle of object';
        };

        // Align / distribute
        let alignAxis = 'x';
        document.querySelectorAll('#align-axis .toggle-btn').forEach(b => b.onclick = () => {
          alignAxis = b.dataset.axis;
          document.querySelectorAll('#align-axis .toggle-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
        });
        document.getElementById('bld-align-min').onclick = () => alignSelected(alignAxis, 'min');
        document.getElementById('bld-align-mid').onclick = () => alignSelected(alignAxis, 'mid');
        document.getElementById('bld-align-max').onclick = () => alignSelected(alignAxis, 'max');
        document.getElementById('bld-distribute').onclick = () => distributeSelected(alignAxis);

        // Smooth
        document.getElementById('smooth-str').oninput = e => document.getElementById('smooth-str-val').textContent = e.target.value + '%';
        document.getElementById('smooth-pass').oninput = e => document.getElementById('smooth-pass-val').textContent = e.target.value;
        document.getElementById('bld-smooth-run').onclick = () => smoothSelected(parseInt(document.getElementById('smooth-pass').value), parseFloat(document.getElementById('smooth-str').value)/100);

        // Revolve
        document.getElementById('revolve-deg').oninput = e => document.getElementById('revolve-deg-val').textContent = e.target.value + '°';
        document.getElementById('revolve-seg').oninput = e => document.getElementById('revolve-seg-val').textContent = e.target.value;
        document.getElementById('revolve-off').oninput = e => document.getElementById('revolve-off-val').textContent = e.target.value + ' mm';
        let revolveAxis = 'y';
        document.querySelectorAll('#revolve-axis .toggle-btn').forEach(b => b.onclick = () => {
          revolveAxis = b.dataset.raxis;
          document.querySelectorAll('#revolve-axis .toggle-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
        });
        document.getElementById('bld-revolve-run').onclick = () => revolveSketch(
          parseInt(document.getElementById('revolve-seg').value),
          parseFloat(document.getElementById('revolve-deg').value),
          revolveAxis,
          parseFloat(document.getElementById('revolve-off').value)
        );

        // Loft
        document.getElementById('bld-loft-run').onclick = loftSelectedSketches;

        // Multi-select toggle — now lives in the Selection pane. When on, plain
        // clicks add/remove objects from the selection (handy on touch screens).
        function setMultiSelect(on) {
          multiSelectMode = on;
          const btn = document.getElementById('bld-multiselect-toggle');
          if (btn) {
            btn.classList.toggle('active', on);
            btn.innerHTML = btn.innerHTML.replace(/Multi-select: (on|off)/, 'Multi-select: ' + (on ? 'on' : 'off'));
          }
          banner(on ? "Multi-select on — click objects to add or remove them." : "Multi-select off.");
        }
        const msBtn = document.getElementById('bld-multiselect-toggle');
        if (msBtn) msBtn.onclick = () => setMultiSelect(!multiSelectMode);
        document.querySelectorAll('#side-tabs button[data-tab]').forEach(b => b.onclick = () => {
          if (b.dataset.tab === 'tool') {
            // clicking the dynamic tool tab just keeps the current tool active
            if (activeTool && activeTool !== 'select') setActiveTool(activeTool);
          } else {
            setActivePanelTab(b.dataset.tab);
          }
        });
        document.getElementById('bld-select-all').onclick = selectAllObjects;
        document.getElementById('bld-select-none').onclick = clearSelection;
        const container = document.getElementById('bld-viewport');
        window.addEventListener('resize', () => { camera.aspect = container.clientWidth/container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); });
      }

      function updateStatus() { 
        document.getElementById('bld-count').textContent=objects.length; 
        const n = selected.length;
        document.getElementById('bld-sel').textContent = n === 0 ? "none" : (n === 1 ? "1 item" : n + " items");
        const mc = document.getElementById('multiselect-count'); if (mc) mc.textContent = n;
        const smc = document.getElementById('select-mini-count'); if (smc) smc.textContent = n;
        // The Object (duplicate/delete) panel only makes sense once something is
        // selected — and only for tools whose panel set includes it at all.
        const wsEl = document.getElementById('sec-workspace');
        if (wsEl) {
          const toolShowsIt = activeTool === 'select'
            ? (TAB_PANELS[activePanelTab] || []).includes('sec-workspace')
            : (TOOL_PANELS[activeTool] || []).includes('sec-workspace');
          wsEl.style.display = (toolShowsIt && n > 0) ? '' : 'none';
        }
        updateLayersUI();
        // Keep the object browser in step with the scene.
        if (window.renderObjectBrowser) renderObjectBrowser();
      }
      function banner(msg) {
        const el=document.getElementById('bld-banner');
        el.textContent=msg;
        el.classList.add('show');
        if(window.bannerTimeout) clearTimeout(window.bannerTimeout);
        window.bannerTimeout = setTimeout(()=>el.classList.remove('show'),4200);
      }

      return { start };
    })();

    window.onload = Builder.start;
  
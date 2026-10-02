
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


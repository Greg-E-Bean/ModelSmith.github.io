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
  
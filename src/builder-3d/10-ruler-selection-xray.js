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


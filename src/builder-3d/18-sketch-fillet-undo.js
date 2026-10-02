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


      // ── Custom imported brushes ─────────────────────────────────────────────
      // A custom brush is an image whose alpha defines the stamp shape. We keep a
      // white "mask" version and tint it to the current colour on demand (cached per
      // colour). Definitions persist in localStorage as data URLs.
      const customBrushes = {};   // key 'custom:<id>' -> { img, tinted, tintedFor, angled }
      const CUSTOM_BRUSH_KEY = 'modelsmith_brushes_v1';

      function makeCustomBrush(key, dataURL) {
        const img = new Image();
        const rec = { img, tinted: null, _cacheColor: null, _cacheCanvas: null, angled: false, dataURL };
        rec.tintedFor = (color) => {
          if (rec._cacheColor === color && rec._cacheCanvas) return rec._cacheCanvas;
          const s = 128;
          const cv = document.createElement('canvas'); cv.width = s; cv.height = s;
          const c = cv.getContext('2d');
          // draw the brush image, then use it as an alpha mask over a solid colour
          c.clearRect(0, 0, s, s);
          c.drawImage(img, 0, 0, s, s);
          c.globalCompositeOperation = 'source-in';
          c.fillStyle = color; c.fillRect(0, 0, s, s);
          c.globalCompositeOperation = 'source-over';
          rec._cacheColor = color; rec._cacheCanvas = cv;
          return cv;
        };
        img.onload = () => { rec.tinted = true; renderCustomTips(); drawTipPreviews(); };
        img.src = dataURL;
        customBrushes[key] = rec;
        return rec;
      }

      function loadCustomBrushes() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(CUSTOM_BRUSH_KEY) || '{}'); } catch (e) {}
        Object.keys(saved).forEach(key => makeCustomBrush(key, saved[key]));
        renderCustomTips();
      }
      function persistCustomBrushes() {
        const out = {};
        Object.keys(customBrushes).forEach(k => { out[k] = customBrushes[k].dataURL; });
        try { localStorage.setItem(CUSTOM_BRUSH_KEY, JSON.stringify(out)); }
        catch (e) { banner('⚠️ Not enough room to save the brush on this device.'); }
      }

      function renderCustomTips() {
        const wrap = $('pb-custom-tips'); if (!wrap) return;
        wrap.innerHTML = '';
        Object.keys(customBrushes).forEach(key => {
          const btn = document.createElement('button');
          btn.className = 'tip-btn'; btn.dataset.shape = key;
          btn.title = 'Custom brush — tap to use, long-press / right-click to remove';
          const cv = document.createElement('canvas'); cv.width = 44; cv.height = 44;
          const c = cv.getContext('2d');
          try {
            const n = 7;
            for (let i = 0; i < n; i++) { const t = i/(n-1); brushStamp(c, 10+t*24, 30-t*16, 15, '#e8e4dd', 1, key, 0.6); }
          } catch (e) {}
          btn.appendChild(cv);
          const nm = document.createElement('span'); nm.className = 'tip-name'; nm.textContent = 'Custom';
          btn.appendChild(nm);
          btn.onclick = () => {
            document.querySelectorAll('#pb-shape .tip-btn, #pb-custom-tips .tip-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            syncTipUI();
          };
          // remove via right-click / long-press
          btn.oncontextmenu = (e) => { e.preventDefault(); if (confirm('Remove this custom brush?')) { delete customBrushes[key]; persistCustomBrushes(); renderCustomTips(); } };
          let lp = null;
          btn.onpointerdown = () => { lp = setTimeout(() => { if (confirm('Remove this custom brush?')) { delete customBrushes[key]; persistCustomBrushes(); renderCustomTips(); } }, 650); };
          btn.onpointerup = btn.onpointerleave = () => { if (lp) clearTimeout(lp); };
          wrap.appendChild(btn);
        });
      }

      function importBrushImages(files) {
        let count = 0;
        Array.from(files).forEach(file => {
          if (!file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = () => {
            const key = 'custom:' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            makeCustomBrush(key, reader.result);
            persistCustomBrushes();
            count++;
            banner('Custom brush added — find it under the tips.');
          };
          reader.readAsDataURL(file);
        });
      }

      function onDown(e) {
        _sc = null; _scTicks = 0;   // a new gesture starts from a fresh layer cache
        let l = active();
        // If a group folder is selected, painting has no target — hop to the group's
        // topmost real layer (or warn if it's empty) so a stroke still lands somewhere.
        if (l && l.kind === 'group') {
          const child = [...layers].reverse().find(x => x.kind !== 'group' && x.groupId === l.id);
          if (child) { activeId = child.id; l = child; renderLayerList(); syncLayerControls(); }
          else { banner('This group is empty — add or move a layer into it first.'); return; }
        }
        if (!l) return;
        // On touch/pen, stop the browser running its own gesture (scroll, long-press
        // selection, iOS magnifier) in parallel with our drag — that parallel handling
        // is what made shapes "dodge" the finger. Mouse is unaffected.
        if (e.pointerType !== 'mouse' && e.cancelable) e.preventDefault();
        view.setPointerCapture(e.pointerId);
        const p = pos(e);

        // --- selection tools ---
        if (tool === 'selrect' || tool === 'seloval' || tool === 'lasso') {
          selDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, pts: [{ x: p.x, y: p.y }] };
          drawing = true; return;
        }
        if (tool === 'magic') {
          lastMagic = { x: p.x, y: p.y };
          magicSelect(p.x, p.y);
          composite();
          banner(sel ? 'Selected matching area — paint is now limited to it.' : 'Nothing matched there.');
          return;
        }
        if (tool === 'selmove') {
          if (!sel) return banner('Make a selection first.');
          // Lift the selected pixels into a "floating" buffer the first time we
          // start moving. After that the float and its mask travel together, so
          // repeated drags keep moving the same pixels instead of re-cutting the
          // layer at the original spot (which used to slice anything half-outside).
          if (!floatSel) liftSelection(l);
          selMoveState = { start: p, ox: floatSel.x, oy: floatSel.y };
          drawing = true; return;
        }

        if (tool === 'text') {
          if (l.kind === 'vector') return banner('Text lands on raster layers — pick a PIX layer.');
          // Clicking existing live text grabs it to drag; clicking away settles it.
          if (liveText) {
            if (hitLiveText(p)) { textDrag = { dx: p.x - liveText.x, dy: p.y - liveText.y }; drawing = true; return; }
            commitText();
          }
          // Clicking an already-committed text object re-opens it for editing rather
          // than stacking a new one on top — this is what makes text re-typeable.
          const hit = hitLayerText(l, p);
          if (hit >= 0) {
            const t = l.texts[hit];
            // lift it out of the baked set while editing so it isn't shown twice
            l.texts.splice(hit, 1);
            renderTextLayer(l); composite();
            startLiveText({ x: t.x, y: t.y }, t.str, t);
            if ($('ps-textsize')) { $('ps-textsize').value = t.size; if ($('ps-textsize-val')) $('ps-textsize-val').textContent = t.size; }
            if ($('ps-font')) $('ps-font').value = t.key;
            return;
          }
          // Start an empty live text at the click point and type straight onto the
          // canvas — no popover. Keystrokes are handled by the text keyboard hook
          // below, and the caret blinks at the insertion point.
          startLiveText(p);
          return;
        }

        if (tool === 'picker') {
          // read from a clean flatten so ants/handles can't be picked up as colour
          const d = flatten().getContext('2d').getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
          if (d[3] > 0) {
            const h = rgb2hsv(d[0], d[1], d[2]);
            fg = { ...h, a: fg.a };
            syncColorUI();
            banner('Picked ' + toHex(fg).toUpperCase());
          }
          return;
        }
        if (tool === 'fill') {
          if (l.kind === 'vector') return banner('Fill works on raster layers.');
          if (sel && !sel[Math.floor(p.y) * W + Math.floor(p.x)]) return banner('That point is outside the selection.');
          const before = sel ? l.ctx.getImageData(0, 0, W, H) : null;
          floodFill(l, p.x, p.y, toolColor());
          if (sel) {
            // keep only the part of the fill that falls inside the selection
            const filled = document.createElement('canvas'); filled.width = W; filled.height = H;
            const fx = filled.getContext('2d');
            fx.drawImage(l.canvas, 0, 0);
            fx.globalCompositeOperation = 'destination-in';
            fx.drawImage(selMaskToCanvas(), 0, 0);
            l.ctx.setTransform(1, 0, 0, 1, 0, 0);
            l.ctx.putImageData(before, 0, 0);
            l.ctx.save(); l.ctx.globalCompositeOperation = 'destination-out';
            l.ctx.drawImage(selMaskToCanvas(), 0, 0); l.ctx.restore();
            l.ctx.drawImage(filled, 0, 0);
          }
          composite(); pushHistory(); return;
        }
        // Clone source can be set with Alt/Cmd+click on a desktop, or by arming the
        // "Set source" button first — tablets have no modifier keys, so without the
        // button the tool was unusable on touch.
        if (tool === 'clone' && (e.altKey || e.metaKey || cloneArmed)) {
          cloneSrc = { x: p.x, y: p.y }; cloneOffset = null;
          cloneArmed = false; if (window.syncCloneUI) window.syncCloneUI();
          banner('Clone source set — now paint elsewhere.'); return;
        }
        if (tool === 'clone' && !cloneSrc) {
          banner('Tap "Set source" (or Alt+click) to pick what to clone from.'); return;
        }
        if (tool === 'puppet' && puppet) {
          // Grab an existing pin if one is under the finger, otherwise drop a new one.
          const r = 12 / zoom;
          const pt = p;
          let hit = -1;
          for (let i = puppet.pins.length - 1; i >= 0; i--) {
            const pin = puppet.pins[i];
            if (Math.hypot(pin.x - pt.x, pin.y - pt.y) <= r) { hit = i; break; }
          }
          if (hit < 0) {
            puppet.pins.push({ x: pt.x, y: pt.y, ox: pt.x, oy: pt.y });
            hit = puppet.pins.length - 1;
            puppetPreview();
          }
          puppet.drag = hit;
          drawing = true;
          composite();
          return;
        }
        if (tool === 'vedit') {
          if (l.kind !== 'vector') return banner('Switch to a vector layer (VEC) to edit points.');
          const h = hitHandle(l, p);
          if (h) { vSel = h; vSel.mode = 'handle'; drawing = true; }
          else {
            const si = hitShape(l, p);
            if (si >= 0) { vSel = { shapeIndex: si, mode: 'shape', grab: p, orig: JSON.parse(JSON.stringify(l.shapes[si])) }; drawing = true; }
            else vSel = null;
          }
          composite();
          return;
        }
        if (tool === 'gradient') {
          if (l.kind === 'vector') return banner('Gradient works on raster layers.');
          gradStart = p; drawing = true; return;
        }
        if (tool === 'transform') {
          if (!xform) beginTransform();
          if (xform) {
            const hit = transformHit(p);
            xform.mode = hit ? hit.mode : 'move';
            xform.grab = { p, cx: xform.cx, cy: xform.cy, sx: xform.sx, sy: xform.sy, angle: xform.angle,
                           ang0: Math.atan2(p.y - xform.cy, p.x - xform.cx) };
            drawing = true;
          }
          return;
        }
        if (tool === 'move') {
          moveStart = p; moveSnapshot = l.ctx.getImageData(0, 0, W, H);
          drawing = true; return;
        }
        if (tool === 'pen') {
          // Snap each new point relative to the previous one when angle-snap is on,
          // so a click-to-click polyline locks to 0/45/90° just like the drag shapes.
          const pt = (penPts.length && vSnapEnabled) ? snapAngle(penPts[penPts.length - 1], p, 'line') : p;
          penPts.push({ x: pt.x, y: pt.y });
          previewShape = { type: 'path', pts: penPts.slice(), stroke: toolColor(), width: toolSize(), strokeOn: true, fill: ($('ps-vfill') && $('ps-vfill').checked) ? toolColor() : 'transparent' };
          drawPreview(); return;
        }
        if (DRAG_SHAPES.test(tool)) {
          shapeStart = p; drawing = true; return;
        }

        // brush / eraser / smudge / retouch — clipped to the selection if there is one
        drawing = true; last = p; dist = 0;
        beginStroke(l);
        strokeAt(l, p, p);
        compositeStroke(l);
      }

      // Pixel-level helpers shared by the retouch brushes (blur/dodge/burn).
      function patchOp(ctx, x, y, size, fn) {
        const s = Math.max(3, Math.ceil(size));
        const x0 = Math.floor(x - s / 2), y0 = Math.floor(y - s / 2);
        const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0);
        const cx1 = Math.min(W, x0 + s), cy1 = Math.min(H, y0 + s);
        const w = cx1 - cx0, h = cy1 - cy0;
        if (w <= 0 || h <= 0) return;
        const img = ctx.getImageData(cx0, cy0, w, h);
        fn(img, w, h, x - cx0, y - cy0, s / 2);
        ctx.putImageData(img, cx0, cy0);
      }
      // circular falloff weight for a pixel inside the brush
      const falloff = (dx, dy, r, hard) => {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) return 0;
        return hard >= 0.99 ? 1 : Math.min(1, (1 - d) / Math.max(0.001, 1 - hard));
      };

      // When a selection is active, brush work is drawn onto a scratch layer that
      // mirrors the target, then masked and blitted back — so strokes stop at the
      // selection edge. Retouch tools (blur/dodge/burn/smudge/clone) read pixels
      // directly, so they operate on the scratch copy too and stay consistent.
      let strokeScratch = null;
      function beginStroke(l) {
        if (!sel) { strokeScratch = null; return; }
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(l.canvas, 0, 0);
        strokeScratch = { canvas: c, ctx: x, before: l.ctx.getImageData(0, 0, W, H) };
      }
      function endStroke(l) {
        if (!strokeScratch) return;
        // Keep only what changed inside the selection: restore the original, then
        // paint the scratch result back through the mask.
        const masked = document.createElement('canvas'); masked.width = W; masked.height = H;
        const mx = masked.getContext('2d');
        mx.drawImage(strokeScratch.canvas, 0, 0);
        mx.globalCompositeOperation = 'destination-in';
        mx.drawImage(selMaskToCanvas(), 0, 0);
        l.ctx.setTransform(1, 0, 0, 1, 0, 0);
        l.ctx.putImageData(strokeScratch.before, 0, 0);
        l.ctx.save();
        l.ctx.globalCompositeOperation = 'destination-out';
        l.ctx.drawImage(selMaskToCanvas(), 0, 0);
        l.ctx.restore();
        l.ctx.drawImage(masked, 0, 0);
        strokeScratch = null;
        touch(l);
      }
      // Live preview mid-stroke: show the layer as it will land, without committing.
      function compositeStroke(l) {
        if (!strokeScratch) { composite(); return; }
        const masked = document.createElement('canvas'); masked.width = W; masked.height = H;
        const mx = masked.getContext('2d');
        mx.drawImage(strokeScratch.canvas, 0, 0);
        mx.globalCompositeOperation = 'destination-in';
        mx.drawImage(selMaskToCanvas(), 0, 0);
        // temporarily swap the layer's pixels for the preview
        const keep = l.canvas;
        const prev = document.createElement('canvas'); prev.width = W; prev.height = H;
        const px = prev.getContext('2d');
        px.putImageData(strokeScratch.before, 0, 0);
        px.save(); px.globalCompositeOperation = 'destination-out';
        px.drawImage(selMaskToCanvas(), 0, 0); px.restore();
        px.drawImage(masked, 0, 0);
        l.canvas = prev;
        composite();
        drawAnts();
        l.canvas = keep;
      }

      function strokeAt(l, from, to) {
        const ctx = (strokeScratch ? strokeScratch.ctx : l.ctx);
        const pressure = ($('pb-pressure').checked && to.p) ? (0.35 + to.p * 0.65) : 1;
        const size = toolSize() * pressure;
        const alpha = toolAlpha();
        const hard = hardness();
        const shape = brushShape();
        const col = toolColor();

        switch (tool) {
          case 'eraser':
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            brushStamp(ctx, to.x, to.y, size, '#000', hard, shape, alpha);
            ctx.restore();
            break;

          case 'pencil': {
            // Hard-edged, no feathering, no build-up — like a pixel pencil.
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.fillStyle = col;
            const r = Math.max(1, size / 2);
            ctx.beginPath(); ctx.arc(to.x, to.y, r, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            break;
          }

          case 'marker':
            // Translucent ink that builds where strokes overlap.
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            brushStamp(ctx, to.x, to.y, size, col, Math.min(hard, 0.9), shape, alpha * 0.5);
            ctx.restore();
            break;

          case 'airbrush': {
            // Soft, low-opacity build-up — many faint stamps.
            ctx.save();
            brushStamp(ctx, to.x, to.y, size, col, 0.02, 'round', alpha * 0.12);
            ctx.restore();
            break;
          }

          case 'calligraphy': {
            // A flat nib: width depends on stroke direction.
            const ang = Math.atan2(to.y - from.y, to.x - from.x);
            const nib = THREEangle(); // nib angle in radians (from slider)
            const w = Math.max(1, size * Math.abs(Math.sin(ang - nib)) + size * 0.12);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.lineCap = 'butt';
            ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
            ctx.restore();
            break;
          }

          case 'spray': {
            // Random stipple within the brush radius.
            const r = size / 2;
            const n = Math.max(4, Math.round(r * 0.9));
            ctx.save();
            ctx.fillStyle = col;
            for (let i = 0; i < n; i++) {
              const a = Math.random() * Math.PI * 2;
              const d = Math.sqrt(Math.random()) * r;
              ctx.globalAlpha = alpha * (0.25 + Math.random() * 0.5);
              ctx.beginPath();
              ctx.arc(to.x + Math.cos(a) * d, to.y + Math.sin(a) * d, Math.max(0.5, size * 0.03), 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
            break;
          }

          case 'smudge': {
            const s = Math.max(2, Math.floor(size));
            const sx = Math.floor(from.x - s / 2), sy = Math.floor(from.y - s / 2);
            if (sx >= 0 && sy >= 0 && sx + s <= W && sy + s <= H) {
              const patch = ctx.getImageData(sx, sy, s, s);
              ctx.save(); ctx.globalAlpha = 0.5 * alpha;
              ctx.putImageData(patch, Math.floor(to.x - s / 2), Math.floor(to.y - s / 2));
              ctx.restore();
            }
            break;
          }

          case 'blurbrush':
            // Local box blur weighted by the brush falloff.
            patchOp(ctx, to.x, to.y, size, (img, w, h, bx, by, r) => {
              const src = new Uint8ClampedArray(img.data);
              const at = (x, y, c) => src[((y * w) + x) * 4 + c];
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const wgt = falloff(x - bx, y - by, r, hard) * alpha;
                if (wgt <= 0) continue;
                for (let c = 0; c < 4; c++) {
                  let sum = 0, n = 0;
                  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    sum += at(nx, ny, c); n++;
                  }
                  const i = ((y * w) + x) * 4 + c;
                  img.data[i] = src[i] + (sum / n - src[i]) * wgt;
                }
              }
            });
            break;

          case 'dodge':
          case 'burn': {
            const up = tool === 'dodge';
            patchOp(ctx, to.x, to.y, size, (img, w, h, bx, by, r) => {
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const wgt = falloff(x - bx, y - by, r, hard) * alpha * 0.28;
                if (wgt <= 0) continue;
                const i = ((y * w) + x) * 4;
                if (img.data[i + 3] === 0) continue;
                for (let c = 0; c < 3; c++) {
                  const v = img.data[i + c];
                  img.data[i + c] = up ? v + (255 - v) * wgt : v * (1 - wgt);
                }
              }
            });
            break;
          }

          case 'clone': {
            if (!cloneSrc) return;
            if (!cloneOffset) cloneOffset = { x: cloneSrc.x - to.x, y: cloneSrc.y - to.y };
            const s = Math.max(2, Math.ceil(size));
            const sx = Math.round(to.x + cloneOffset.x - s / 2), sy = Math.round(to.y + cloneOffset.y - s / 2);
            if (sx < 0 || sy < 0 || sx + s > W || sy + s > H) return;
            // Sample a clean flatten (not the on-screen canvas, which also carries
            // marching ants and vector handles) so clones never pick up overlays.
            const tmp = document.createElement('canvas'); tmp.width = s; tmp.height = s;
            tmp.getContext('2d').drawImage(flatten(), sx, sy, s, s, 0, 0, s, s);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(to.x, to.y, s / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(tmp, Math.round(to.x - s / 2), Math.round(to.y - s / 2));
            ctx.restore();
            break;
          }

          default:   // brush
            brushStamp(ctx, to.x, to.y, size, col, hard, shape, alpha);
        }
      }
      // nib angle for the calligraphy tool, in radians
      function THREEangle() { const e = $('ps-nib'); return ((parseInt(e ? e.value : 45) || 45) * Math.PI) / 180; }

      function drawPreview() {
        composite();
        if (!previewShape) return;
        const s = previewShape;
        vctx.save();
        vctx.strokeStyle = s.stroke; vctx.lineWidth = s.width;
        vctx.fillStyle = s.fill || 'transparent';
        vctx.lineCap = 'round'; vctx.lineJoin = 'round';
        vctx.beginPath();
        shapePath(vctx, s);
        if (s.fill && s.fill !== 'transparent') vctx.fill();
        vctx.stroke();
        vctx.restore();
      }

      function onMove(e) {
        const l = active(); if (!l) return;
        // While actively dragging on touch/pen, keep the browser's own gesture from
        // fighting ours — the cause of the touch-only shape dodge.
        if (drawing && e.pointerType !== 'mouse' && e.cancelable) e.preventDefault();
        const p = pos(e);
        // keep the ring under the pointer; repaint only when idle so strokes stay fast
        if (RING_TOOLS.test(tool)) {
          cursorPos = p;
          if (!drawing) composite();
        }

        // --- selection gestures ---
        if (tool === 'puppet' && puppet && drawing && puppet.drag != null) {
          const pin = puppet.pins[puppet.drag];
          if (pin) { pin.x = p.x; pin.y = p.y; puppetPreview(); }
          return;
        }
        if (drawing && selDrag && /^(selrect|seloval|lasso)$/.test(tool)) {
          // Shift (or the Lock ratio toggle) keeps the selection box even — a perfect
          // square for Rectangle select, a circle for Oval select. Lasso is freehand
          // so it's unaffected. Constrain the point first so the marquee preview and
          // the committed selection always agree.
          let sp = p;
          if (tool !== 'lasso' && ((e && e.shiftKey) || aspectLock)) {
            const dx = p.x - selDrag.x0, dy = p.y - selDrag.y0;
            const s = Math.max(Math.abs(dx), Math.abs(dy));
            sp = { x: selDrag.x0 + Math.sign(dx || 1) * s, y: selDrag.y0 + Math.sign(dy || 1) * s, p: p.p };
          }
          selDrag.x1 = sp.x; selDrag.y1 = sp.y;
          if (tool === 'lasso') selDrag.pts.push({ x: sp.x, y: sp.y });
          composite();
          vctx.save();
          vctx.strokeStyle = '#5dd6ff'; vctx.lineWidth = 1 / zoom;
          vctx.setLineDash([4 / zoom, 3 / zoom]);
          vctx.beginPath();
          if (tool === 'selrect') vctx.rect(Math.min(selDrag.x0, sp.x), Math.min(selDrag.y0, sp.y), Math.abs(sp.x - selDrag.x0), Math.abs(sp.y - selDrag.y0));
          else if (tool === 'seloval') vctx.ellipse((selDrag.x0 + sp.x) / 2, (selDrag.y0 + sp.y) / 2, Math.abs(sp.x - selDrag.x0) / 2, Math.abs(sp.y - selDrag.y0) / 2, 0, 0, Math.PI * 2);
          else { const q = selDrag.pts; vctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < q.length; i++) vctx.lineTo(q[i].x, q[i].y); }
          vctx.stroke(); vctx.restore();
          return;
        }
        if (drawing && textDrag && liveText) {
          liveText.x = p.x - textDrag.dx;
          liveText.y = p.y - textDrag.dy;
          composite();
          return;
        }
        if (drawing && selMoveState && tool === 'selmove' && floatSel) {
          floatSel.x = selMoveState.ox + (p.x - selMoveState.start.x);
          floatSel.y = selMoveState.oy + (p.y - selMoveState.start.y);
          syncFloatMask();
          composite();
          return;
        }

        if (tool === 'vedit') {
          if (drawing && vSel) {
            const s = l.shapes[vSel.shapeIndex];
            if (!s) return;
            if (vSel.mode === 'handle') setHandle(s, vSel.handleIndex, p.x, p.y);
            else {
              // drag the whole shape by the offset since grab
              const dx = p.x - vSel.grab.x, dy = p.y - vSel.grab.y;
              const o = vSel.orig;
              if (s.type === 'path') s.pts.forEach((pt, i) => { pt.x = o.pts[i].x + dx; pt.y = o.pts[i].y + dy; });
              else { s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; s.x2 = o.x2 + dx; s.y2 = o.y2 + dy; }
            }
            renderVector(l); composite();
          } else {
            const h = hitHandle(l, p);
            const changed = JSON.stringify(h) !== JSON.stringify(vHover);
            vHover = h;
            view.style.cursor = h ? 'grab' : (hitShape(l, p) >= 0 ? 'move' : 'default');
            if (changed) { composite(); }
          }
          return;
        }

        if (tool === 'pen' && penPts.length) {
          const pe = (penPts.length && vSnapEnabled) ? snapAngle(penPts[penPts.length-1], p, 'line') : p;
          previewShape = { type:'path', pts: penPts.concat([{x:pe.x,y:pe.y}]), stroke: toolColor(), width: toolSize(), strokeOn:true, fill:'transparent' };
          drawPreview(); return;
        }
        if (!drawing) return;

        if (tool === 'transform' && drawing && xform && xform.grab) {
          const g = xform.grab;
          if (xform.mode === 'move') {
            xform.cx = g.cx + (p.x - g.p.x);
            xform.cy = g.cy + (p.y - g.p.y);
          } else if (xform.mode === 'rotate') {
            const now = Math.atan2(p.y - xform.cy, p.x - xform.cx);
            xform.angle = g.angle + (now - g.ang0);
          } else if (xform.mode === 'scale') {
            // distance from centre along the box's local axes, relative to grab
            const ca=Math.cos(-g.angle), sa=Math.sin(-g.angle);
            const toLocal = (px,py)=>{ const dx=px-xform.cx, dy=py-xform.cy; return { x:dx*ca-dy*sa, y:dx*sa+dy*ca }; };
            const gl = toLocal(g.p.x, g.p.y), nl = toLocal(p.x, p.y);
            let nsx = g.sx * (Math.abs(nl.x) / (Math.abs(gl.x)||1));
            let nsy = g.sy * (Math.abs(nl.y) / (Math.abs(gl.y)||1));
            if ($('pt-keep-aspect') && $('pt-keep-aspect').checked) { const s=Math.max(nsx,nsy); nsx=nsy=s; }
            xform.sx = Math.max(0.02, nsx); xform.sy = Math.max(0.02, nsy);
          }
          composite(); return;
        }
        if (tool === 'move' && moveStart && moveSnapshot) {
          const dx = Math.round(p.x - moveStart.x), dy = Math.round(p.y - moveStart.y);
          l.ctx.setTransform(1,0,0,1,0,0);
          l.ctx.clearRect(0,0,W,H);
          l.ctx.putImageData(moveSnapshot, dx, dy);
          composite(); return;
        }
        if (tool === 'gradient' && gradStart) {
          composite();
          vctx.save();
          const g = makeGradient(vctx, gradStart.x, gradStart.y, p.x, p.y);
          vctx.fillStyle = g; vctx.fillRect(0, 0, W, H);
          vctx.strokeStyle = 'rgba(255,255,255,.85)'; vctx.lineWidth = 1;
          vctx.beginPath(); vctx.moveTo(gradStart.x, gradStart.y); vctx.lineTo(p.x, p.y); vctx.stroke();
          vctx.restore();
          return;
        }
        if (DRAG_SHAPES.test(tool)) {
          const e2 = snapAngle(shapeStart, p, tool, e && e.shiftKey);
          previewShape = {
            type: tool, x1: shapeStart.x, y1: shapeStart.y, x2: e2.x, y2: e2.y,
            sides: parseInt($('ps-sides') ? $('ps-sides').value : 5) || 5,
            points: parseInt($('ps-sides') ? $('ps-sides').value : 5) || 5,
            stroke: toolColor(), width: toolSize(),
            fill: ($('ps-vfill') && $('ps-vfill').checked) ? toolColor() : 'transparent',
            strokeOn: ($('ps-vstroke') && $('ps-vstroke').checked)
          };
          drawPreview(); return;
        }

        // brush-family: interpolate along the segment for a smooth line
        const dx = p.x - last.x, dy = p.y - last.y;
        const seg = Math.hypot(dx, dy);
        const step = spacing();
        if (seg < step) return;
        const n = Math.floor(seg / step);
        for (let i = 1; i <= n; i++) {
          const t = (step * i) / seg;
          const q = { x: last.x + dx * t, y: last.y + dy * t, p: p.p };
          strokeAt(l, last, q);
        }
        last = { x: last.x + dx * ((step*n)/seg), y: last.y + dy * ((step*n)/seg), p: p.p };
        compositeStrokeSoon(l);
      }

      // Pointer events can arrive several times per frame (pen/high-rate mice), and
      // compositing re-draws every layer at full canvas size. The stroke itself is
      // still painted for every event; only the on-screen redraw is coalesced to
      // once per animation frame. onUp flushes it so the final segment always shows.
      let _strokeRaf = 0, _strokeLayer = null;
      function compositeStrokeSoon(l) {
        _strokeLayer = l;
        if (_strokeRaf) return;
        _strokeRaf = requestAnimationFrame(() => {
          _strokeRaf = 0;
          const sl = _strokeLayer; _strokeLayer = null;
          if (drawing && sl) compositeStroke(sl);
        });
      }

      function onUp(e) {
        if (tool === 'puppet' && puppet) { puppet.drag = null; drawing = false; composite(); return; }
        let l = active();          // may be swapped for a fresh vector layer below
        if (!l) return;

        // --- finish a selection gesture ---
        if (selDrag && /^(selrect|seloval|lasso)$/.test(tool)) {
          const d = selDrag; selDrag = null; drawing = false;
          const tiny = Math.abs(d.x1 - d.x0) < 2 && Math.abs(d.y1 - d.y0) < 2;
          if (tiny && tool !== 'lasso') { clearSelection(); banner('Selection cleared.'); return; }
          const m = maskFromDraw(x => {
            x.beginPath();
            if (tool === 'selrect') x.rect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
            else if (tool === 'seloval') x.ellipse((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, Math.abs(d.x1 - d.x0) / 2, Math.abs(d.y1 - d.y0) / 2, 0, 0, Math.PI * 2);
            else { const q = d.pts; if (q.length < 3) return; x.moveTo(q[0].x, q[0].y); for (let i = 1; i < q.length; i++) x.lineTo(q[i].x, q[i].y); x.closePath(); }
            x.fill();
          });
          selFromMask(m);
          composite();
          banner(sel ? 'Selected — painting is limited to this area.' : 'Selection cleared.');
          return;
        }
        if (textDrag) { textDrag = null; drawing = false; return; }
        if (selMoveState && tool === 'selmove') {
          selMoveState = null; drawing = false;
          // NOTE: the float deliberately stays lifted so it can be dragged again.
          // It's committed by dropSelection() on deselect / tool change / edit.
          pushHistory(); renderLayerList(); composite();
          return;
        }

        if (tool === 'vedit') {
          if (drawing && vSel) { pushHistory(); renderLayerList(); }
          drawing = false;
          if (vSel) vSel.mode = null;
          composite();
          return;
        }
        if (tool === 'gradient' && gradStart && drawing) {
          const p = pos(e);
          const g = makeGradient(l.ctx, gradStart.x, gradStart.y, p.x, p.y);
          l.ctx.save();
          l.ctx.globalAlpha = toolAlpha() / Math.max(0.001, fg.a);
          l.ctx.fillStyle = g; l.ctx.fillRect(0, 0, W, H);
          l.ctx.restore();
          gradStart = null; drawing = false;
          composite(); pushHistory(); renderLayerList();
          return;
        }
        if (DRAG_SHAPES.test(tool)) {
          if (previewShape && drawing) {
            l = layerForShape() || l;
            if (l.kind === 'vector') { l.shapes.push(previewShape); renderVector(l); }
            else { // stamp into pixels
              const c = l.ctx;
              c.save(); c.strokeStyle = previewShape.stroke; c.fillStyle = previewShape.fill;
              c.lineWidth = previewShape.width; c.lineCap='round'; c.lineJoin='round';
              c.beginPath();
              const s = previewShape;
              shapePath(c, s);   // same builder as the preview and vector render
              if (s.fill && s.fill!=='transparent') c.fill();
              if (s.strokeOn) c.stroke();
              c.restore();
            }
            previewShape = null; composite(); pushHistory(); renderLayerList();
          }
          drawing = false; shapeStart = null; return;
        }
        if (_strokeRaf) { cancelAnimationFrame(_strokeRaf); _strokeRaf = 0; _strokeLayer = null; composite(); }
        if (drawing && strokeScratch) { endStroke(l); composite(); }
        if (drawing && tool !== 'pen') { pushHistory(); renderLayerList(); }
        drawing = false; last = null; moveStart = null; moveSnapshot = null;
        cloneOffset = null;   // next clone stroke re-anchors from the source point
      }

      function finishPen() {
        let l = active();          // may be swapped for a fresh vector layer below
        if (!l || penPts.length < 2) { penPts = []; previewShape = null; composite(); return; }
        const shape = { type:'path', pts: penPts.slice(), stroke: toolColor(), width: toolSize(),
          strokeOn: ($('ps-vstroke') && $('ps-vstroke').checked), fill: ($('ps-vfill') && $('ps-vfill').checked) ? toolColor() : 'transparent', closed: ($('ps-vfill') && $('ps-vfill').checked) };
        l = layerForShape() || l;
        if (l.kind === 'vector') { l.shapes.push(shape); renderVector(l); }
        else {
          const c = l.ctx; c.save();
          c.strokeStyle = shape.stroke; c.fillStyle = shape.fill; c.lineWidth = shape.width;
          c.lineCap='round'; c.lineJoin='round'; c.beginPath();
          c.moveTo(shape.pts[0].x, shape.pts[0].y);
          for (let i=1;i<shape.pts.length;i++) c.lineTo(shape.pts[i].x, shape.pts[i].y);
          if (shape.closed) c.closePath();
          if (shape.fill!=='transparent') c.fill();
          if (shape.strokeOn) c.stroke();
          c.restore();
        }
        penPts = []; previewShape = null; composite(); pushHistory(); renderLayerList();
      }


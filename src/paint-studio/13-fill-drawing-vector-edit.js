      // ── Flood fill ──────────────────────────────────────────────────────────
      function floodFill(l, sx, sy, hex) {
        sx = Math.floor(sx); sy = Math.floor(sy);
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
        const img = l.ctx.getImageData(0, 0, W, H);
        const d = img.data;
        const idx = (x, y) => (y * W + x) * 4;
        const s = idx(sx, sy);
        const tr = d[s], tg = d[s+1], tb = d[s+2], ta = d[s+3];
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        const fr = parseInt(m[1],16), fg = parseInt(m[2],16), fb = parseInt(m[3],16);
        if (tr===fr && tg===fg && tb===fb && ta===255) return;
        const tol = 32;
        const near = (i) => Math.abs(d[i]-tr)<=tol && Math.abs(d[i+1]-tg)<=tol && Math.abs(d[i+2]-tb)<=tol && Math.abs(d[i+3]-ta)<=tol;
        const stack = [[sx, sy]];
        const seen = new Uint8Array(W * H);
        while (stack.length) {
          const [x, y] = stack.pop();
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const p = y * W + x;
          if (seen[p]) continue;
          const i = p * 4;
          if (!near(i)) continue;
          seen[p] = 1;
          d[i] = fr; d[i+1] = fg; d[i+2] = fb; d[i+3] = 255;
          stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
        }
        l.ctx.putImageData(img, 0, 0);
      }

      // ── Drawing state ───────────────────────────────────────────────────────
      let drawing = false, last = null, dist = 0;
      let shapeStart = null, previewShape = null;
      let vSnapEnabled = false;   // vector angle-snap: lock lines/boxes to 0/45/90°
      let aspectLock = false;     // toggle button; when on (or Shift held) shapes keep
                                  // a locked aspect — squares, circles, 45° lines
      // Shapes drawn by dragging a box (or a line, for arrow)
      const DRAG_SHAPES = /^(line|rect|ellipse|triangle|hexagon|polygon|star|arrow)$/;

      // With angle-snap on, constrain a drag endpoint relative to its start so lines
      // and boxes lock to horizontal, vertical, or 45° diagonals — the same "hold to
      // straighten" behaviour most editors give you, but as a toggle rather than a
      // held key so it works on a touchscreen. Lines snap to 8 directions; boxes and
      // other shapes snap to a square (equal width/height) when near the diagonal,
      // which is what keeps circles round and squares square.
      // `lock` (Shift held or the aspect-lock toggle) forces the constraint on even
      // when angle-snap is off: lines snap to 45° steps, boxes/ellipses become
      // perfect squares/circles.
      function snapAngle(start, end, kind, lock) {
        const forced = lock || aspectLock;
        if (!vSnapEnabled && !forced) return end;
        const dx = end.x - start.x, dy = end.y - start.y;
        if (dx === 0 && dy === 0) return end;
        if (kind === 'line' || kind === 'arrow') {
          const ang = Math.atan2(dy, dx);
          // Increment is user-selectable: 45° gives the 8 cardinals/diagonals,
          // 30° adds the isometric angles, 15° is fine enough for gentle slopes.
          // A hard lock always uses 45° so a held Shift gives clean diagonals.
          const deg = forced ? 45 : (parseInt($('ps-vsnap-step') ? $('ps-vsnap-step').value : 45) || 45);
          const step = (deg * Math.PI) / 180;
          const snapped = Math.round(ang / step) * step;
          const len = Math.hypot(dx, dy);
          return { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len,
                   p: end.p };
        }
        // box-like shapes. With a hard lock, always force a perfect square/circle.
        // Otherwise (angle-snap only) force it just when the drag is already near-square.
        const ax = Math.abs(dx), ay = Math.abs(dy);
        const ratio = Math.min(ax, ay) / (Math.max(ax, ay) || 1);
        if (forced || ratio > 0.8) {
          const s = Math.max(ax, ay);
          return { x: start.x + Math.sign(dx || 1) * s, y: start.y + Math.sign(dy || 1) * s,
                   p: end.p };
        }
        return end;
      }
      let penPts = [];
      let moveStart = null, moveSnapshot = null;
      let cloneSrc = null, cloneOffset = null;   // clone stamp source point + offset
      let cloneArmed = false;                    // next tap sets the source (touch-friendly)
      let gradStart = null;
      let vSel = null;      // {shapeIndex, handleIndex} currently grabbed
      let vHover = null;

      // ── Vector editing ──────────────────────────────────────────────────────
      // Every shape exposes a list of draggable handles. For rect/ellipse those are
      // the two defining corners; for lines the endpoints; for pen paths every node.
      // Every corner-box shape is defined by two opposite corners, so they all get
      // the same pair of handles. Previously only line/rect/ellipse were listed, so
      // stars, polygons, triangles, hexagons and arrows had NO handles at all and
      // couldn't be edited or moved once drawn.
      const BOX_SHAPES = /^(line|rect|ellipse|triangle|hexagon|polygon|star|arrow)$/;
      function shapeHandles(s) {
        if (BOX_SHAPES.test(s.type)) {
          return [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
        }
        if (s.type === 'path') return s.pts.map(p => ({ x: p.x, y: p.y }));
        return [];
      }
      function setHandle(s, i, x, y) {
        if (BOX_SHAPES.test(s.type)) {
          if (i === 0) { s.x1 = x; s.y1 = y; } else { s.x2 = x; s.y2 = y; }
        } else if (s.type === 'path' && s.pts[i]) { s.pts[i].x = x; s.pts[i].y = y; }
      }
      // Find the handle nearest the pointer, within a zoom-aware grab radius.
      function hitHandle(l, p) {
        const r = 9 / zoom;
        for (let si = l.shapes.length - 1; si >= 0; si--) {
          const hs = shapeHandles(l.shapes[si]);
          for (let hi = 0; hi < hs.length; hi++) {
            if (Math.hypot(hs[hi].x - p.x, hs[hi].y - p.y) <= r) return { shapeIndex: si, handleIndex: hi };
          }
        }
        return null;
      }
      // Whole-shape hit test (so you can drag a shape by its body).
      function hitShape(l, p) {
        for (let si = l.shapes.length - 1; si >= 0; si--) {
          const s = l.shapes[si];
          const hs = shapeHandles(s);
          if (!hs.length) continue;
          const xs = hs.map(h => h.x), ys = hs.map(h => h.y);
          const pad = Math.max(6, (s.width || 2)) / 2 + 4 / zoom;
          if (p.x >= Math.min(...xs) - pad && p.x <= Math.max(...xs) + pad &&
              p.y >= Math.min(...ys) - pad && p.y <= Math.max(...ys) + pad) return si;
        }
        return -1;
      }
      // Draw the editing overlay on top of the composite.
      function drawVectorHandles() {
        const l = active();
        if (!l || l.kind !== 'vector' || tool !== 'vedit') return;
        vctx.save();
        const r = 4.5 / zoom, lw = 1.4 / zoom;
        l.shapes.forEach((s, si) => {
          const hs = shapeHandles(s);
          // outline the shape's extent faintly
          if (hs.length > 1) {
            const xs = hs.map(h => h.x), ys = hs.map(h => h.y);
            vctx.strokeStyle = 'rgba(93,214,255,.45)'; vctx.lineWidth = lw;
            vctx.setLineDash([4 / zoom, 4 / zoom]);
            vctx.strokeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
            vctx.setLineDash([]);
          }
          hs.forEach((h, hi) => {
            const on = vSel && vSel.shapeIndex === si && vSel.handleIndex === hi;
            const hov = vHover && vHover.shapeIndex === si && vHover.handleIndex === hi;
            vctx.beginPath(); vctx.arc(h.x, h.y, r * (on || hov ? 1.35 : 1), 0, Math.PI * 2);
            vctx.fillStyle = on ? '#ff7a1a' : '#5dd6ff';
            vctx.fill();
            vctx.lineWidth = lw; vctx.strokeStyle = '#0b0e12'; vctx.stroke();
          });
        });
        vctx.restore();
      }

      // Each tool remembers its own size. A 40px brush and a 2px pencil are both
      // reasonable defaults, and sharing one slider between them means constantly
      // resetting it. Sizes are grouped by what the tool is for, so all the brushes
      // share a size but the eraser and the shape tools keep their own.
      const SIZE_GROUP = {
        brush:'paint', pencil:'pencil', marker:'paint', airbrush:'paint',
        calligraphy:'paint', spray:'paint',
        eraser:'eraser',
        smudge:'retouch', blurbrush:'retouch', dodge:'retouch', burn:'retouch', clone:'retouch',
        rect:'shape', ellipse:'shape', line:'shape', pen:'shape',
        polygon:'shape', star:'shape', arrow:'shape', triangle:'shape', hexagon:'shape'
      };
      const sizeFor = (t) => SIZE_GROUP[t] || 'paint';
      const toolSizes = { paint: 12, pencil: 3, eraser: 30, retouch: 24, shape: 4 };
      function toolSize() { return toolSizes[sizeFor(tool)] || 12; }
      // Push the active tool's stored size into the slider (and vice versa).
      function syncSizeUI() {
        const s = $('ps-size'); if (!s) return;
        s.value = toolSize();
        const v = $('ps-size-val'); if (v) v.textContent = s.value;
      }
      function toolAlpha() { return ((parseInt($('ps-flow').value) || 100) / 100) * fg.a; }
      function toolColor() { return toHex(fg); }
      function hardness() { const e = $('ps-hard'); return (parseInt(e ? e.value : 80) || 80) / 100; }
      function spacing() { return Math.max(1, (parseInt($('pb-space').value) || 12) / 100 * toolSize()); }
      // Only the directional tips have a meaningful angle; hide the slider otherwise
      // so the panel doesn't offer a control that does nothing.
      const ANGLED_TIPS = /^(flat|oval|diamond|bristle|grass)$/;
      function syncTipUI() {
        const row = $('pb-angle-row');
        if (row) row.style.display = ANGLED_TIPS.test(brushShape()) ? '' : 'none';
        drawTipPreviews();
      }

      // Paint a miniature of each tip onto its own button, using that tip's real
      // stamp code — so the swatch can't drift out of step with what it draws.
      function drawTipPreviews() {
        document.querySelectorAll('#pb-shape .tip-btn').forEach(btn => {
          const shape = btn.dataset.shape;
          let cv = btn.querySelector('canvas');
          if (!cv) { cv = document.createElement('canvas'); btn.insertBefore(cv, btn.firstChild); }
          const S = 44;
          cv.width = S; cv.height = S;
          const c = cv.getContext('2d');
          c.clearRect(0, 0, S, S);
          try {
            // a short diagonal drag, so directional tips show their character
            const n = 7;
            for (let i = 0; i < n; i++) {
              const t = i / (n - 1);
              brushStamp(c, 10 + t * 24, 30 - t * 16, 13, '#e8e4dd', 0.65, shape, 0.5);
            }
          } catch (e) { /* preview is cosmetic */ }
        });
      }

      // Called for every brush stamp, so remember the active tip button: selecting a tip
      // clears 'active' everywhere first, so a cached button that is still connected and
      // still active is by definition the one — the DOM query only reruns after a change.
      let _shapeBtn = null;
      function brushShape() {
        if (!_shapeBtn || !_shapeBtn.isConnected || !_shapeBtn.classList.contains('active')) {
          _shapeBtn = document.querySelector('#pb-shape .tip-btn.active, #pb-custom-tips .tip-btn.active');
        }
        return _shapeBtn ? _shapeBtn.dataset.shape : 'round';
      }


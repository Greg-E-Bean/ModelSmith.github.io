      // ── Selection ───────────────────────────────────────────────────────────
      // A selection is a 1-channel mask the size of the canvas. Painting is clipped
      // to it, and it can be moved/cut. `selPath` keeps a vector outline where we
      // have one (rect/oval/lasso) purely for drawing the marching-ants overlay.
      let sel = null;            // Uint8Array (W*H) or null = no selection
      let selBounds = null;      // {x0,y0,x1,y1}
      let selDrag = null;        // in-progress selection gesture
      let selAnts = 0;           // marching-ants phase
      let selMoveState = null;

      function clearSelection() {
        if (floatSel) dropSelection(false);
        sel = null; selBounds = null; composite();
      }

      function selFromMask(mask) {
        let x0 = W, y0 = H, x1 = -1, y1 = -1, any = false;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (mask[y * W + x]) { any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (!any) { sel = null; selBounds = null; return; }
        sel = mask; selBounds = { x0, y0, x1, y1 };
      }

      // Rasterise a shape into a selection mask via an offscreen canvas.
      function maskFromDraw(drawFn) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; drawFn(x);
        const d = x.getImageData(0, 0, W, H).data;
        const m = new Uint8Array(W * H);
        for (let i = 0, p = 0; i < d.length; i += 4, p++) if (d[i + 3] > 127) m[p] = 1;
        return m;
      }

      // Magic select: choose pixels close in colour to the one clicked.
      //   similarity  0%  = only a near-exact colour match
      //             100%  = everything (the whole canvas)
      // "Global" matches anywhere on the canvas rather than only the touching
      // region, and "Invert" selects everything except the match — handy for
      // grabbing a subject by clicking its background.
      // Samples a CLEAN flatten, never the on-screen canvas, which also carries
      // overlay graphics (ants, handles) that would corrupt the match.
      function magicSelect(sx, sy) {
        sx = Math.floor(sx); sy = Math.floor(sy);
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
        const pct = parseInt($('ps-tol') ? $('ps-tol').value : 25) || 0;
        const invert = $('ps-invert') && $('ps-invert').checked;
        const global = $('ps-global') && $('ps-global').checked;
        // Map 0-100% onto colour distance. A linear map saturates almost at once
        // (everything within ~30% matches), so the top of the slider would do
        // nothing; squaring it keeps the low end fine-grained — where the useful
        // work happens on gradients — while still reaching "select everything".
        const maxDist = Math.sqrt(4 * 255 * 255);
        const limit = Math.pow(pct / 100, 2) * maxDist;

        const d = flatten().getContext('2d').getImageData(0, 0, W, H).data;
        const s = (sy * W + sx) * 4;
        const tr = d[s], tg = d[s + 1], tb = d[s + 2], ta = d[s + 3];
        const close = (i) => {
          const dr = d[i] - tr, dg = d[i + 1] - tg, db = d[i + 2] - tb, da = d[i + 3] - ta;
          return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= limit;
        };

        const m = new Uint8Array(W * H);
        if (global) {
          for (let p = 0; p < W * H; p++) if (close(p * 4)) m[p] = 1;
        } else {
          const stack = [[sx, sy]];
          while (stack.length) {
            const [x, y] = stack.pop();
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const p = y * W + x;
            if (m[p]) continue;
            if (!close(p * 4)) continue;
            m[p] = 1;
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
          }
        }
        if (invert) for (let p = 0; p < m.length; p++) m[p] = m[p] ? 0 : 1;
        selFromMask(m);
      }

      // Flip the current selection inside-out.
      function invertSelection() {
        if (floatSel) dropSelection();
        if (!sel) { selFromMask(new Uint8Array(W * H).fill(1)); composite(); return; }
        const m = new Uint8Array(W * H);
        for (let p = 0; p < sel.length; p++) m[p] = sel[p] ? 0 : 1;
        selFromMask(m); composite();
      }

      // Build a canvas holding the selection as an alpha mask, for clipping.
      let selMaskCanvas = null;
      function selMaskToCanvas() {
        if (!sel) return null;
        if (selMaskCanvas && selMaskCanvas._for === sel) return selMaskCanvas;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        const img = x.createImageData(W, H);
        for (let p = 0; p < sel.length; p++) { if (sel[p]) { const i = p * 4; img.data[i] = 255; img.data[i+1] = 255; img.data[i+2] = 255; img.data[i+3] = 255; } }
        x.putImageData(img, 0, 0);
        c._for = sel; selMaskCanvas = c;
        return c;
      }

      // Apply a drawing operation restricted to the selection: draw into a scratch
      // canvas, mask it, then blit onto the layer.
      function withSelection(l, fn) {
        if (!sel) { fn(l.ctx); return; }
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d', { willReadFrequently: true });
        fn(x);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(selMaskToCanvas(), 0, 0);
        l.ctx.drawImage(c, 0, 0);
      }

      // Marching ants outline, drawn from the mask's edge pixels.
      // A quiet, slowly-crawling dotted outline. Deliberately soft: one thin line
      // that drifts a few pixels a second, rather than a hard black/white strobe.
      function drawAnts() {
        if (!sel || !selBounds) return;
        vctx.save();
        const px = 1 / zoom;                 // keep the line hairline at any zoom
        vctx.lineWidth = 1.25 * px;
        vctx.setLineDash([3 * px, 4 * px]);  // dotted, with clear gaps
        vctx.lineDashOffset = -selAnts * px;
        vctx.lineCap = 'round';
        const edges = [];
        const { x0, y0, x1, y1 } = selBounds;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const p = y * W + x;
          if (!sel[p]) continue;
          if (!x || !sel[p - 1]) edges.push([x, y, x, y + 1]);
          if (x === W - 1 || !sel[p + 1]) edges.push([x + 1, y, x + 1, y + 1]);
          if (!y || !sel[p - W]) edges.push([x, y, x + 1, y]);
          if (y === H - 1 || !sel[p + W]) edges.push([x, y + 1, x + 1, y + 1]);
        }
        vctx.beginPath();
        edges.forEach(([a, b, c2, d2]) => { vctx.moveTo(a, b); vctx.lineTo(c2, d2); });
        // a soft dark halo underneath keeps the dots readable on light artwork,
        // without the hard alternating flash of a classic two-tone marquee
        vctx.strokeStyle = 'rgba(0,0,0,.45)';
        vctx.lineWidth = 2.5 * px;
        vctx.setLineDash([]);
        vctx.globalAlpha = 0.35;
        vctx.stroke();
        vctx.globalAlpha = 1;
        vctx.setLineDash([3 * px, 4 * px]);
        vctx.lineDashOffset = -selAnts * px;
        vctx.lineWidth = 1.25 * px;
        vctx.strokeStyle = 'rgba(255,255,255,.95)';
        vctx.stroke();
        vctx.restore();
      }

      // Which HUD groups each tool needs. The bottom bar shows only these, so it
      // always reflects the settings that actually apply to the current tool.
      const HUD_FOR = {
        brush:       ['colour','size','flow','hard','zoom'],
        pencil:      ['colour','size','flow','zoom'],
        marker:      ['colour','size','flow','hard','zoom'],
        airbrush:    ['colour','size','flow','zoom'],
        calligraphy: ['colour','size','flow','nib','zoom'],
        spray:       ['colour','size','flow','zoom'],
        eraser:      ['size','flow','hard','zoom'],
        smudge:      ['size','flow','zoom'],
        blurbrush:   ['size','flow','hard','zoom'],
        dodge:       ['size','flow','hard','zoom'],
        burn:        ['size','flow','hard','zoom'],
        clone:       ['size','flow','clonesrc','zoom'],
        triangle:    ['colour','size','vecfill','ratio','zoom'],
        hexagon:     ['colour','size','vecfill','ratio','zoom'],
        polygon:     ['colour','size','sides','vecfill','ratio','zoom'],
        star:        ['colour','size','sides','vecfill','ratio','zoom'],
        arrow:       ['colour','size','vecfill','ratio','zoom'],
        fill:        ['colour','tol','zoom'],
        gradient:    ['colour','flow','grad','zoom'],
        picker:      ['colour','zoom'],
        rect:        ['colour','size','vecfill','ratio','zoom'],
        ellipse:     ['colour','size','vecfill','ratio','zoom'],
        line:        ['colour','size','vecfill','ratio','zoom'],
        pen:         ['colour','size','vecfill','zoom'],
        vedit:       ['zoom'],
        text:        ['colour','text','warp','zoom'],
        move:        ['zoom'],
        puppet:      ['zoom'],
        selrect:     ['selops','ratio','zoom'],
        seloval:     ['selops','ratio','zoom'],
        lasso:       ['selops','zoom'],
        magic:       ['tol','selops','zoom'],
        selmove:     ['selops','zoom']
      };
      // Which contextual settings block belongs to each tool. Mirrors the tool
      // families so the Tool tab shows brush settings for brushes, shape settings
      // for shapes, and so on.
      const TOOL_CTX = {
        brush:'brush', pencil:'brush', marker:'brush', airbrush:'brush', calligraphy:'brush',
        spray:'brush', eraser:'brush', smudge:'brush', blurbrush:'brush', clone:'brush',
        dodge:'brush', burn:'brush',
        line:'shape', rect:'shape', ellipse:'shape', triangle:'shape', hexagon:'shape',
        polygon:'shape', star:'shape', arrow:'shape', pen:'shape', vedit:'shape',
        text:'text',
        selrect:'select', seloval:'select', lasso:'select', magic:'select', selmove:'select',
        transform:'transform',
        fill:'none', gradient:'none', picker:'none', move:'none'
      };
      const CTX_LABEL = { brush:'Brush', shape:'Shape', text:'Text', select:'Selection', transform:'Transform', none:'Tool' };

      function syncToolContext(t) {
        const ctx = TOOL_CTX[t] || 'none';
        document.querySelectorAll('#psec-tool .tool-ctx').forEach(el => {
          el.style.display = el.dataset.ctx === ctx ? '' : 'none';
        });
        const name = $('tool-ctx-name');
        if (name) name.textContent = CTX_LABEL[ctx] || 'Tool';
        // mirror the polygon/star sides control both ways
        if (ctx === 'shape' && $('pb-sides-mirror') && $('ps-sides')) {
          $('pb-sides-mirror').value = $('ps-sides').value;
          if ($('pb-sides-val')) $('pb-sides-val').textContent = $('ps-sides').value;
        }
        // Bring the Tool tab forward when the picked tool actually has settings to
        // show (brush/shape/text), echoing how the 3D sketch tab appears on demand.
        // Tools with nothing extra (fill, picker, move) don't yank the panel around,
        // and we never override the Layers/Image/Files tab if the user is sitting
        // there on purpose AND the tool has no settings.
        if (_wired && (ctx === 'brush' || ctx === 'shape' || ctx === 'text')) {
          showPaintTab('tool');
        }
      }

      // Switch the paint sidebar to a given tab. Extracted so picking a tool can
      // bring its settings forward automatically, the way selecting Sketch on the
      // 3D side reveals the sketch tab.
      function showPaintTab(t) {
        document.querySelectorAll('#paint-tabs button[data-ptab]').forEach(x =>
          x.classList.toggle('active', x.dataset.ptab === t));
        const btn = document.querySelector('#paint-tabs button[data-ptab="' + t + '"]');
        if (btn && $('paint-panel-title')) $('paint-panel-title').textContent = btn.textContent;
        ['layers','colour','tool','image','files'].forEach(k => {   // 'files' still hidden//shown so its controls keep working
          const el = $('psec-' + k); if (el) el.style.display = (k === t) ? '' : 'none';
        });
        // The History and Swatches docks belong with Layers, so they follow it
        // rather than being hidden behind their own tab.
        document.querySelectorAll('[data-ptab-keep]').forEach(el => {
          el.style.display = (el.dataset.ptabKeep === t) ? '' : 'none';
        });
      }
      // Remember the last tab the user chose by hand, so we don't yank them to Tool
      // if they're deliberately sitting on Layers while trying tools.
      let _userPickedTab = 'layers';
      let _wired = false;


      function syncHud() {
        const want = HUD_FOR[tool] || ['zoom'];
        document.querySelectorAll('#paint-hud .hud-group').forEach(g => {
          g.style.display = want.includes(g.dataset.for) ? '' : 'none';
        });
      }


      // ── Text ────────────────────────────────────────────────────────────────
      // Draws with the same fonts as the 3D side. three.js typeface JSON stores each
      // glyph as an SVG-ish command string ("m/l/q/b/z", endpoint-first for curves)
      // in font units; we walk that directly onto a Path2D, so no three.js needed.
      let textPlace = null;   // { x, y, str } while typing
      let lastMagic = null;   // last magic-select click, so settings can re-run it

      // Walk a three.js typeface glyph outline onto a Path2D.
      //
      // Two things matter here, both easy to get wrong:
      //  1. Curve commands are ENDPOINT-FIRST — 'q endX endY ctrlX ctrlY' and
      //     'b endX endY c1X c1Y c2X c2Y' — not controls-first as you'd expect.
      //  2. The Y axis is ALREADY flipped in the stored data (opentypeToThreeFont
      //     negates it at conversion time, because font units are Y-up and canvas
      //     is Y-down). Negating again here would flip it back AND leave each
      //     curve's controls mismatched with its endpoints — which shattered every
      //     round letter (e, o, s, a) while straight ones (T, l, i) looked fine.
      function glyphPath(glyph, upm, size) {
        const p = new Path2D();
        if (!glyph || !glyph.o) return p;
        const t = glyph.o.split(/\s+/);
        const k = size / upm;
        let i = 0;
        const n = () => parseFloat(t[i++]) * k;
        while (i < t.length) {
          const c = t[i++];
          if (c === 'm') { const x = n(), y = n(); p.moveTo(x, y); }
          else if (c === 'l') { const x = n(), y = n(); p.lineTo(x, y); }
          else if (c === 'q') {           // q endX endY ctrlX ctrlY
            const ex = n(), ey = n(), cx1 = n(), cy1 = n();
            p.quadraticCurveTo(cx1, cy1, ex, ey);
          } else if (c === 'b') {         // b endX endY c1X c1Y c2X c2Y
            const ex = n(), ey = n(), c1x = n(), c1y = n(), c2x = n(), c2y = n();
            p.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
          } else if (c === 'z') { p.closePath(); }
        }
        return p;
      }

      // Draw a string; returns its measured width so we can centre/preview it.
      // Text warping. Each glyph is positioned along the run as usual, then given an
      // extra transform based on how far along it sits (t, from 0 to 1). Because the
      // transform is applied to the whole glyph rather than its individual points,
      // the outlines stay crisp — no re-tessellation and no broken curves.
      //   arch / arc   — glyphs ride a curve and rotate to follow its tangent
      //   bulge        — scaled taller in the middle, or at the ends for a waist
      //   skew         — a horizontal shear, for an italic or "in motion" look
      //   rise         — a straight diagonal climb
      //   wave         — a sine that runs along the string
      // Roughly half the cap height — where a glyph's visual centre sits above its
      // baseline. Used so symmetric warps grow evenly in both directions.
      const MID_RATIO = 0.35;
      function warpGlyph(ctx, mode, t, amount, size, total) {
        if (!mode || mode === 'none' || !amount) return;
        const c = (t - 0.5) * 2;                    // -1 at the left, +1 at the right
        switch (mode) {
          case 'arch': case 'arc': {
            const depth = size * 1.6 * amount;
            const dir = mode === 'arch' ? -1 : 1;
            ctx.translate(0, dir * depth * (c * c - 1) * -1);
            ctx.rotate(dir * -c * amount * 0.9);
            break;
          }
          // Bulge and waist scale about the glyph's MIDDLE, not its baseline.
          // ctx.scale() works about the current origin, which sits on the baseline,
          // so scaling there only pushed the tops of the letters up and left the
          // bottoms flat. Shifting to the glyph's centre first makes it grow (or
          // pinch) evenly above and below, which is what these effects should do.
          case 'bulge': {
            const s = 1 + (1 - c * c) * amount;
            const mid = -size * MID_RATIO;      // glyph centre, in pre-flip canvas space
            ctx.translate(0, mid); ctx.scale(1, s); ctx.translate(0, -mid);
            break;
          }
          case 'waist': {
            const s = Math.max(0.15, 1 - (1 - c * c) * amount * 0.75);
            const mid = -size * MID_RATIO;
            ctx.translate(0, mid); ctx.scale(1, s); ctx.translate(0, -mid);
            break;
          }
          case 'skew':
            // Shear scaled by size so the lean is obvious at any point size.
            ctx.transform(1, 0, -amount * 0.9, 1, 0, 0);
            break;
          case 'rise':
            ctx.translate(0, -c * size * amount);
            break;
          case 'wave':
            ctx.translate(0, Math.sin(t * Math.PI * 2) * size * 0.55 * amount);
            ctx.rotate(Math.cos(t * Math.PI * 2) * amount * 0.5);
            break;
        }
      }
      function drawText(ctx, data, str, x, y, size, fill, warp, amount) {
        if (!data || !data.glyphs) return 0;
        const upm = data.resolution || 1000;
        let cursor = 0;
        // Total advance is needed up front so each glyph knows how far along it is.
        const total = measureText(data, str, size) || 1;
        ctx.save();
        ctx.fillStyle = fill;
        for (const ch of str) {
          const g = data.glyphs[ch];
          if (!g) { cursor += (upm * 0.4) * (size / upm); continue; }
          if (g.o) {
            ctx.save();
            ctx.translate(x + cursor, y);
            if (warp && warp !== 'none') {
              const adv = (g.ha || upm * 0.5) * (size / upm);
              warpGlyph(ctx, warp, (cursor + adv / 2) / total, amount || 0, size, total);
            }
            // Stored outlines are Y-up (font convention, as three.js expects); the
            // canvas is Y-down, so the axis is flipped once here at draw time.
            // This is a context transform, so it mirrors the finished path and
            // cannot distort it. Note the distinction: negating Y per-coordinate
            // INSIDE glyphPath would desynchronise each curve's controls from its
            // endpoints and shatter round glyphs — that's a different bug, and why
            // the flip belongs here and nowhere else.
            ctx.scale(1, -1);
            ctx.fill(glyphPath(g, upm, size));
            ctx.restore();
          }
          cursor += (g.ha || upm * 0.5) * (size / upm);
        }
        ctx.restore();
        return cursor;
      }
      function measureText(data, str, size) {
        if (!data || !data.glyphs) return 0;
        const upm = data.resolution || 1000;
        let w = 0;
        for (const ch of str) {
          const g = data.glyphs[ch];
          w += ((g && g.ha) || upm * 0.5) * (size / upm);
        }
        return w;
      }

      // Fonts available to the paint side: the same built-ins the 3D tool uses
      // (fetched once and cached) plus anything the user uploaded.
      const paintFonts = {};    // key -> typeface data
      function paintFontData(key) {
        if (paintFonts[key]) return Promise.resolve(paintFonts[key]);
        // uploaded fonts are already converted and stored by the 3D side
        try {
          const store = JSON.parse(localStorage.getItem('modelsmith_fonts_v2') || '{}');
          if (store[key] && store[key].data) { paintFonts[key] = store[key].data; return Promise.resolve(paintFonts[key]); }
        } catch (e) {}
        // Built-ins are embedded in the page — no network needed.
        if (window.MODELSMITH_FONTS && window.MODELSMITH_FONTS[key]) {
          paintFonts[key] = window.MODELSMITH_FONTS[key].data;
          return Promise.resolve(paintFonts[key]);
        }
        return Promise.reject(new Error('Unknown font: ' + key));
      }

      // Keep the paint font dropdown in step with the 3D one (incl. uploads).
      // Uploaded fonts are read straight from storage rather than scraped from the
      // 3D <select>, so they're available even if the 3D side hasn't started yet.
      function syncFontList() {
        const mine = $('ps-font');
        if (!mine) return;
        const keep = mine.value;
        mine.innerHTML = '';
        const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; mine.appendChild(o); };
        // built-ins are embedded in the page (see MODELSMITH_FONTS)
        Object.keys(window.MODELSMITH_FONTS || {}).forEach(k => add(k, window.MODELSMITH_FONTS[k].family));
        try {
          const store = JSON.parse(localStorage.getItem('modelsmith_fonts_v2') || '{}');
          Object.keys(store).forEach(k => {
            if (store[k] && store[k].data) add(k, (store[k].family || k) + ' (uploaded)');
          });
        } catch (e) { /* no uploads stored */ }
        if (keep && [...mine.options].some(o => o.value === keep)) mine.value = keep;
      }

      // ── Live text ───────────────────────────────────────────────────────────
      // Text stays live after you place it: draggable, and re-renderable with a
      // different font, size or colour. It's only baked into the layer's pixels
      // when you commit it (Enter, another tool, or clicking elsewhere), so you
      // can keep adjusting until it's right.
      let liveText = null;    // { str, x, y, key, size, colour, warp, amount }
      let textDrag = null;
      let caretOn = true, caretTimer = null;

      // Begin (or resume) typing directly on the canvas. `existing` carries the
      // font/size/colour of a committed object being re-edited.
      function startLiveText(p, prefill, existing) {
        const key = existing ? existing.key : ($('ps-font') ? $('ps-font').value : 'ms_sans');
        const size = existing ? existing.size
                              : (parseInt($('ps-textsize') ? $('ps-textsize').value : 48) || 48);
        liveText = {
          str: prefill || '',
          x: p.x, y: p.y,
          key, size,
          colour: existing ? existing.colour : toolColor(),
          warp: existing && existing.warp ? existing.warp : ($('ps-warp') ? $('ps-warp').value : 'none'),
          amount: existing && existing.amount != null ? existing.amount
                  : (parseInt($('ps-warp-amt') ? $('ps-warp-amt').value : 40) || 40) / 100,
          // Editing an existing text object must NOT spawn another layer.
          editing: !!existing
        };
        ensureTextFont(key).then(() => composite()).catch(() => {});
        startCaret();
        focusTextCapture();
        composite();
        banner('Type to add text · Enter commits · Esc discards');
      }

      // Touch keyboards only appear for a focused, editable element — a canvas can
      // never summon one, so on a tablet the live text had no way to receive input.
      // This hidden field is focused whenever text goes live: iOS/Android raise the
      // keyboard for it, and whatever is typed is mirrored straight into liveText.
      // It's positioned over the caret (not off-screen) because browsers refuse to
      // show the keyboard for a field outside the viewport, and kept visually
      // invisible so it never covers the artwork.
      let textCapture = null;
      function ensureTextCapture() {
        if (textCapture) return textCapture;
        const el = document.createElement('textarea');
        el.id = 'ps-text-capture';
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('spellcheck', 'false');
        el.style.cssText = 'position:fixed; opacity:0; pointer-events:none; z-index:-1;' +
                           'width:1px; height:1px; padding:0; border:0; margin:0;' +
                           'resize:none; overflow:hidden; background:transparent; color:transparent;';
        document.body.appendChild(el);
        // Mirror the field into the live text. Using 'input' rather than key events
        // means IME composition, autocorrect and paste all work.
        el.addEventListener('input', () => {
          if (!liveText) return;
          liveText.str = el.value;
          composite();
        });
        el.addEventListener('keydown', (ev) => {
          if (!liveText) return;
          if (ev.key === 'Enter') { ev.preventDefault(); commitText(); }
          else if (ev.key === 'Escape') {
            ev.preventDefault();
            liveText = null; textDrag = null; stopCaret(); blurTextCapture();
            composite(); banner('Text discarded.');
          }
        });
        textCapture = el;
        return el;
      }
      function focusTextCapture() {
        const el = ensureTextCapture();
        el.value = liveText ? liveText.str : '';
        // Sit it under the caret so the browser counts it as on-screen.
        try {
          const b = liveTextBox();
          if (b && view) {
            const r = view.getBoundingClientRect();
            el.style.left = Math.round(r.left + (b.x + b.w) * zoom) + 'px';
            el.style.top  = Math.round(r.top  + b.y * zoom) + 'px';
          }
        } catch (e) { /* positioning is a nicety, not a requirement */ }
        setTimeout(() => { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }, 0);
      }
      // Keep the hidden field matching liveText when the desktop path edits it, so
      // switching between typing on a keyboard and a tablet mid-edit stays coherent.
      function syncTextCapture() {
        if (textCapture && liveText) textCapture.value = liveText.str;
      }
      function blurTextCapture() {
        if (textCapture) { try { textCapture.blur(); } catch (e) {} }
      }
      // A blinking caret makes it obvious the canvas is accepting keystrokes.
      function startCaret() {
        stopCaret();
        caretOn = true;
        caretTimer = setInterval(() => { caretOn = !caretOn; if (liveText) composite(); }, 530);
      }
      function stopCaret() {
        if (caretTimer) { clearInterval(caretTimer); caretTimer = null; }
        caretOn = true;
      }

      function ensureTextFont(key) {
        return paintFontData(key).then(d => { paintFonts[key] = d; return d; });
      }

      // Where the live text sits, in canvas coords. Centred on its anchor.
      function liveTextBox() {
        if (!liveText) return null;
        const data = paintFonts[liveText.key];
        if (!data) return null;
        const w = measureText(data, liveText.str, liveText.size);
        const h = liveText.size;
        return { x: liveText.x - w / 2, y: liveText.y - h * 0.35, w, h };
      }
      function hitLiveText(p) {
        const b = liveTextBox();
        if (!b) return false;
        const pad = 6;
        return p.x >= b.x - pad && p.x <= b.x + b.w + pad &&
               p.y >= b.y - pad && p.y <= b.y + b.h + pad;
      }

      // Draw the live text plus a light frame, as an overlay on the composite.
      function drawLiveText() {
        if (!liveText) return;
        const data = paintFonts[liveText.key];
        if (!data) return;
        const w = measureText(data, liveText.str, liveText.size);
        drawText(vctx, data, liveText.str, liveText.x - w / 2, liveText.y + liveText.size * 0.35,
                 liveText.size, liveText.colour, liveText.warp, liveText.amount);
        const b = liveTextBox();
        if (!b) return;
        vctx.save();
        vctx.strokeStyle = 'rgba(90,200,255,.9)';
        vctx.lineWidth = 1 / zoom;
        vctx.setLineDash([4 / zoom, 3 / zoom]);
        vctx.strokeRect(b.x - 4 / zoom, b.y - 4 / zoom, b.w + 8 / zoom, b.h + 8 / zoom);
        vctx.restore();
        // Blinking caret at the end of the run, so it's clear the canvas has focus
        // and an empty text box is still visible before anything is typed.
        if (caretOn) {
          vctx.save();
          vctx.fillStyle = liveText.colour || '#000';
          vctx.fillRect(b.x + b.w + 2 / zoom, b.y, Math.max(1.5 / zoom, liveText.size * 0.05), b.h);
          vctx.restore();
        }
      }

      // Bake the live text into the active layer.
      // Commit the live text to the active layer AS AN EDITABLE OBJECT. Rather than
      // baking straight to pixels (which makes it permanent and un-retypeable), the
      // text is stored on the layer and re-rendered from its string/font/size. The
      // text tool can hit-test these later to re-open them for editing. A separate
      // "flatten text" bakes them to pixels only when the user explicitly wants that.
      // When a vector shape is drawn and the current layer can't hold shapes, make
      // a vector layer for it automatically — the way Photoshop, Affinity and
      // Illustrator all behave. Otherwise the shape silently stamps into pixels and
      // is no longer editable, which is a surprise you only notice later.
      function layerForShape() {
        const l = active();
        if (l && l.kind === 'vector') return l;
        const auto = $('ps-autovec');
        if (auto && !auto.checked) return l;          // user opted out
        const nl = addLayer('vector', 'Shape');
        banner('New vector layer — shapes stay editable. Turn this off in Tool options.');
        return nl;
      }

      function commitText() {
        if (!liveText) return;
        const data = paintFonts[liveText.key];
        // New text gets its OWN layer, the way Photoshop and Affinity do — so it
        // can be moved, restyled, masked and reordered without disturbing whatever
        // was underneath. Editing existing text (liveText.editing) stays on the
        // layer it already belongs to.
        let l;
        if (liveText.editing) {
          l = active();
        } else {
          const label = (liveText.str || '').trim().slice(0, 22) || 'Text';
          l = addLayer('raster', label);
        }
        if (!l || !data) { liveText = null; composite(); return; }
        if (!l.texts) l.texts = [];
        l.texts.push({
          str: liveText.str, x: liveText.x, y: liveText.y,
          key: liveText.key, size: liveText.size, colour: liveText.colour,
          warp: liveText.warp, amount: liveText.amount
        });
        const s = liveText.str;
        liveText = null; textDrag = null; stopCaret(); blurTextCapture();
        renderTextLayer(l);
        composite(); pushHistory('Text'); renderLayerList();
        banner('Text added on its own layer — click it with the Text tool to edit.');
      }

      // Re-render a layer's editable text objects. Text sits in its own scratch that
      // composites over the layer's painted pixels, so editing a caption never
      // disturbs brushwork underneath. We keep the raw painted pixels in _paint and
      // rebuild canvas = paint + texts on every change.
      function renderTextLayer(l) {
        if (!l.texts || !l.texts.length) {
          // nothing to overlay — if we had stashed paint, restore it
          if (l._paint) { l.ctx.setTransform(1,0,0,1,0,0); l.ctx.clearRect(0,0,W,H); l.ctx.drawImage(l._paint,0,0); }
          touch(l);
          return;
        }
        // stash the painted pixels the first time (before any text overlay)
        if (!l._paint) {
          l._paint = document.createElement('canvas'); l._paint.width = W; l._paint.height = H;
          l._paint.getContext('2d').drawImage(l.canvas, 0, 0);
        }
        l.ctx.setTransform(1,0,0,1,0,0);
        l.ctx.clearRect(0,0,W,H);
        l.ctx.drawImage(l._paint, 0, 0);
        l.texts.forEach(t => {
          const data = paintFonts[t.key];
          if (!data) { ensureTextFont(t.key).then(() => { renderTextLayer(l); composite(); }); return; }
          const w = measureText(data, t.str, t.size);
          drawText(l.ctx, data, t.str, t.x - w / 2, t.y + t.size * 0.35, t.size, t.colour, t.warp, t.amount);
        });
        touch(l);
      }

      // Find an editable text object at a point (topmost first), for re-editing.
      function hitLayerText(l, p) {
        if (!l.texts) return -1;
        for (let i = l.texts.length - 1; i >= 0; i--) {
          const t = l.texts[i];
          const data = paintFonts[t.key];
          if (!data) continue;
          const w = measureText(data, t.str, t.size), h = t.size;
          const bx = t.x - w / 2, by = t.y - h * 0.35;
          if (p.x >= bx - 6 && p.x <= bx + w + 6 && p.y >= by - 6 && p.y <= by + h + 6) return i;
        }
        return -1;
      }

      // Re-render the live text when its font/size/colour is changed from the HUD.
      function updateLiveText(patch) {
        if (!liveText) return false;
        Object.assign(liveText, patch);
        if (patch.key) ensureTextFont(patch.key).then(() => composite())
          .catch(() => banner("⚠️ Couldn't load that font."));
        else composite();
        return true;
      }

      // ── In-app text entry ───────────────────────────────────────────────────
      // Replaces window.prompt(), which sits outside the app, can't be styled, and
      // on iPad covers the canvas you're trying to place text on. The popover opens
      // next to the click and is clamped to the viewport.
      let textTarget = null;
      function askForText(e, p, prefill) {
        const pop = $('ps-text-pop'), input = $('ps-text-input');
        if (!pop || !input) return;
        textTarget = { x: p.x, y: p.y };
        input.value = prefill || '';
        pop.style.display = 'block';
        // position near the pointer, kept on screen
        const r = pop.getBoundingClientRect();
        const px = (e && e.clientX != null) ? e.clientX : window.innerWidth / 2;
        const py = (e && e.clientY != null) ? e.clientY : window.innerHeight / 2;
        const x = Math.max(8, Math.min(window.innerWidth - r.width - 8, px + 12));
        const y = Math.max(8, Math.min(window.innerHeight - r.height - 8, py + 12));
        pop.style.left = x + 'px';
        pop.style.top = y + 'px';
        setTimeout(() => input.focus(), 0);
      }
      function closeTextPop() {
        const pop = $('ps-text-pop');
        if (pop) pop.style.display = 'none';
        textTarget = null;
      }
      function acceptText() {
        const input = $('ps-text-input');
        const str = input ? input.value.trim() : '';
        if (!str || !textTarget) { closeTextPop(); return; }
        liveText = {
          str, x: textTarget.x, y: textTarget.y,
          key: (textTarget.key || $('ps-font').value),
          size: (textTarget.size || parseInt($('ps-textsize').value) || 72),
          colour: (textTarget.colour || toolColor())
        };
        closeTextPop();
        ensureTextFont(liveText.key).then(() => composite())
          .catch(() => banner("⚠️ Couldn't load that font — try another, or upload a TTF/OTF."));
        banner('Drag to move it. Change font/size below. Enter — or another tool — sets it down.');
      }


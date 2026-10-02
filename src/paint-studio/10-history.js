      // ── History (snapshot every layer's pixels) ─────────────────────────────
      // Encoding a layer to PNG is by far the most expensive thing in a snapshot,
      // and snapshots run on every stroke (history) and every autosave. Most of that
      // work is wasted: a stroke touches one layer, but every layer was being
      // re-encoded from scratch each time.
      //
      // So each layer caches its own PNG, tagged with a revision number. touch(l)
      // bumps the revision when a layer's pixels change; layerPNG(l) re-encodes only
      // when the cache is behind. Unchanged layers hand back the SAME string, so
      // successive history steps also share it in memory rather than duplicating it.
      function touch(l) {
        if (l) {
          l._rev = (l._rev || 0) + 1;
          // While mask editing, l.canvas points at the mask — so a touch means the
          // mask changed. Bump its rev so the composite rebuilds the alpha ramp.
          if (maskEditing && l.id === maskEditLayerId) l._maskRev = (l._maskRev || 0) + 1;
        }
      }
      function touchAll() { layers.forEach(touch); }
      function layerPNG(l) {
        if (l._pngRev === l._rev && l._png != null) return l._png;
        // While a mask is being edited, l.canvas points at the mask — the real
        // pixels live on _realCanvas, so encode that. Otherwise prefer the paint-only
        // base when the layer carries editable text.
        let src = l._realCanvas || l.canvas;
        if (!l._realCanvas && l.texts && l.texts.length && l._paint) src = l._paint;
        l._png = src.toDataURL();
        l._pngRev = l._rev || 0;
        return l._png;
      }

      function snapshot() {
        return {
          W, H, activeId,
          layers: layers.map(l => {
            if (l.kind === 'group') {
              return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
                       kind: 'group', collapsed: !!l.collapsed };
            }
            return {
              id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
              blend: l.blend, kind: l.kind, groupId: l.groupId || null,
              shapes: JSON.parse(JSON.stringify(l.shapes || [])),
              texts: JSON.parse(JSON.stringify(l.texts || [])),
              mask: (l._realCanvas || l.mask) ? (l.mask ? l.mask.toDataURL() : null) : null,
              fx: l.fx ? JSON.parse(JSON.stringify(l.fx)) : null,
              data: layerPNG(l)
            };
          })
        };
      }
      function refreshDocks() {
        if (window.renderSwatchDock) window.renderSwatchDock();
      }
      function pushHistory(label) {
        try {
          // The tool that triggered this almost always drew on the active layer;
          // bumping it here is the catch-all that keeps the PNG cache honest without
          // instrumenting every draw call. Layer-structural ops (merge/clear/resize)
          // additionally call touch()/touchAll() at their own site.
          touch(active());
          if (histIndex < history.length - 1) history = history.slice(0, histIndex + 1);
          const snap = snapshot();
          snap.label = label || labelForTool();
          snap.at = Date.now();
          snap.thumb = historyThumb();
          history.push(snap);
          if (history.length > MAX_HIST) history.shift();
          histIndex = history.length - 1;
          if (window.renderHistoryPanel) window.renderHistoryPanel();
          saveSoon();
        } catch (e) { /* snapshots are best-effort */ }
        refreshDocks();
      }

      // A readable name for whatever just happened, derived from the active tool.
      function labelForTool() {
        const nice = {
          brush: 'Brush stroke', pencil: 'Pencil stroke', marker: 'Marker stroke',
          airbrush: 'Airbrush', calligraphy: 'Calligraphy', spray: 'Spray',
          eraser: 'Erased', smudge: 'Smudged', blurbrush: 'Blurred',
          dodge: 'Dodged', burn: 'Burned', clone: 'Cloned',
          fill: 'Filled', gradient: 'Gradient', text: 'Added text',
          rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', pen: 'Path',
          vedit: 'Edited points', move: 'Moved layer', selmove: 'Moved selection'
        };
        return nice[tool] || 'Edit';
      }

      // Small preview of the whole artwork for the history list, with a glow marking
      // whatever changed in this step. The glow is worked out by diffing this frame
      // against the previous one at thumbnail scale — cheap, and exact about where
      // the change actually landed.
      let _lastThumbPixels = null;
      const THUMB_S = 80;   // rendered at 2x; displayed ~34px, so it stays crisp
      // Lay the artwork into a thumbnail-sized canvas. Shared by the thumbnail and
      // its diff baseline so the two can never drift out of alignment — if they did,
      // every step would diff as entirely changed.
      function paintThumbCanvas() {
        const S = THUMB_S;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#12161c'; g.fillRect(0, 0, S, S);
        // Inset the artwork slightly: the canvas is usually square, so without this
        // a change touching a border has nowhere to put its outline and the glow
        // gets clipped against the thumbnail edge.
        const inset = Math.round(3 * (S / 40));
        const avail = S - inset * 2;
        const s = Math.min(avail / W, avail / H);
        const dw = W * s, dh = H * s;
        g.drawImage(flatten(), (S - dw) / 2, (S - dh) / 2, dw, dh);
        return { c, g, S };
      }

      function historyThumb() {
        try {
          const { c, g, S } = paintThumbCanvas();

          const now = g.getImageData(0, 0, S, S);
          const prev = _lastThumbPixels;
          _lastThumbPixels = new Uint8ClampedArray(now.data);

          if (prev) {
            // Mark cells that differ from the previous step. A generous threshold
            // keeps faint airbrush work visible without lighting up on noise.
            const mask = new Uint8Array(S * S);
            let any = false;
            for (let p = 0; p < S * S; p++) {
              const i = p * 4;
              const d = Math.abs(now.data[i] - prev[i]) + Math.abs(now.data[i+1] - prev[i+1]) +
                        Math.abs(now.data[i+2] - prev[i+2]) + Math.abs(now.data[i+3] - prev[i+3]);
              if (d > 24) { mask[p] = 1; any = true; }
            }
            if (any) drawChangeGlow(g, mask, S);
          }
          return c.toDataURL('image/png');
        } catch (e) { return null; }
      }

      // Ring the area that changed. Earlier versions traced the changed pixels
      // themselves, but at 40px a brush stroke is only a couple of pixels thick, so
      // every pixel counts as an edge and the "outline" became a solid bar covering
      // the very thing it was pointing at. Boxing the region instead keeps the
      // artwork visible underneath.
      // Trace the shape of what actually changed, rather than boxing it. The mask
      // already knows precisely which pixels moved, so a stroke lights up as a
      // stroke and a rectangle as a rectangle.
      //
      // Compositing notes, both learned the hard way:
      //  - 'lighter' (additive) is invisible on white artwork — 255 can't brighten.
      //  - Drawing the glow ON the change buries it. So the halo is drawn as a
      //    blurred, expanded copy of the mask with the change itself punched back
      //    out of it, leaving a soft ring hugging the actual shape.
      function drawChangeGlow(g, mask, S) {
        const k = S / 40;   // geometry below is tuned against a 40px thumbnail

        // Grow the changed region a little, then trace the boundary of THAT. Tracing
        // the raw mask gives a broken, dotted line, because a thin brush stroke is
        // nearly all edge — every pixel qualifies. Dilating first merges the change
        // into one solid region so its outline comes out as a single clean contour
        // that sits just outside the artwork rather than on top of it.
        const R = Math.max(1, Math.round(1.6 * k));
        const grown = new Uint8Array(S * S);
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            if (!mask[y * S + x]) continue;
            for (let dy = -R; dy <= R; dy++) {
              for (let dx = -R; dx <= R; dx++) {
                if (dx * dx + dy * dy > R * R) continue;   // round, not square
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < S && ny < S) grown[ny * S + nx] = 1;
              }
            }
          }
        }

        // boundary of the grown region
        const edge = [];
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const p = y * S + x;
            if (!grown[p]) continue;
            const l = x > 0 && grown[p - 1], r = x < S - 1 && grown[p + 1];
            const u = y > 0 && grown[p - S], d = y < S - 1 && grown[p + S];
            if (!l || !r || !u || !d) edge.push(p);
          }
        }
        if (!edge.length) return;

        const stamp = (colour, thick, alpha) => {
          const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
          const cx = cv.getContext('2d');
          const im = cx.createImageData(S, S);
          const put = (x, y) => {
            if (x < 0 || y < 0 || x >= S || y >= S) return;
            const i = (y * S + x) * 4;
            im.data[i] = colour[0]; im.data[i + 1] = colour[1];
            im.data[i + 2] = colour[2]; im.data[i + 3] = 255;
          };
          for (const p of edge) {
            const x = p % S, y = (p / S) | 0;
            put(x, y);
            if (thick) { put(x - 1, y); put(x + 1, y); put(x, y - 1); put(x, y + 1); }
          }
          cx.putImageData(im, 0, 0);
          g.save(); g.globalAlpha = alpha; g.drawImage(cv, 0, 0); g.restore();
        };

        // Dark backing first, then a bright core on top. Two tones mean the line
        // stays visible whether the artwork behind it is light or dark — a single
        // colour disappears against artwork of the same shade.
        stamp([8, 10, 14], true, 0.5);
        stamp([255, 190, 80], false, 1);
      }
      // Recompute the change-glow baseline from whatever is currently on the canvas.
      // Called after undo/redo/jump so the next edit's glow marks the edit, not the
      // difference the jump itself made.
      function resetThumbBaseline() {
        try {
          const { g, S } = paintThumbCanvas();
          _lastThumbPixels = new Uint8ClampedArray(g.getImageData(0, 0, S, S).data);
        } catch (e) { _lastThumbPixels = null; }
      }

      let restoreGen = 0;
      // onReady fires once every layer's image has actually decoded. Layer data is
      // restored through Image.onload, so anything that needs the real pixels — such
      // as taking the opening history snapshot — must wait for this rather than for
      // restore() merely returning.
      function restore(snap, onReady) {
        const gen = ++restoreGen;   // stale async loads from an earlier restore are dropped
        W = snap.W; H = snap.H;
        view.width = W; view.height = H; sizeWrap();
        let pending = snap.layers.length;
        const done = () => { if (gen === restoreGen && --pending === 0) { composite(); resetThumbBaseline(); if (onReady) onReady(); } };
        layers = snap.layers.map(s => {
          if (s.kind === 'group') {
            // Group folder entry — no pixels to load, so count it done immediately.
            const g = makeGroup(s.name);
            g.id = s.id; g.visible = s.visible; g.opacity = s.opacity; g.collapsed = !!s.collapsed;
            Promise.resolve().then(done);
            return g;
          }
          const l = makeLayer(s.name, s.kind);
          l.id = s.id; l.visible = s.visible; l.opacity = s.opacity;
          l.blend = s.blend; l.shapes = s.shapes || []; l.texts = s.texts || [];
          l.groupId = s.groupId || null;
          l.fx = s.fx ? Object.assign(defaultFX(), s.fx) : null;
          const img = new Image();
          img.onload = () => {
            if (gen === restoreGen) {
              l.ctx.drawImage(img, 0, 0);
              // decoded pixels are the paint-only base; keep a copy and lay any
              // editable text objects on top
              if (l.texts && l.texts.length) {
                l._paint = document.createElement('canvas'); l._paint.width = W; l._paint.height = H;
                l._paint.getContext('2d').drawImage(img, 0, 0);
                renderTextLayer(l);
              }
            }
            done();
          };
          img.onerror = done;
          img.src = s.data;
          l._rev = 0; l._pngRev = 0; l._png = s.data;
          if (s.mask) {
            const mm = document.createElement('canvas'); mm.width = W; mm.height = H;
            const mmx = mm.getContext('2d', { willReadFrequently: true });
            const mImg = new Image();
            mImg.onload = () => { if (gen === restoreGen) { mmx.drawImage(mImg, 0, 0); composite(); } };
            mImg.src = s.mask;
            l.mask = mm; l.maskCtx = mmx; l._maskRev = (l._maskRev||0)+1; l._maskAlphaRev = -1;
          }
          return l;
        });
        activeId = snap.activeId;
        renderLayerList();
        if (!snap.layers.length) { composite(); if (onReady) onReady(); }
      }
      // Undo/redo/jump must discard any in-flight state first. A floating selection
      // or live text holds pixels that aren't in the layer yet; restoring underneath
      // them would leave them stranded on top of the older artwork — the "undo keeps
      // the item" bug.
      function dropTransient() {
        if (floatSel) { floatSel = null; }        // discard, don't stamp
        if (liveText) { liveText = null; textDrag = null; }
        // Exit mask-editing / transform so their canvas swaps don't survive across a
        // history restore (which rebuilds the layers underneath them).
        exitMaskEdit();
        if (xform) { xform = null; }
        sel = null; selBounds = null; selMoveState = null;
      }
      function undo() { if (histIndex > 0) { dropTransient(); histIndex--; restore(history[histIndex]); banner('Undo'); refreshDocks(); if (window.renderHistoryPanel) window.renderHistoryPanel(); } }
      function redo() { if (histIndex < history.length - 1) { dropTransient(); histIndex++; restore(history[histIndex]); banner('Redo'); if (window.renderHistoryPanel) window.renderHistoryPanel(); } }

      // Jump to any step. Later steps stay reachable until a new edit replaces them.
      function jumpToStep(i) {
        if (i < 0 || i >= history.length || i === histIndex) return;
        dropTransient();
        histIndex = i;
        restore(history[i]);
        if (window.renderHistoryPanel) window.renderHistoryPanel();
        banner(history[i].label || 'Jumped');
      }


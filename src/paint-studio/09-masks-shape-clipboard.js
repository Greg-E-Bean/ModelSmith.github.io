      // ── Layer masks ─────────────────────────────────────────────────────────
      // A mask is a separate canvas whose alpha gates the layer at composite time
      // (see composite()). Painting on the mask is done by temporarily pointing the
      // layer's own canvas/ctx at the mask — so the entire brush pipeline works on
      // it unchanged — and swapping back when you stop editing the mask.
      let maskEditing = false;
      let maskEditLayerId = null;   // which layer's mask we're editing (may differ from active)
      // Exit mask editing safely, restoring whichever layer we swapped — not just
      // whatever is active now, since the active layer can change underneath us.
      function exitMaskEdit() {
        if (!maskEditing) return;
        const l = layers.find(x => x.id === maskEditLayerId);
        if (l) restoreFromMask(l);
        maskEditing = false; maskEditLayerId = null;
        syncMaskButton();
      }
      function ensureMask(l) {
        if (l.mask) return;
        const m = document.createElement('canvas'); m.width = W; m.height = H;
        const mx = m.getContext('2d', { willReadFrequently: true });
        mx.fillStyle = '#fff'; mx.fillRect(0, 0, W, H);   // white = fully visible
        l.mask = m; l.maskCtx = mx; l._maskRev = (l._maskRev || 0) + 1;
      }
      function addMask() {
        const l = active(); if (!l) return;
        if (l.mask) return banner('This layer already has a mask.');
        ensureMask(l); touch(l);
        composite(); pushHistory('Added mask'); renderLayerList();
        banner('Mask added — turn on "Edit mask" and paint black to hide.');
      }
      function toggleMaskPaint() {
        const l = active(); if (!l) return;
        if (!l.mask) { addMask(); }
        maskEditing = !maskEditing;
        if (maskEditing) {
          // point the layer's drawing surface at the mask
          l._realCanvas = l.canvas; l._realCtx = l.ctx;
          l.canvas = l.mask; l.ctx = l.maskCtx;
          maskEditLayerId = l.id;
          banner('Editing mask — black hides, white reveals. Turn off to paint the layer again.');
        } else {
          restoreFromMask(l);
          maskEditLayerId = null;
          banner('Back to painting the layer.');
        }
        const btn = $('pl-mask-paint');
        if (btn) { btn.classList.toggle('active', maskEditing); btn.textContent = maskEditing ? 'Editing mask ✓' : 'Edit mask'; }
        renderLayerList();
      }
      function syncMaskButton() {
        const btn = $('pl-mask-paint');
        if (btn) { btn.classList.toggle('active', maskEditing); btn.textContent = maskEditing ? 'Editing mask ✓' : 'Edit mask'; }
      }
      function restoreFromMask(l) {
        if (l._realCanvas) { l.canvas = l._realCanvas; l.ctx = l._realCtx; l._realCanvas = null; l._realCtx = null; }
      }
      function invertMask() {
        const l = active(); if (!l || !l.mask) return banner('No mask on this layer.');
        const img = l.maskCtx.getImageData(0, 0, W, H); const d = img.data;
        for (let i = 0; i < d.length; i += 4) { d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; }
        l.maskCtx.putImageData(img, 0, 0); l._maskRev = (l._maskRev || 0) + 1; touch(l);
        composite(); pushHistory('Inverted mask'); banner('Mask inverted.');
      }
      function applyMask() {
        const l = active(); if (!l || !l.mask) return banner('No mask to apply.');
        exitMaskEdit();     // stop editing first
        // bake: multiply the layer by the mask's luminance, then discard the mask
        const real = l._realCanvas || l.canvas;
        const rx = real.getContext('2d');
        rx.globalCompositeOperation = 'destination-in';
        rx.drawImage(l.mask, 0, 0);
        rx.globalCompositeOperation = 'source-over';
        l.mask = null; l.maskCtx = null; touch(l);
        syncMaskButton();
        composite(); pushHistory('Applied mask'); renderLayerList();
        banner('Mask baked into the layer.');
      }
      function deleteMask() {
        const l = active(); if (!l || !l.mask) return banner('No mask to delete.');
        exitMaskEdit();
        l.mask = null; l.maskCtx = null; touch(l);
        syncMaskButton();
        composite(); pushHistory('Deleted mask'); renderLayerList();
        banner('Mask removed — layer is fully visible again.');
      }

      // ── Vector shape clipboard ──────────────────────────────────────────────
      // Copy/cut/paste the shape selected with the Edit-points tool. Paste drops the
      // shape back slightly offset so it's visible as a distinct copy. This replaces
      // the old boolean-subtract, which was fiddlier than it was worth.
      let shapeClipboard = null;
      function copyShape(cut) {
        const l = active();
        if (!l || l.kind !== 'vector') return banner('Select a shape on a vector layer first (Edit-points tool).');
        if (!vSel || vSel.shapeIndex == null) return banner('No shape selected — tap one with the Edit-points tool.');
        shapeClipboard = JSON.parse(JSON.stringify(l.shapes[vSel.shapeIndex]));
        if (cut) {
          l.shapes.splice(vSel.shapeIndex, 1);
          vSel = null;
          renderVector(l); composite(); pushHistory('Cut shape'); renderLayerList();
          banner('Shape cut to clipboard.');
        } else {
          banner('Shape copied to clipboard.');
        }
      }
      function pasteShape() {
        const l = active();
        if (!l || l.kind !== 'vector') return banner('Paste onto a vector layer (VEC).');
        if (!shapeClipboard) return banner('Shape clipboard is empty — copy or cut a shape first.');
        const s = JSON.parse(JSON.stringify(shapeClipboard));
        // offset the paste so it doesn't land exactly on the original
        const off = 18;
        if (s.type === 'path' && s.pts) s.pts.forEach(pt => { pt.x += off; pt.y += off; });
        else { if (s.x1 != null) { s.x1 += off; s.x2 += off; s.y1 += off; s.y2 += off; } }
        l.shapes.push(s);
        vSel = { shapeIndex: l.shapes.length - 1, mode: 'shape' };
        renderVector(l); composite(); pushHistory('Pasted shape'); renderLayerList();
        banner('Shape pasted.');
      }

      // Remove overlaps between the vector layer's shapes — the 2D counterpart of a
      // boolean union on the 3D side. Filled shapes that share a colour are merged
      // into one silhouette so the seams where they overlap vanish: no doubled
      // outline, and no darker patch where semi-transparent fills stacked. Shapes are
      // grouped by fill colour and each group is drawn as a SINGLE path with nonzero
      // winding, which is what fuses the outlines. The result is baked to pixels
      // (like rasterize), because "no overlaps" is a pixel fact, not a vector one —
      // the individual shape objects can't represent a merged outline.
      function uniteOverlaps() {
        const l = active();
        if (!l || l.kind !== 'vector') return banner('Unite works on a vector layer.');
        if (!l.shapes || l.shapes.length < 2) return banner('Need at least two shapes to unite.');

        const out = document.createElement('canvas'); out.width = W; out.height = H;
        const c = out.getContext('2d');
        c.lineCap = 'round'; c.lineJoin = 'round';

        // Group by fill colour so differently-coloured shapes stay distinct.
        const byFill = new Map();
        const strokeOnly = [];
        l.shapes.forEach(s => {
          if (s.fill && s.fill !== 'transparent') {
            const k = s.fill;
            if (!byFill.has(k)) byFill.set(k, []);
            byFill.get(k).push(s);
          } else {
            strokeOnly.push(s);
          }
        });

        // Each colour group: one combined path, filled once — overlaps fuse.
        byFill.forEach((group, fill) => {
          c.save();
          c.fillStyle = fill;
          c.beginPath();
          group.forEach(s => shapePath(c, s));   // accumulate all sub-paths
          c.fill('nonzero');                      // single fill merges the union
          // redraw the strokes on top so outlines still read, but only around the
          // outside — interior seams are already covered by the merged fill
          group.forEach(s => {
            if (s.strokeOn === false) return;
            c.strokeStyle = s.stroke || '#000'; c.lineWidth = s.width || 2;
            c.beginPath(); shapePath(c, s); c.stroke();
          });
          c.restore();
        });
        // stroke-only shapes are unaffected by union — draw them as-is
        strokeOnly.forEach(s => {
          c.save(); c.strokeStyle = s.stroke || '#000'; c.lineWidth = s.width || 2;
          c.beginPath(); shapePath(c, s);
          if (s.strokeOn !== false) c.stroke();
          c.restore();
        });

        // Bake into the layer: it becomes a raster layer holding the merged result.
        l.ctx.setTransform(1, 0, 0, 1, 0, 0);
        l.ctx.clearRect(0, 0, W, H);
        l.ctx.drawImage(out, 0, 0);
        l.shapes = [];
        l.kind = 'raster';
        touch(l);
        composite(); pushHistory('United overlaps'); renderLayerList();
        banner('Overlaps removed — shapes merged into one.');
      }


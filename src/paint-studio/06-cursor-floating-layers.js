      // ── Brush cursor ────────────────────────────────────────────────────────
      // A ring showing exactly what the tool will affect. Essential for the eraser
      // (which leaves no colour to aim by) and useful for every brush-family tool.
      // Drawn as an overlay in canvas space, so it scales correctly with zoom.
      let cursorPos = null;
      const RING_TOOLS = /^(brush|pencil|marker|airbrush|calligraphy|spray|eraser|smudge|blurbrush|dodge|burn|clone)$/;

      function drawBrushCursor() {
        if (!cursorPos || !RING_TOOLS.test(tool) || drawing) return;
        const r = toolSize() / 2;
        if (r <= 0) return;
        vctx.save();
        vctx.lineWidth = 1 / zoom;
        // dark ring under a light one, so it reads on any artwork
        vctx.strokeStyle = 'rgba(0,0,0,.65)';
        vctx.beginPath(); vctx.arc(cursorPos.x, cursorPos.y, r + 0.7 / zoom, 0, Math.PI * 2); vctx.stroke();
        vctx.strokeStyle = tool === 'eraser' ? 'rgba(255,140,140,.95)' : 'rgba(255,255,255,.9)';
        vctx.beginPath(); vctx.arc(cursorPos.x, cursorPos.y, r, 0, Math.PI * 2); vctx.stroke();
        // a centre dot helps when the ring is large
        if (r > 6 / zoom) {
          vctx.fillStyle = 'rgba(255,255,255,.7)';
          vctx.beginPath(); vctx.arc(cursorPos.x, cursorPos.y, 0.8 / zoom, 0, Math.PI * 2); vctx.fill();
        }
        vctx.restore();
      }

      // ── Floating selection ──────────────────────────────────────────────────
      // Moving a selection lifts its pixels out of the layer into `floatSel`, a
      // small canvas that can be dragged repeatedly. The layer keeps a hole where
      // they came from until the float is dropped (on deselect, tool change, or
      // any other edit), at which point it's stamped back at its final position.
      let floatSel = null;   // { canvas, x, y, mask, w, h, mx, my }

      function liftSelection(l) {
        if (!sel || !selBounds || floatSel) return;
        const { x0, y0, x1, y1 } = selBounds;
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const cx2 = c.getContext('2d', { willReadFrequently: true });
        // copy just the selection's bounding box, then mask it to the exact shape
        cx2.drawImage(l.canvas, x0, y0, w, h, 0, 0, w, h);
        const mcv = document.createElement('canvas'); mcv.width = w; mcv.height = h;
        const mx = mcv.getContext('2d');
        const mimg = mx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (sel[(y + y0) * W + (x + x0)]) {
            const i = (y * w + x) * 4;
            mimg.data[i] = mimg.data[i+1] = mimg.data[i+2] = mimg.data[i+3] = 255;
          }
        }
        mx.putImageData(mimg, 0, 0);
        cx2.globalCompositeOperation = 'destination-in';
        cx2.drawImage(mcv, 0, 0);
        // punch the hole in the layer
        l.ctx.save();
        l.ctx.globalCompositeOperation = 'destination-out';
        l.ctx.drawImage(selMaskToCanvas(), 0, 0);
        l.ctx.restore();
        floatSel = { canvas: c, x: x0, y: y0, w, h, maskCanvas: mcv };
        composite();
      }

      // Stamp a floating selection back down and forget it.
      function dropSelection(push) {
        const l = active();
        if (!floatSel || !l) return;
        l.ctx.drawImage(floatSel.canvas, Math.round(floatSel.x), Math.round(floatSel.y));
        touch(l);
        floatSel = null;
        composite();
        if (push !== false) { pushHistory(); renderLayerList(); }
      }

      // Rebuild the selection mask to follow the float's current position, so the
      // marching ants track the pixels as they move.
      function syncFloatMask() {
        if (!floatSel) return;
        const m = new Uint8Array(W * H);
        const fx = Math.round(floatSel.x), fy = Math.round(floatSel.y);
        const md = floatSel.maskCanvas.getContext('2d').getImageData(0, 0, floatSel.w, floatSel.h).data;
        for (let y = 0; y < floatSel.h; y++) for (let x = 0; x < floatSel.w; x++) {
          if (md[(y * floatSel.w + x) * 4 + 3] > 127) {
            const gx = x + fx, gy = y + fy;
            if (gx >= 0 && gy >= 0 && gx < W && gy < H) m[gy * W + gx] = 1;
          }
        }
        selFromMask(m);
      }

      // ── Layers ──────────────────────────────────────────────────────────────
      let layerSeq = 1;
      function makeLayer(name, kind) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const l = {
          id: 'L' + (layerSeq++), name: name || `Layer ${layerSeq - 1}`,
          canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }),
          visible: true, opacity: 1, blend: 'source-over',
          kind: kind || 'raster', shapes: [], groupId: null
        };
        return l;
      }
      // Layer groups are folder entries that live inline in the `layers` array,
      // marked with kind:'group'. Real layers point at their parent via groupId.
      // A group carries its own visibility/opacity/collapsed state; children inherit
      // visibility and multiply their opacity by the group's when compositing.
      function makeGroup(name) {
        return {
          id: 'G' + (layerSeq++), name: name || 'Group',
          kind: 'group', visible: true, opacity: 1, collapsed: false, groupId: null
        };
      }
      // The group entry a layer belongs to (or null). Groups themselves aren't nested.
      function layerGroupOf(l) {
        if (!l || !l.groupId) return null;
        return layers.find(x => x.kind === 'group' && x.id === l.groupId) || null;
      }
      // Effective visibility/opacity fold in the parent group's state.
      function effVisible(l) {
        if (!l.visible) return false;
        const g = layerGroupOf(l);
        return g ? g.visible : true;
      }
      function effOpacity(l) {
        const g = layerGroupOf(l);
        return l.opacity * (g ? g.opacity : 1);
      }
      const active = () => layers.find(l => l.id === activeId) || null;

      function addLayer(kind, name) {
        exitMaskEdit();
        const l = makeLayer(name, kind);
        const idx = layers.findIndex(x => x.id === activeId);
        layers.splice(idx < 0 ? layers.length : idx + 1, 0, l);
        activeId = l.id;
        renderLayerList(); composite(); pushHistory();
        return l;
      }


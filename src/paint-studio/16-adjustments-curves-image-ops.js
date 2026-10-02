      // ── Image adjustments ───────────────────────────────────────────────────
      function applyAdjust() {
        const l = active(); if (!l) return;
        const br = parseInt($('pi-bright').value) || 0;
        const ct = parseInt($('pi-contrast').value) || 0;
        const st = parseInt($('pi-sat').value) || 0;
        const hue = parseInt($('pi-hue').value) || 0;
        if (!br && !ct && !st && !hue) return banner('Nothing to apply — move a slider first.');
        const img = l.ctx.getImageData(0, 0, W, H); const d = img.data;
        const cf = (259 * (ct + 255)) / (255 * (259 - ct));
        for (let i = 0; i < d.length; i += 4) {
          if (d[i+3] === 0) continue;
          let r = d[i], g = d[i+1], b = d[i+2];
          r += br; g += br; b += br;
          r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
          if (st) {
            const gray = 0.2126*r + 0.7152*g + 0.0722*b;
            const s = 1 + st/100;
            r = gray + (r - gray) * s; g = gray + (g - gray) * s; b = gray + (b - gray) * s;
          }
          if (hue) {
            // rotate hue in HSL space
            const hsl = rgbToHsl(r, g, b);
            hsl[0] = (hsl[0] + hue/360 + 1) % 1;
            const rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
            r = rgb[0]; g = rgb[1]; b = rgb[2];
          }
          d[i] = Math.max(0, Math.min(255, r));
          d[i+1] = Math.max(0, Math.min(255, g));
          d[i+2] = Math.max(0, Math.min(255, b));
        }
        l.ctx.putImageData(img, 0, 0); touch(l);
        ['pi-bright','pi-contrast','pi-sat','pi-hue'].forEach(id => { $(id).value = 0; });
        $('pi-bright-val').textContent = '0'; $('pi-contrast-val').textContent = '0';
        $('pi-sat-val').textContent = '0'; $('pi-hue-val').textContent = '0°';
        composite(); pushHistory(); renderLayerList(); banner('Adjustment applied.');
      }

      // HSL helpers for hue rotation. r,g,b in 0..255; h,s,l in 0..1.
      function rgbToHsl(r, g, b) {
        r/=255; g/=255; b/=255;
        const mx=Math.max(r,g,b), mn=Math.min(r,g,b); let h,s,l=(mx+mn)/2;
        if (mx===mn) { h=s=0; }
        else { const dd=mx-mn; s=l>0.5?dd/(2-mx-mn):dd/(mx+mn);
          switch(mx){ case r: h=(g-b)/dd+(g<b?6:0); break; case g: h=(b-r)/dd+2; break; default: h=(r-g)/dd+4; }
          h/=6; }
        return [h,s,l];
      }
      function hslToRgb(h, s, l) {
        let r,g,b;
        if (s===0) { r=g=b=l; }
        else { const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1;
            if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
          const q=l<0.5?l*(1+s):l+s-l*s; const p=2*l-q;
          r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); }
        return [r*255, g*255, b*255];
      }

      // Levels: remap [black..white] to [0..255] with a gamma curve for midtones.
      function applyLevels() {
        const l = active(); if (!l) return;
        const black = parseInt($('pi-lvl-black').value) || 0;
        const white = parseInt($('pi-lvl-white').value) || 255;
        const gamma = (parseInt($('pi-lvl-gamma').value) || 100) / 100;
        if (black >= white) return banner('Black point must be below white point.');
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) {
          let t = (v - black) / (white - black);
          t = Math.max(0, Math.min(1, t));
          t = Math.pow(t, 1 / gamma);
          lut[v] = Math.round(t * 255);
        }
        const img = l.ctx.getImageData(0, 0, W, H); const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i+3] === 0) continue;
          d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]];
        }
        l.ctx.putImageData(img, 0, 0); touch(l);
        composite(); pushHistory('Levels'); renderLayerList(); banner('Levels applied.');
      }

      // ── Curves ────────────────────────────────────────────────────────────
      // A draggable tone curve. Control points are held in 0..1 space; the curve is
      // a smooth monotonic interpolation used to build a 256-entry lookup table.
      let curvePts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      let curveDragIdx = -1;
      function drawCurveEditor() {
        const cv = $('pi-curve'); if (!cv) return;
        const c = cv.getContext('2d'); const w = cv.width, h = cv.height;
        c.clearRect(0, 0, w, h);
        // grid
        c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          c.beginPath(); c.moveTo(w*i/4, 0); c.lineTo(w*i/4, h); c.stroke();
          c.beginPath(); c.moveTo(0, h*i/4); c.lineTo(w, h*i/4); c.stroke();
        }
        // diagonal reference
        c.strokeStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.moveTo(0, h); c.lineTo(w, 0); c.stroke();
        // the curve
        const lut = curveLUT();
        c.strokeStyle = 'var(--accent)'; c.strokeStyle = '#6ea8fe'; c.lineWidth = 2;
        c.beginPath();
        for (let x = 0; x < 256; x++) {
          const px = (x/255)*w, py = h - (lut[x]/255)*h;
          if (x===0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
        // control points
        curvePts.forEach((p, i) => {
          c.fillStyle = i === curveDragIdx ? '#fff' : '#6ea8fe';
          c.beginPath(); c.arc(p.x*w, h - p.y*h, 4, 0, Math.PI*2); c.fill();
        });
      }
      function curveLUT() {
        const pts = [...curvePts].sort((a,b)=>a.x-b.x);
        const lut = new Uint8ClampedArray(256);
        for (let x = 0; x < 256; x++) {
          const t = x/255;
          // piecewise-linear between control points (monotonic, predictable)
          let seg = 0;
          while (seg < pts.length-1 && t > pts[seg+1].x) seg++;
          const a = pts[seg], b = pts[Math.min(seg+1, pts.length-1)];
          const span = (b.x - a.x) || 1;
          const f = Math.max(0, Math.min(1, (t - a.x)/span));
          lut[x] = Math.round((a.y + (b.y - a.y)*f) * 255);
        }
        return lut;
      }
      function applyCurve() {
        const l = active(); if (!l) return;
        const lut = curveLUT();
        const img = l.ctx.getImageData(0, 0, W, H); const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i+3] === 0) continue;
          d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]];
        }
        l.ctx.putImageData(img, 0, 0); touch(l);
        composite(); pushHistory('Curves'); renderLayerList(); banner('Curve applied.');
      }

      // Drag control points to bend the curve; click empty space adds a point.
      function wireCurveEditor() {
        const cv = $('pi-curve'); if (!cv) return;
        const ptAt = (e) => {
          const r = cv.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = 1 - (e.clientY - r.top) / r.height;
          return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
        };
        const nearest = (p) => {
          let bi = -1, bd = 0.05*0.05;
          curvePts.forEach((q, i) => { const d=(q.x-p.x)**2+(q.y-p.y)**2; if (d<bd){bd=d;bi=i;} });
          return bi;
        };
        cv.addEventListener('pointerdown', (e) => {
          e.preventDefault(); cv.setPointerCapture(e.pointerId);
          const p = ptAt(e);
          let idx = nearest(p);
          if (idx < 0) { curvePts.push(p); curvePts.sort((a,b)=>a.x-b.x); idx = curvePts.indexOf(p); }
          curveDragIdx = idx; drawCurveEditor();
        });
        cv.addEventListener('pointermove', (e) => {
          if (curveDragIdx < 0) return;
          e.preventDefault();
          const p = ptAt(e);
          const pt = curvePts[curveDragIdx];
          if (curveDragIdx > 0 && curveDragIdx < curvePts.length-1) pt.x = p.x;
          pt.y = p.y;
          curvePts.sort((a,b)=>a.x-b.x);
          curveDragIdx = curvePts.indexOf(pt);
          drawCurveEditor();
        });
        const end = () => { curveDragIdx = -1; drawCurveEditor(); };
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
      }

      // ── One-click filters ──────────────────────────────────────────────────
      function filterPixels(fn, label) {
        const l = active(); if (!l) return;
        const img = l.ctx.getImageData(0, 0, W, H); const d = img.data;
        fn(d);
        l.ctx.putImageData(img, 0, 0); touch(l);
        composite(); pushHistory(label); renderLayerList(); banner(label + ' applied.');
      }
      function invertLayer() {
        filterPixels(d => { for (let i=0;i<d.length;i+=4){ if(d[i+3]===0)continue; d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; } }, 'Invert');
      }
      function thresholdLayer() {
        filterPixels(d => { for (let i=0;i<d.length;i+=4){ if(d[i+3]===0)continue;
          const v = 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; const t = v>=128?255:0;
          d[i]=d[i+1]=d[i+2]=t; } }, 'Threshold');
      }
      function posterizeLayer() {
        const levels = 4; const step = 255/(levels-1);
        filterPixels(d => { for (let i=0;i<d.length;i+=4){ if(d[i+3]===0)continue;
          d[i]=Math.round(d[i]/step)*step; d[i+1]=Math.round(d[i+1]/step)*step; d[i+2]=Math.round(d[i+2]/step)*step; } }, 'Posterize');
      }
      function grayscaleLayer() {
        filterPixels(d => { for (let i=0;i<d.length;i+=4){ if(d[i+3]===0)continue;
          const v = 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; d[i]=d[i+1]=d[i+2]=v; } }, 'Grayscale');
      }
      function sharpenLayer() {
        const l = active(); if (!l) return;
        const src = l.ctx.getImageData(0, 0, W, H); const s = src.data;
        const out = l.ctx.createImageData(W, H); const o = out.data;
        // 3x3 sharpen kernel
        const k = [0,-1,0,-1,5,-1,0,-1,0];
        for (let y=0;y<H;y++) for (let x=0;x<W;x++){
          const idx=(y*W+x)*4;
          if (s[idx+3]===0){ o[idx]=s[idx];o[idx+1]=s[idx+1];o[idx+2]=s[idx+2];o[idx+3]=s[idx+3]; continue; }
          for (let ch=0;ch<3;ch++){
            let acc=0, ki=0;
            for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
              const xx=Math.min(W-1,Math.max(0,x+dx)), yy=Math.min(H-1,Math.max(0,y+dy));
              acc += s[(yy*W+xx)*4+ch]*k[ki++];
            }
            o[idx+ch]=Math.max(0,Math.min(255,acc));
          }
          o[idx+3]=s[idx+3];
        }
        l.ctx.putImageData(out, 0, 0); touch(l);
        composite(); pushHistory('Sharpen'); renderLayerList(); banner('Sharpen applied.');
      }

      function blurLayer() {
        const l = active(); if (!l) return;
        const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
        const tc = tmp.getContext('2d');
        tc.filter = 'blur(2px)'; tc.drawImage(l.canvas, 0, 0);
        l.ctx.clearRect(0,0,W,H); l.ctx.drawImage(tmp, 0, 0);
        composite(); pushHistory(); renderLayerList(); banner('Blurred.');
      }
      function flip(horiz) {
        const l = active(); if (!l) return;
        const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
        const tc = tmp.getContext('2d');
        tc.translate(horiz ? W : 0, horiz ? 0 : H);
        tc.scale(horiz ? -1 : 1, horiz ? 1 : -1);
        tc.drawImage(l.canvas, 0, 0);
        l.ctx.setTransform(1,0,0,1,0,0);
        l.ctx.clearRect(0,0,W,H); l.ctx.drawImage(tmp, 0, 0);
        if (l.kind === 'vector') { l.shapes = []; l.kind = 'raster'; banner('Flipped (vector baked to pixels).'); }
        composite(); pushHistory(); renderLayerList();
      }


      // ── Whole-image operations (Image menu) ────────────────────────────────
      // Crop, trim, rotate and flip apply to every layer (and its mask) at once,
      // like Photoshop's Image menu. Vector and text layers are baked to pixels
      // first because their shapes can't follow an arbitrary canvas change.
      function transformWholeCanvas(nw, nh, draw, label) {
        if (liveText) commitText();
        if (floatSel) dropSelection();
        if (typeof maskEditing !== 'undefined' && maskEditing) { layers.forEach(restoreFromMask); maskEditing = false; syncMaskButton(); }
        let baked = 0;
        const conv = (src) => { const t = document.createElement('canvas'); t.width = nw; t.height = nh;
          const c = t.getContext('2d', { willReadFrequently: true }); c.imageSmoothingEnabled = false; draw(c, src); return t; };
        layers.forEach(l => {
          if (l.kind === 'group') return;
          if ((l.shapes && l.shapes.length) || (l.texts && l.texts.length)) { baked++; l.shapes = []; l.texts = []; if (l.kind !== 'raster') l.kind = 'raster'; }
          l.canvas = conv(l.canvas); l.ctx = l.canvas.getContext('2d', { willReadFrequently: true });
          if (l.mask) { l.mask = conv(l.mask); l.maskCtx = l.mask.getContext('2d', { willReadFrequently: true }); l._maskRev = (l._maskRev || 0) + 1; }
        });
        W = nw; H = nh; view.width = W; view.height = H;
        sel = null; selBounds = null;
        if ($('pi-w')) { $('pi-w').value = W; if ($('pi-w-val')) $('pi-w-val').textContent = W + ' px'; }
        if ($('pi-h')) { $('pi-h').value = H; if ($('pi-h-val')) $('pi-h-val').textContent = H + ' px'; }
        touchAll(); fitZoom(); composite(); pushHistory(label); renderLayerList();
        banner(label + ` — canvas is now ${W}×${H}` + (baked ? ` (${baked} vector/text layer${baked > 1 ? 's' : ''} baked to pixels).` : '.'));
      }
      function cropToRect(x0, y0, w, h, label) {
        if (w < 1 || h < 1) return banner('Nothing to crop to.');
        transformWholeCanvas(w, h, (c, src) => c.drawImage(src, -x0, -y0), label);
      }
      function imageCropToSelection() {
        if (!sel || !selBounds) return banner('Make a selection first, then Crop to selection.');
        const b = selBounds;
        cropToRect(b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, 'Cropped to selection');
      }
      function imageTrim() {
        const d = flatten().getContext('2d').getImageData(0, 0, W, H).data;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) return banner('The canvas is empty — nothing to trim to.');
        if (x0 === 0 && y0 === 0 && x1 === W - 1 && y1 === H - 1) return banner('No empty edges to trim.');
        cropToRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, 'Trimmed empty edges');
      }
      function imageRotate(deg) {
        const q = ((deg % 360) + 360) % 360;
        const nw = q === 180 ? W : H, nh = q === 180 ? H : W;
        transformWholeCanvas(nw, nh, (c, src) => {
          if (q === 90) { c.translate(nw, 0); c.rotate(Math.PI / 2); }
          else if (q === 270) { c.translate(0, nh); c.rotate(-Math.PI / 2); }
          else { c.translate(nw, nh); c.rotate(Math.PI); }
          c.drawImage(src, 0, 0);
        }, q === 90 ? 'Rotated 90° clockwise' : q === 270 ? 'Rotated 90° anticlockwise' : 'Rotated 180°');
      }
      function imageFlip(horiz) {
        transformWholeCanvas(W, H, (c, src) => {
          if (horiz) { c.translate(W, 0); c.scale(-1, 1); } else { c.translate(0, H); c.scale(1, -1); }
          c.drawImage(src, 0, 0);
        }, horiz ? 'Flipped canvas horizontally' : 'Flipped canvas vertically');
      }
      // Grow / shrink the selection by a number of pixels (square dilate/erode,
      // done as separable passes so it stays fast on big canvases).
      function selectionModify(px) {
        if (!sel) return banner('Make a selection first.');
        const r = Math.abs(px) | 0; if (!r) return;
        const grow = px > 0;
        let a = sel, b = new Uint8Array(W * H);
        const pass = (src, dst, horiz) => {
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let v = grow ? 0 : 1;
            for (let k = -r; k <= r; k++) {
              const xx = horiz ? x + k : x, yy = horiz ? y : y + k;
              const inside = xx >= 0 && yy >= 0 && xx < W && yy < H ? src[yy * W + xx] : 0;
              if (grow && inside) { v = 1; break; }
              if (!grow && !inside) { v = 0; break; }
            }
            dst[y * W + x] = v;
          }
        };
        pass(a, b, true); const c2 = new Uint8Array(W * H); pass(b, c2, false);
        selFromMask(c2); composite();
        banner((grow ? 'Grew' : 'Shrank') + ` the selection by ${r} px.`);
      }
      window.msImageOps = { crop: imageCropToSelection, trim: imageTrim, rotate: imageRotate, flip: imageFlip,
                            invertSel: () => { invertSelection(); banner('Selection inverted.'); }, modifySel: selectionModify };

      // Bring an image file in as its own layer, scaled to fit the canvas.
      function placeImage(f) {
        if (!f) return;
        // Photoshop files: import each PSD layer as its own paint layer.
        if (/\.psd$/i.test(f.name || '') || f.type === 'image/vnd.adobe.photoshop') {
          placePSD(f);
          return;
        }
        const img = new Image();
        img.onload = () => {
          const name = (f.name || 'Image').replace(/\.[^.]+$/, '');
          const l = addLayer('raster', name);
          const s = Math.min(W / img.width, H / img.height, 1);
          const dw = img.width * s, dh = img.height * s;
          l.ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
          composite(); renderLayerList(); pushHistory();
          banner(`Added "${name}" (${img.width}×${img.height}).`);
          URL.revokeObjectURL(img.src);
        };
        img.onerror = () => banner('Couldn\'t read that image — try PNG, JPG, BMP, GIF or WebP.');
        img.src = URL.createObjectURL(f);
      }

      // Import a layered Photoshop (.psd) file. Each PSD layer becomes a paint layer,
      // preserving name, opacity, blend mode and visibility. RGB / 8-bit files import
      // fully; anything the parser can't read (16/32-bit, CMYK) falls back to loading
      // the file as a single flattened image so the user still gets their artwork.
      function placePSD(f) {
        const reader = new FileReader();
        reader.onload = () => {
         try {
          let psd;
          try { psd = window.parsePSD(reader.result); }
          catch (err) {
            banner('This PSD needs flattening — importing a single combined layer.');
            placePSDFallback(f);
            return;
          }
          const layers2 = (psd.layers || []).filter(l => l.rgba && l.width > 0 && l.height > 0);
          if (!layers2.length) { placePSDFallback(f); return; }
          const base = (f.name || 'PSD').replace(/\.[^.]+$/, '');
          // PSD stores layers bottom-first; add in that order so stacking matches.
          // Build all layers directly (bypassing addLayer's per-layer composite/history)
          // so a 20-layer PSD is one undo step and one repaint, not twenty.
          exitMaskEdit();
          const scale = Math.min(W / psd.width, H / psd.height, 1);
          const ox = (W - psd.width * scale) / 2, oy = (H - psd.height * scale) / 2;
          let added = 0, lastId = null, fxImported = 0;
          layers2.forEach((pl, i) => {
            const name = pl.name || (base + ' ' + (i + 1));
            const layer = makeLayer(name, 'raster');
            const tmp = document.createElement('canvas');
            tmp.width = pl.rgba.width; tmp.height = pl.rgba.height;
            tmp.getContext('2d').putImageData(new ImageData(pl.rgba.data, pl.rgba.width, pl.rgba.height), 0, 0);
            layer.ctx.drawImage(tmp, ox + pl.left * scale, oy + pl.top * scale, pl.rgba.width * scale, pl.rgba.height * scale);
            if (typeof pl.opacity === 'number') layer.opacity = Math.max(0, Math.min(1, pl.opacity / 255));
            if (pl.blend) layer.blend = pl.blend;
            if (pl.hidden) layer.visible = false;
            // Bring across any layer effects Photoshop stored with this layer.
            // Merge onto our defaults so anything the PSD didn't specify keeps a
            // sensible value, and anything we can't read simply stays off.
            if (pl.fx) {
              const base = defaultFX();
              Object.keys(pl.fx).forEach(k => { if (base[k]) base[k] = Object.assign(base[k], pl.fx[k]); });
              layer.fx = base;
              fxImported++;
            }
            touch(layer);
            layers.push(layer);
            lastId = layer.id;
            added++;
          });
          if (lastId) activeId = lastId;
          composite(); renderLayerList(); pushHistory();
          banner(`Imported "${base}" — ${added} layer${added === 1 ? '' : 's'}` +
                 (fxImported ? `, ${fxImported} with effects` : '') + ` (${psd.width}×${psd.height}).`);
         } catch (err) {
          banner('Couldn\'t import that PSD: ' + (err && err.message || err));
          console.error('PSD import error:', err);
         }
        };
        reader.onerror = () => banner('Couldn\'t read that PSD file.');
        reader.readAsArrayBuffer(f);
      }

      // When a PSD can't be parsed as layers, browsers can't decode PSD as an image
      // either, so we can't recover a preview. Tell the user plainly.
      function placePSDFallback(f) {
        const img = new Image();
        img.onload = () => {
          const name = (f.name || 'PSD').replace(/\.[^.]+$/, '');
          const l = addLayer('raster', name);
          const s = Math.min(W / img.width, H / img.height, 1);
          l.ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
          composite(); renderLayerList(); pushHistory();
          banner(`Added "${name}" as a single layer.`);
          URL.revokeObjectURL(img.src);
        };
        img.onerror = () => banner('This PSD uses a mode ModelSmith can\'t read (e.g. 16-bit or CMYK). Re-save it as 8-bit RGB, or export a PNG.');
        img.src = URL.createObjectURL(f);
      }

      // ── Flatten / export ────────────────────────────────────────────────────
      function flatten() {
        const out = document.createElement('canvas'); out.width = W; out.height = H;
        const c = out.getContext('2d');
        layers.forEach(l => {
          if (l.kind === 'group') return;
          if (!effVisible(l) || effOpacity(l) <= 0) return;
          c.globalAlpha = effOpacity(l); c.globalCompositeOperation = l.blend || 'source-over';
          c.drawImage(fxActive(l) ? renderLayerWithFX(l, l.canvas) : l.canvas, 0, 0);
        });
        return out;
      }
      function downloadCanvas(cv, name) {
        cv.toBlob(b => {
          const url = URL.createObjectURL(b);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
      }


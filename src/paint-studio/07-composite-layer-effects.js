      // ── Composite ───────────────────────────────────────────────────────────
      // ── Layer effects ───────────────────────────────────────────────────────
      // Photoshop-style non-destructive effects. Each layer may carry an `fx`
      // object; the pixels on the layer itself are never modified, so effects can
      // be re-tuned or switched off at any time.
      //
      // Render order matches Photoshop: outer effects (drop shadow, outer glow)
      // paint BELOW the layer, then the layer, then inner effects (inner shadow,
      // inner glow, bevel) and finally the stroke on top.
      function defaultFX() {
        return {
          shadow: { on:false, color:'#000000', opacity:0.5, blur:8,  dx:4, dy:4, spread:0, blend:'normal' },
          glowOut:{ on:false, color:'#ffd479', opacity:0.7, blur:12, spread:0, blend:'normal' },
          innerShadow:{ on:false, color:'#000000', opacity:0.5, blur:8, dx:2, dy:2, blend:'normal' },
          innerGlow:{ on:false, color:'#ffffff', opacity:0.6, blur:10, blend:'normal' },
          satin:  { on:false, color:'#000000', opacity:0.4, blur:14, dx:10, dy:10, invert:true, blend:'multiply' },
          colorOv:{ on:false, color:'#c2895f', opacity:1, blend:'normal' },
          gradOv: { on:false, opacity:1, blend:'normal', angle:90, style:'linear',
                    c1:'#c2895f', c2:'#5dd6ff', reverse:false },
          patternOv:{ on:false, opacity:0.5, blend:'normal', kind:'checks', scale:16,
                    color:'#000000' },
          stroke: { on:false, color:'#000000', opacity:1, width:3, align:'outside', blend:'normal',
                    fill:'solid', c1:'#c2895f', c2:'#5dd6ff', angle:90 },
          bevel:  { on:false, depth:4, blur:4, light:0.6, shadow:0.6, angle:135, style:'inner' }
        };
      }
      // Effect blend modes reuse canvas composite ops; 'normal' maps to source-over.
      const FX_BLEND = { normal:'source-over', multiply:'multiply', screen:'screen',
        overlay:'overlay', darken:'darken', lighten:'lighten', 'color-dodge':'color-dodge',
        'color-burn':'color-burn', 'hard-light':'hard-light', 'soft-light':'soft-light',
        difference:'difference', exclusion:'exclusion', hue:'hue', saturation:'saturation',
        color:'color', luminosity:'luminosity' };
      const fxOp = (b) => FX_BLEND[b] || 'source-over';
      // Return a layer's effects with every key guaranteed present.
      //
      // The renderer reads f.stroke.on, f.satin.on and so on directly, so a single
      // missing key threw a TypeError mid-composite — and because that happened
      // partway through drawing, the layer rendered as nothing at all. Any FX
      // object that didn't carry all ten effects would do it: PSD imports that
      // only specify the effects the file actually uses, effects saved by an older
      // build, or a hand-set object. Filling in the defaults makes the renderer
      // safe against partial data instead of relying on every producer to be
      // exhaustive. The merged result is cached on the layer so this isn't redone
      // on every frame.
      function layerFX(l) {
        if (!l || !l.fx) return null;
        const keys = ['shadow','glowOut','innerShadow','innerGlow','satin','colorOv','gradOv','patternOv','stroke','bevel'];
        let missing = false;
        for (const k of keys) { if (!l.fx[k]) { missing = true; break; } }
        if (missing) {
          const base = defaultFX();
          for (const k of keys) {
            l.fx[k] = Object.assign(base[k], l.fx[k] || {});
          }
        }
        return l.fx;
      }
      const FX_KEYS = ['shadow','glowOut','innerShadow','innerGlow','satin','colorOv','gradOv','patternOv','stroke','bevel'];
      function fxActive(l) {
        const f = layerFX(l); if (!f) return false;
        return FX_KEYS.some(k => f[k] && f[k].on);
      }
      const _fxPool = {};
      function fxCanvas(key) {
        const c = _fxPool[key] || (_fxPool[key] = document.createElement('canvas'));
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        const x = c.getContext('2d', { willReadFrequently: true });
        x.setTransform(1,0,0,1,0,0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
        x.filter = 'none'; x.clearRect(0,0,W,H);
        return { c, x };
      }
      // A gradient spanning the canvas at the given angle (degrees, 0 = left→right).
      function fxGradient(ctx, angle, c1, c2, style, reverse) {
        let g;
        if (style === 'radial') {
          g = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)/2);
        } else {
          const rad = (angle || 0) * Math.PI / 180;
          const dx = Math.cos(rad), dy = -Math.sin(rad);
          const half = (Math.abs(dx)*W + Math.abs(dy)*H) / 2;
          g = ctx.createLinearGradient(W/2 - dx*half, H/2 - dy*half, W/2 + dx*half, H/2 + dy*half);
        }
        const a = reverse ? c2 : c1, b = reverse ? c1 : c2;
        g.addColorStop(0, a); g.addColorStop(1, b);
        return g;
      }
      // Simple procedural patterns — no external assets, so this still works offline.
      function fxPattern(kind, scale, colour, key) {
        const { c, x } = fxCanvas(key);
        const s = Math.max(2, scale | 0);
        x.fillStyle = colour;
        if (kind === 'checks') {
          for (let y = 0; y < H; y += s) for (let px = 0; px < W; px += s)
            if (((px / s | 0) + (y / s | 0)) % 2 === 0) x.fillRect(px, y, s, s);
        } else if (kind === 'stripes') {
          for (let px = -H; px < W; px += s * 2) {
            x.save(); x.translate(px, 0); x.rotate(-Math.PI/4);
            x.fillRect(0, 0, s, (W + H) * 2); x.restore();
          }
        } else if (kind === 'dots') {
          for (let y = s/2; y < H; y += s) for (let px = s/2; px < W; px += s) {
            x.beginPath(); x.arc(px, y, s * 0.28, 0, Math.PI*2); x.fill();
          }
        } else if (kind === 'grid') {
          x.strokeStyle = colour; x.lineWidth = Math.max(1, s/10);
          for (let px = 0; px <= W; px += s) { x.beginPath(); x.moveTo(px,0); x.lineTo(px,H); x.stroke(); }
          for (let y = 0; y <= H; y += s) { x.beginPath(); x.moveTo(0,y); x.lineTo(W,y); x.stroke(); }
        } else if (kind === 'noise') {
          const img = x.createImageData(W, H); const d = img.data;
          const rgb = fxHexToRgb(colour);
          for (let i = 0; i < d.length; i += 4) {
            const v = Math.random();
            d[i]=rgb.r; d[i+1]=rgb.g; d[i+2]=rgb.b; d[i+3]= v > 0.5 ? 255 : 0;
          }
          x.putImageData(img, 0, 0);
        }
        return c;
      }
      function fxHexToRgb(h) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || '#000000');
        return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : { r:0,g:0,b:0 };
      }
      // Fill the shape's silhouette with an arbitrary paint (gradient / pattern / colour).
      function fxFillShape(shape, paintFn, key) {
        const { c, x } = fxCanvas(key);
        x.drawImage(shape, 0, 0);
        x.globalCompositeOperation = 'source-in';
        paintFn(x);
        return c;
      }
      // A solid colour shaped like `src`'s alpha — the basis of shadows and glows.
      function fxSilhouette(src, colour, key) {
        const { c, x } = fxCanvas(key);
        x.drawImage(src, 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = colour; x.fillRect(0,0,W,H);
        return c;
      }
      // Grow (or shrink) an alpha shape by redrawing it offset in a ring. Canvas has
      // no dilate, so this approximates one — good enough for spread and stroke.
      function fxSpread(src, amount, key) {
        if (amount <= 0) return src;
        const { c, x } = fxCanvas(key);
        const steps = Math.min(16, Math.max(8, Math.round(amount * 2)));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          x.drawImage(src, Math.cos(a) * amount, Math.sin(a) * amount);
        }
        x.drawImage(src, 0, 0);
        return c;
      }
      // Inverted alpha of a shape, clipped back to the shape — used by inner effects.
      function fxInnerMask(shape, blur, dx, dy, colour, key) {
        const { c, x } = fxCanvas(key);
        // fill the whole plane, then punch the shape out of it (offset if asked),
        // blur the result, and finally clip to the original shape
        x.fillStyle = colour; x.fillRect(0,0,W,H);
        x.globalCompositeOperation = 'destination-out';
        if (blur > 0) x.filter = `blur(${blur}px)`;
        x.drawImage(shape, dx, dy);
        x.filter = 'none';
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(shape, 0, 0);
        return c;
      }
      // Draw everything that belongs UNDER the layer pixels.
      function fxDrawBelow(ctx, shape, f) {
        if (f.glowOut.on && f.glowOut.opacity > 0) {
          const grown = fxSpread(shape, f.glowOut.spread || 0, 'gspread');
          const sil = fxSilhouette(grown, f.glowOut.color, 'gsil');
          ctx.save();
          ctx.globalAlpha = f.glowOut.opacity;
          ctx.globalCompositeOperation = fxOp(f.glowOut.blend);
          if (f.glowOut.blur > 0) ctx.filter = `blur(${f.glowOut.blur}px)`;
          ctx.drawImage(sil, 0, 0);
          ctx.restore();
        }
        if (f.shadow.on && f.shadow.opacity > 0) {
          const grown = fxSpread(shape, f.shadow.spread || 0, 'sspread');
          const sil = fxSilhouette(grown, f.shadow.color, 'ssil');
          ctx.save();
          ctx.globalAlpha = f.shadow.opacity;
          ctx.globalCompositeOperation = fxOp(f.shadow.blend);
          if (f.shadow.blur > 0) ctx.filter = `blur(${f.shadow.blur}px)`;
          ctx.drawImage(sil, f.shadow.dx, f.shadow.dy);
          ctx.restore();
        }
      }
      // Draw everything that belongs ON TOP of the layer pixels.
      function fxDrawAbove(ctx, shape, f) {
        if (f.innerShadow.on && f.innerShadow.opacity > 0) {
          const m = fxInnerMask(shape, f.innerShadow.blur, f.innerShadow.dx, f.innerShadow.dy, f.innerShadow.color, 'ish');
          ctx.save(); ctx.globalAlpha = f.innerShadow.opacity;
          ctx.globalCompositeOperation = fxOp(f.innerShadow.blend);
          ctx.drawImage(m, 0, 0); ctx.restore();
        }
        if (f.innerGlow.on && f.innerGlow.opacity > 0) {
          const m = fxInnerMask(shape, f.innerGlow.blur, 0, 0, f.innerGlow.color, 'igl');
          ctx.save(); ctx.globalAlpha = f.innerGlow.opacity;
          ctx.globalCompositeOperation = fxOp(f.innerGlow.blend);
          ctx.drawImage(m, 0, 0); ctx.restore();
        }
        // Satin: the shape blurred against an offset copy of itself, clipped inside.
        // Gives the soft folded-fabric sheen Photoshop produces.
        if (f.satin.on && f.satin.opacity > 0) {
          const sil = fxSilhouette(shape, f.satin.color, 'satsil');
          const { c, x } = fxCanvas('satin');
          if (f.satin.blur > 0) x.filter = `blur(${f.satin.blur}px)`;
          x.drawImage(sil, f.satin.dx, f.satin.dy);
          x.drawImage(sil, -f.satin.dx, -f.satin.dy);
          x.filter = 'none';
          if (f.satin.invert) {
            // invert alpha within the shape so the sheen sits in the gaps
            const inv = fxCanvas('satinv');
            inv.x.drawImage(fxSilhouette(shape, f.satin.color, 'satsil2'), 0, 0);
            inv.x.globalCompositeOperation = 'destination-out';
            inv.x.drawImage(c, 0, 0);
            x.clearRect(0,0,W,H);
            x.drawImage(inv.c, 0, 0);
          }
          x.globalCompositeOperation = 'destination-in';
          x.drawImage(shape, 0, 0);
          ctx.save(); ctx.globalAlpha = f.satin.opacity;
          ctx.globalCompositeOperation = fxOp(f.satin.blend);
          ctx.drawImage(c, 0, 0); ctx.restore();
        }
        // Colour overlay
        if (f.colorOv.on && f.colorOv.opacity > 0) {
          const fill = fxFillShape(shape, (x) => { x.fillStyle = f.colorOv.color; x.fillRect(0,0,W,H); }, 'colov');
          ctx.save(); ctx.globalAlpha = f.colorOv.opacity;
          ctx.globalCompositeOperation = fxOp(f.colorOv.blend);
          ctx.drawImage(fill, 0, 0); ctx.restore();
        }
        // Gradient overlay
        if (f.gradOv.on && f.gradOv.opacity > 0) {
          const fill = fxFillShape(shape, (x) => {
            x.fillStyle = fxGradient(x, f.gradOv.angle, f.gradOv.c1, f.gradOv.c2, f.gradOv.style, f.gradOv.reverse);
            x.fillRect(0,0,W,H);
          }, 'gradov');
          ctx.save(); ctx.globalAlpha = f.gradOv.opacity;
          ctx.globalCompositeOperation = fxOp(f.gradOv.blend);
          ctx.drawImage(fill, 0, 0); ctx.restore();
        }
        // Pattern overlay
        if (f.patternOv.on && f.patternOv.opacity > 0) {
          const pat = fxPattern(f.patternOv.kind, f.patternOv.scale, f.patternOv.color, 'patsrc');
          const fill = fxFillShape(shape, (x) => { x.drawImage(pat, 0, 0); }, 'patov');
          ctx.save(); ctx.globalAlpha = f.patternOv.opacity;
          ctx.globalCompositeOperation = fxOp(f.patternOv.blend);
          ctx.drawImage(fill, 0, 0); ctx.restore();
        }
        if (f.bevel.on) {
          // Emboss: a light pass offset toward the light, a dark pass away from it,
          // both clipped inside the shape. Cheap, but reads convincingly as relief.
          const rad = (f.bevel.angle || 135) * Math.PI / 180;
          const ox = Math.cos(rad) * (f.bevel.depth || 4);
          const oy = -Math.sin(rad) * (f.bevel.depth || 4);
          const lit = fxInnerMask(shape, f.bevel.blur, ox, oy, '#ffffff', 'bvl');
          ctx.save(); ctx.globalAlpha = f.bevel.light; ctx.globalCompositeOperation = 'screen';
          ctx.drawImage(lit, 0, 0); ctx.restore();
          const drk = fxInnerMask(shape, f.bevel.blur, -ox, -oy, '#000000', 'bvd');
          ctx.save(); ctx.globalAlpha = f.bevel.shadow; ctx.globalCompositeOperation = 'multiply';
          ctx.drawImage(drk, 0, 0); ctx.restore();
        }
        if (f.stroke.on && f.stroke.width > 0 && f.stroke.opacity > 0) {
          const w = f.stroke.width;
          const grown = fxSpread(shape, w, 'stgrow');
          const { c, x } = fxCanvas('stroke');
          x.drawImage(grown, 0, 0);
          if (f.stroke.align === 'outside') {
            // ring = grown minus original
            x.globalCompositeOperation = 'destination-out';
            x.drawImage(shape, 0, 0);
          } else if (f.stroke.align === 'inside') {
            // ring = original minus shrunk; approximate by clipping the ring inside
            const { c: c2, x: x2 } = fxCanvas('stroke2');
            x2.drawImage(shape, 0, 0);
            x2.globalCompositeOperation = 'destination-out';
            // shrink: erase a grown copy of the inverse
            const inv = fxCanvas('stinv');
            inv.x.fillStyle = '#fff'; inv.x.fillRect(0,0,W,H);
            inv.x.globalCompositeOperation = 'destination-out';
            inv.x.drawImage(shape, 0, 0);
            const invGrown = fxSpread(inv.c, w, 'stinvg');
            x2.drawImage(invGrown, 0, 0);
            x.globalCompositeOperation = 'source-over';
            x.clearRect(0,0,W,H);
            x.drawImage(shape, 0, 0);
            x.globalCompositeOperation = 'destination-out';
            x.drawImage(c2, 0, 0);
          } else { // centre
            // A centred stroke straddles the edge: half its width outside the
            // shape, half inside. So the ring is (shape grown by w/2) minus
            // (shape shrunk by w/2).
            //
            // The previous version started from the FULL-width grown shape and
            // subtracted a half-grown inverse, which cancelled out and left an
            // empty ring — centre strokes drew nothing at all.
            const halfGrown = fxSpread(shape, w / 2, 'stcgrow');
            // Shrink = invert, grow, invert back.
            const inv2 = fxCanvas('stinv2');
            inv2.x.fillStyle = '#fff'; inv2.x.fillRect(0, 0, W, H);
            inv2.x.globalCompositeOperation = 'destination-out';
            inv2.x.drawImage(shape, 0, 0);
            const invGrown2 = fxSpread(inv2.c, w / 2, 'stinvg2');
            const shrunk = fxCanvas('stshrunk');
            shrunk.x.drawImage(shape, 0, 0);
            shrunk.x.globalCompositeOperation = 'destination-out';
            shrunk.x.drawImage(invGrown2, 0, 0);
            // ring = halfGrown - shrunk
            x.globalCompositeOperation = 'source-over';
            x.clearRect(0, 0, W, H);
            x.drawImage(halfGrown, 0, 0);
            x.globalCompositeOperation = 'destination-out';
            x.drawImage(shrunk.c, 0, 0);
          }
          x.globalCompositeOperation = 'source-in';
          // Stroke can be a flat colour or its own gradient.
          if (f.stroke.fill === 'gradient') {
            x.fillStyle = fxGradient(x, f.stroke.angle, f.stroke.c1, f.stroke.c2, 'linear', false);
          } else {
            x.fillStyle = f.stroke.color;
          }
          x.fillRect(0,0,W,H);
          ctx.save(); ctx.globalAlpha = f.stroke.opacity;
          ctx.globalCompositeOperation = fxOp(f.stroke.blend);
          ctx.drawImage(c, 0, 0); ctx.restore();
        }
      }
      // Render one layer's pixels plus its effects into a single canvas, ready to be
      // composited with the layer's own blend mode and opacity.
      function renderLayerWithFX(l, pixels) {
        const f = layerFX(l);
        const { c, x } = fxCanvas('fxout');
        fxDrawBelow(x, pixels, f);
        x.drawImage(pixels, 0, 0);
        fxDrawAbove(x, pixels, f);
        return c;
      }

      // Draw one layer (mask, effects, blend, opacity, floating selection) onto `c`.
      // composite() calls this for the visible canvas; the stroke cache below calls it
      // to flatten the layers around the one being edited.
      function drawLayerTo(c, l) {
        if (l.kind === 'group') return;           // folder entries don't draw
        if (!effVisible(l) || effOpacity(l) <= 0) return;
        c.globalAlpha = effOpacity(l);
        c.globalCompositeOperation = l.blend || 'source-over';
        if (l.mask) {
          // Layer has a mask: it hides by LUMINANCE (black hides, white reveals),
          // which is how mask painting reads. Canvas composites on alpha, so we
          // convert the mask to a luminance→alpha ramp. That conversion is a full
          // pixel pass, so we cache it on the layer and only rebuild when the mask
          // actually changes (tracked by _maskRev).
          if (l._maskAlphaCanvas == null || l._maskAlphaRev !== l._maskRev) {
            const ma = l._maskAlphaCanvas || (l._maskAlphaCanvas = document.createElement('canvas'));
            ma.width = W; ma.height = H;
            const max = ma.getContext('2d', { willReadFrequently: true });
            max.clearRect(0,0,W,H); max.drawImage(l.mask, 0, 0);
            const mimg = max.getImageData(0,0,W,H); const md = mimg.data;
            for (let i=0;i<md.length;i+=4){
              const lum = 0.2126*md[i] + 0.7152*md[i+1] + 0.0722*md[i+2];
              md[i]=md[i+1]=md[i+2]=255; md[i+3]=lum*(md[i+3]/255);
            }
            max.putImageData(mimg,0,0);
            l._maskAlphaRev = l._maskRev;
          }
          const sc = _maskScratch || (_maskScratch = document.createElement('canvas'));
          sc.width = W; sc.height = H;
          const sx = sc.getContext('2d');
          sx.setTransform(1,0,0,1,0,0); sx.globalAlpha = 1; sx.globalCompositeOperation = 'source-over';
          sx.clearRect(0,0,W,H);
          sx.drawImage(l.canvas, 0, 0);
          sx.globalCompositeOperation = 'destination-in';
          sx.drawImage(l._maskAlphaCanvas, 0, 0);
          // Effects apply to the masked result, so a mask trims the glow/shadow too.
          c.drawImage(fxActive(l) ? renderLayerWithFX(l, sc) : sc, 0, 0);
        } else {
          c.drawImage(fxActive(l) ? renderLayerWithFX(l, l.canvas) : l.canvas, 0, 0);
        }
        // a lifted selection rides above its own layer until dropped
        if (floatSel && l.id === activeId) c.drawImage(floatSel.canvas, Math.round(floatSel.x), Math.round(floatSel.y));
      }

      // ── Stroke cache ───────────────────────────────────────────────────────
      // While a stroke/drag is in progress only the ACTIVE layer changes, yet every
      // redraw used to re-composite all layers at full canvas size. So after the
      // second redraw of a drag we flatten the layers below the active one (and
      // the ones above it, when they all use normal blending — otherwise they
      // depend on what's underneath and are drawn live) into two canvases, and each
      // redraw becomes: below, live active layer, above. The result is identical to
      // the full composite. The cache lives only while `drawing` is true and is
      // thrown away on pointer-down, on any change to a layer's properties or pixel
      // revision, and as soon as a composite happens with no drag in progress.
      let _sc = null, _scTicks = 0;
      function _scSig() {
        let s = activeId + '|' + W + 'x' + H + '|';
        for (const l of layers) {
          s += l.id + ':' + l.kind + ':' + (l.visible ? 1 : 0) + ':' + l.opacity + ':' + (l.blend || '') + ':' +
               (l.groupId || '') + ':' + (l.mask ? 'm' + (l._maskRev || 0) : '') + (fxActive(l) ? 'f' : '') +
               (l.id === activeId ? '' : ':' + (l._rev || 0)) + ';';
        }
        return s;
      }
      function _scBuild() {
        const idx = layers.findIndex(l => l.id === activeId);
        if (idx < 0) return null;
        const flat = (list) => {
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          const cx = cv.getContext('2d');
          list.forEach(l => drawLayerTo(cx, l));
          cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
          return cv;
        };
        const aboveList = layers.slice(idx + 1);
        const aboveNormal = aboveList.every(l => !l.blend || l.blend === 'source-over');
        return {
          sig: _scSig(), idx,
          below: idx > 0 ? flat(layers.slice(0, idx)) : null,
          above: aboveNormal && aboveList.length ? flat(aboveList) : null
        };
      }

      function composite() {
        if (!vctx) return;
        vctx.setTransform(1, 0, 0, 1, 0, 0);
        vctx.clearRect(0, 0, W, H);
        let sc = null;
        if (!drawing) { _sc = null; _scTicks = 0; }
        else if (layers.length >= 3 && ++_scTicks >= 2) {
          if (_sc && _sc.sig !== _scSig()) _sc = null;
          if (!_sc) _sc = _scBuild();
          sc = _sc;
        }
        if (sc) {
          if (sc.below) vctx.drawImage(sc.below, 0, 0);
          drawLayerTo(vctx, layers[sc.idx]);
          vctx.globalAlpha = 1; vctx.globalCompositeOperation = 'source-over';   // drawLayerTo leaves the layer's own blend/opacity set
          if (sc.above) vctx.drawImage(sc.above, 0, 0);
          else for (let i = sc.idx + 1; i < layers.length; i++) drawLayerTo(vctx, layers[i]);
        } else {
          layers.forEach(l => drawLayerTo(vctx, l));
        }
        vctx.globalAlpha = 1; vctx.globalCompositeOperation = 'source-over';
        // overlays sit on top of the artwork and are never baked into a layer
        if (!_inOverlay) {
          _inOverlay = true;
          drawAnts();
          drawVectorHandles();
          drawTransformOverlay();
          drawLiveText();
          drawPuppetOverlay();
          drawBrushCursor();
          _inOverlay = false;
        }
      }
      let _inOverlay = false;
      let _maskScratch = null;   // reused scratch canvas for masked layer compositing
      let _maskAlpha = null;     // reused luminance→alpha conversion of the mask

      // Marching-ants animation: only runs while a selection exists and the studio
      // is on screen, so it costs nothing the rest of the time.
      // Crawl the dashes slowly (~7px/sec) and only repaint ~12 times a second.
      // The old version advanced every frame, which read as a harsh flicker.
      let _antsLast = 0;
      function antsTick(ts) {
        const on = sel && $('paint-app') && $('paint-app').style.display !== 'none' && !drawing;
        if (on && ts - _antsLast > 80) {
          _antsLast = ts;
          selAnts = (selAnts + 0.6) % 7;
          composite();
        }
        requestAnimationFrame(antsTick);
      }

      // Re-draw a vector layer from its shape list.
      // Build the path for a shape into a 2D context. Shared by the live preview and
      // the committed vector render, so the two can never disagree about geometry.
      function shapePath(c, s) {
        const x1 = s.x1, y1 = s.y1, x2 = s.x2, y2 = s.y2;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
        // Regular n-gon inscribed in the drag box, flat-ish side down.
        const poly = (n, rot) => {
          for (let i = 0; i < n; i++) {
            const a = rot + (i * 2 * Math.PI) / n;
            const px = cx + rx * Math.cos(a), py = cy + ry * Math.sin(a);
            i ? c.lineTo(px, py) : c.moveTo(px, py);
          }
          c.closePath();
        };
        switch (s.type) {
          case 'line': c.moveTo(x1, y1); c.lineTo(x2, y2); break;
          case 'rect': c.rect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1)); break;
          case 'ellipse': c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); break;
          case 'triangle': poly(3, -Math.PI/2); break;
          case 'hexagon':  poly(6, -Math.PI/2); break;
          case 'polygon':  poly(s.sides || 5, -Math.PI/2); break;
          case 'star': {
            const n = s.points || 5, inner = (s.inner != null ? s.inner : 0.42);
            for (let i = 0; i < n * 2; i++) {
              const a = -Math.PI/2 + (i * Math.PI) / n;
              const f = i % 2 ? inner : 1;
              const px = cx + rx * f * Math.cos(a), py = cy + ry * f * Math.sin(a);
              i ? c.lineTo(px, py) : c.moveTo(px, py);
            }
            c.closePath();
            break;
          }
          case 'arrow': {
            // Shaft from the drag start to the head, with the head scaled to the
            // stroke width so it stays proportional at any size.
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            const head = Math.min(len * 0.34, Math.max(12, (s.width || 4) * 4));
            const halfW = head * 0.5;
            const bx = x2 - ux * head, by = y2 - uy * head;   // base of the head
            const px = -uy, py = ux;                          // perpendicular
            const shaft = Math.max(1, halfW * 0.34);
            c.moveTo(x1 + px * shaft, y1 + py * shaft);
            c.lineTo(bx + px * shaft, by + py * shaft);
            c.lineTo(bx + px * halfW, by + py * halfW);
            c.lineTo(x2, y2);
            c.lineTo(bx - px * halfW, by - py * halfW);
            c.lineTo(bx - px * shaft, by - py * shaft);
            c.lineTo(x1 - px * shaft, y1 - py * shaft);
            c.closePath();
            break;
          }
          case 'path':
            if (s.pts && s.pts.length > 1) {
              c.moveTo(s.pts[0].x, s.pts[0].y);
              for (let i = 1; i < s.pts.length; i++) c.lineTo(s.pts[i].x, s.pts[i].y);
              if (s.closed) c.closePath();
            }
            break;
        }
      }

      function renderVector(l) {
        const c = l.ctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, W, H);
        l.shapes.forEach(s => {
          c.save();
          c.lineCap = 'round'; c.lineJoin = 'round';
          c.strokeStyle = s.stroke || '#000'; c.fillStyle = s.fill || 'transparent';
          c.lineWidth = s.width || 2;
          c.beginPath();
          shapePath(c, s);
          if (s.fill && s.fill !== 'transparent') c.fill();
          if (s.strokeOn !== false) c.stroke();
          c.restore();
        });
      }

      // ── Free transform ──────────────────────────────────────────────────────
      // Lifts the selection (or whole layer) into a buffer and lets you scale,
      // rotate and move it via a bounding box before committing. Stored as centre,
      // scale (sx,sy) and angle; the buffer is redrawn through that each frame and
      // only baked back on Apply.
      let xform = null;

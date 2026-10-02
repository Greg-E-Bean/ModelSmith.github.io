      // ── Extra filters ───────────────────────────────────────────────────────
      // Each works on the active layer's pixels and pushes one history step, so a
      // filter can be undone like any other edit.
      function pixelOp(fn, label) {
        const l = active();
        if (!l || l.kind === 'group') return banner('Select a layer first.');
        const img = l.ctx.getImageData(0, 0, W, H);
        fn(img.data, W, H);
        l.ctx.putImageData(img, 0, 0);
        touch(l); composite(); pushHistory(); saveSoon();
        if (label) banner(label);
      }
      // A 3x3 convolution, used by emboss and edge detection. Reads from a copy so
      // neighbouring results don't feed back into each other mid-pass.
      function convolve3(data, w, h, k, bias, mono) {
        const src = new Uint8ClampedArray(data);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let r=0, g=0, b=0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const xx = Math.min(w-1, Math.max(0, x+i)), yy = Math.min(h-1, Math.max(0, y+j));
            const o = (yy*w + xx) * 4, kv = k[(j+1)*3 + (i+1)];
            r += src[o]*kv; g += src[o+1]*kv; b += src[o+2]*kv;
          }
          const o = (y*w + x) * 4;
          if (mono) { const v = (r+g+b)/3 + bias; data[o]=data[o+1]=data[o+2]=v; }
          else { data[o]=r+bias; data[o+1]=g+bias; data[o+2]=b+bias; }
        }
      }
      function filterSepia() {
        pixelOp(d => {
          for (let i = 0; i < d.length; i += 4) {
            const r=d[i], g=d[i+1], b=d[i+2];
            d[i]   = r*0.393 + g*0.769 + b*0.189;
            d[i+1] = r*0.349 + g*0.686 + b*0.168;
            d[i+2] = r*0.272 + g*0.534 + b*0.131;
          }
        }, 'Sepia applied.');
      }
      function filterEmboss() {
        pixelOp((d,w,h) => convolve3(d, w, h, [-2,-1,0, -1,1,1, 0,1,2], 0, true), 'Emboss applied.');
      }
      function filterEdges() {
        pixelOp((d,w,h) => convolve3(d, w, h, [0,1,0, 1,-4,1, 0,1,0], 128, true), 'Edges found.');
      }
      function filterNoise() {
        pixelOp(d => {
          for (let i = 0; i < d.length; i += 4) {
            const n = (Math.random() - 0.5) * 60;
            d[i] += n; d[i+1] += n; d[i+2] += n;      // same offset keeps hue intact
          }
        }, 'Noise added.');
      }
      function filterPixelate() {
        const size = 10;
        pixelOp((d,w,h) => {
          for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
            let r=0,g=0,b=0,a=0,n=0;
            for (let j = 0; j < size && y+j < h; j++) for (let i = 0; i < size && x+i < w; i++) {
              const o = ((y+j)*w + (x+i))*4;
              r+=d[o]; g+=d[o+1]; b+=d[o+2]; a+=d[o+3]; n++;
            }
            r/=n; g/=n; b/=n; a/=n;
            for (let j = 0; j < size && y+j < h; j++) for (let i = 0; i < size && x+i < w; i++) {
              const o = ((y+j)*w + (x+i))*4;
              d[o]=r; d[o+1]=g; d[o+2]=b; d[o+3]=a;
            }
          }
        }, 'Pixelated.');
      }
      function filterVignette() {
        pixelOp((d,w,h) => {
          const cx = w/2, cy = h/2, max = Math.hypot(cx, cy);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const o = (y*w + x)*4;
            const t = Math.hypot(x-cx, y-cy) / max;
            const f = 1 - Math.pow(Math.max(0, t - 0.45) / 0.55, 2) * 0.85;
            d[o]*=f; d[o+1]*=f; d[o+2]*=f;
          }
        }, 'Vignette applied.');
      }
      function filterRipple() {
        const l = active();
        if (!l || l.kind === 'group') return banner('Select a layer first.');
        const src = document.createElement('canvas');
        src.width = W; src.height = H;
        src.getContext('2d').drawImage(l.canvas, 0, 0);
        const s = src.getContext('2d').getImageData(0,0,W,H).data;
        const out = l.ctx.getImageData(0,0,W,H);
        const d = out.data;
        const amp = 12, len = 40;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const sx = Math.round(x + Math.sin(y / len) * amp);
          const sy = Math.round(y + Math.sin(x / len) * amp);
          const o = (y*W + x)*4;
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) { d[o+3] = 0; continue; }
          const p = (sy*W + sx)*4;
          d[o]=s[p]; d[o+1]=s[p+1]; d[o+2]=s[p+2]; d[o+3]=s[p+3];
        }
        l.ctx.putImageData(out, 0, 0);
        touch(l); composite(); pushHistory(); saveSoon();
        banner('Ripple applied.');
      }

      // ── Puppet warp ─────────────────────────────────────────────────────────
      // Drop pins on the layer, drag them, and the image deforms to follow.
      //
      // How it works: the layer is covered with a triangle mesh. Each mesh vertex is
      // bound to the pins by inverse-distance weighting, so dragging a pin moves
      // nearby vertices a lot and distant ones barely at all. Every triangle is then
      // drawn with an affine transform mapping its original corners to its moved
      // ones. That gives smooth, local deformation without needing a real physics
      // solver, and it's fast enough to preview live on a tablet.
      let puppet = null;   // { pins:[{x,y,ox,oy}], grid, src, drag }

      function puppetBegin() {
        const l = active();
        if (!l || l.kind === 'group') { banner('Select a layer first.'); return; }
        if (l.kind === 'vector') { banner('Rasterize the vector layer first (Layers → Create & arrange).'); return; }
        // Snapshot the layer so every preview re-warps the ORIGINAL pixels rather
        // than compounding blur by warping an already-warped image.
        const src = document.createElement('canvas');
        src.width = W; src.height = H;
        src.getContext('2d').drawImage(l.canvas, 0, 0);
        // Two resolutions. A 12x12 grid over a 1024px canvas gives ~85px cells,
        // which is what made the result look faceted. Measured cost of a full
        // warp pass: 12x12 = 20ms, 32x32 = 26ms, 72x72 = ~140ms. So drag at 32
        // (still responsive) and rebuild at 72 when you commit, where a moment's
        // wait is worth a smooth result.
        puppet = { pins: [], src, n: 32, nFine: 72, drag: null, layerId: l.id };
        setTool('puppet');
        composite();
        banner('Puppet warp — tap to add pins, then drag them. Enter applies, Esc cancels.');
      }

      // Weight of pin p on point (x,y): closer pins dominate, and the falloff is
      // smooth so the surface doesn't crease.
      function puppetWeights(x, y, pins) {
        const w = [];
        let total = 0;
        for (let i = 0; i < pins.length; i++) {
          const dx = x - pins[i].ox, dy = y - pins[i].oy;
          const d2 = dx*dx + dy*dy;
          const v = 1 / (d2 * d2 + 1e-6);              // inverse distance^4
          w.push(v); total += v;
        }
        if (total > 0) for (let i = 0; i < w.length; i++) w[i] /= total;
        return w;
      }
      // Where does an original point end up, given the current pin positions?
      function puppetMap(x, y) {
        const pins = puppet.pins;
        if (!pins.length) return { x, y };
        const w = puppetWeights(x, y, pins);
        let dx = 0, dy = 0;
        for (let i = 0; i < pins.length; i++) {
          dx += w[i] * (pins[i].x - pins[i].ox);
          dy += w[i] * (pins[i].y - pins[i].oy);
        }
        return { x: x + dx, y: y + dy };
      }

      // Draw one triangle of the source through the affine transform that carries
      // its original corners onto its warped ones.
      // Nudge a triangle's corners outward from its own centroid. Clipping to an
      // exact triangle leaves a half-pixel antialiased edge on every side, and
      // with thousands of triangles those show up as a fine grid of seams. A
      // small overlap hides them completely.
      function puppetExpand(p0, p1, p2, amt) {
        const cx = (p0.x + p1.x + p2.x) / 3, cy = (p0.y + p1.y + p2.y) / 3;
        const grow = (p) => {
          const dx = p.x - cx, dy = p.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          return { x: p.x + (dx / d) * amt, y: p.y + (dy / d) * amt };
        };
        return [grow(p0), grow(p1), grow(p2)];
      }
      function puppetDrawTri(ctx, img, s0, s1, s2, d0, d1, d2) {
        const x0=s0.x, y0=s0.y, x1=s1.x, y1=s1.y, x2=s2.x, y2=s2.y;
        const u0=d0.x, v0=d0.y, u1=d1.x, v1=d1.y, u2=d2.x, v2=d2.y;
        const den = x0*(y2-y1) - x1*y2 + x2*y1 + (x1-x2)*y0;
        if (Math.abs(den) < 1e-9) return;
        const a = -(y0*(u2-u1) - y1*u2 + y2*u1 + (y1-y2)*u0) / den;
        const b =  (y1*v2 + y0*(v1-v2) - y2*v1 + (y2-y1)*v0) / den;
        const c =  (x0*(u2-u1) - x1*u2 + x2*u1 + (x1-x2)*u0) / den;
        const d = -(x1*v2 + x0*(v1-v2) - x2*v1 + (x2-x1)*v0) / den;
        const e =  (x0*(y2*u1 - y1*u2) + y0*(x1*u2 - x2*u1) + (x2*y1 - x1*y2)*u0) / den;
        const f =  (x0*(y2*v1 - y1*v2) + y0*(x1*v2 - x2*v1) + (x2*y1 - x1*y2)*v0) / den;
        ctx.save();
        const [e0, e1, e2] = puppetExpand({x:u0,y:v0}, {x:u1,y:v1}, {x:u2,y:v2}, 0.7);
        ctx.beginPath();
        ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.closePath();
        ctx.clip();
        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }

      // Rebuild the warped layer from the snapshot.
      function puppetApplyToCanvas(ctx, res) {
        const n = res || puppet.n, sx = W / n, sy = H / n;
        ctx.clearRect(0, 0, W, H);
        if (!puppet.pins.length) { ctx.drawImage(puppet.src, 0, 0); return; }
        // Cache the mapped grid so each vertex is only solved once.
        const map = [];
        for (let j = 0; j <= n; j++) {
          map[j] = [];
          for (let i = 0; i <= n; i++) map[j][i] = puppetMap(i*sx, j*sy);
        }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const s00={x:i*sx,y:j*sy}, s10={x:(i+1)*sx,y:j*sy},
                s01={x:i*sx,y:(j+1)*sy}, s11={x:(i+1)*sx,y:(j+1)*sy};
          const d00=map[j][i], d10=map[j][i+1], d01=map[j+1][i], d11=map[j+1][i+1];
          puppetDrawTri(ctx, puppet.src, s00, s10, s11, d00, d10, d11);
          puppetDrawTri(ctx, puppet.src, s00, s11, s01, d00, d11, d01);
        }
      }
      function puppetPreview() {
        const l = layers.find(x => x.id === puppet.layerId);
        if (!l) return;
        puppetApplyToCanvas(l.ctx);
        touch(l);
        composite();
      }
      function puppetCommit() {
        if (!puppet) return;
        // Final pass at the fine grid — this is the version that gets kept.
        const l = layers.find(x => x.id === puppet.layerId);
        if (l) { puppetApplyToCanvas(l.ctx, puppet.nFine); touch(l); composite(); }
        const n = puppet.pins.length;
        puppet = null;
        setTool('brush');
        pushHistory(); saveSoon(); composite();
        banner(n ? `Puppet warp applied (${n} pin${n===1?'':'s'}).` : 'Puppet warp cancelled — no pins.');
      }
      function puppetCancel() {
        if (!puppet) return;
        const l = layers.find(x => x.id === puppet.layerId);
        if (l) { l.ctx.clearRect(0,0,W,H); l.ctx.drawImage(puppet.src, 0, 0); touch(l); }
        puppet = null;
        setTool('brush');
        composite();
        banner('Puppet warp cancelled.');
      }
      // Pin handles drawn over the canvas.
      // Puppet overlay: the deformation grid plus the pins. Without this you're
      // dragging invisible handles and can't tell what the warp is doing — the
      // pins existed but were never drawn, because the draw call had been wired
      // into the wrong handler and never ran.
      function drawPuppetOverlay() {
        if (!puppet) return;
        const z = zoom || 1;
        vctx.save();

        // A light grid showing how the surface is being deformed. Drawn coarser
        // than the actual warp mesh so it reads as guidance, not noise.
        const g = 10, sx = W / g, sy = H / g;
        vctx.strokeStyle = 'rgba(194,137,95,.42)';
        vctx.lineWidth = 1 / z;
        for (let j2 = 0; j2 <= g; j2++) {
          vctx.beginPath();
          for (let i2 = 0; i2 <= g; i2++) {
            const p = puppetMap(i2 * sx, j2 * sy);
            if (i2 === 0) vctx.moveTo(p.x, p.y); else vctx.lineTo(p.x, p.y);
          }
          vctx.stroke();
        }
        for (let i2 = 0; i2 <= g; i2++) {
          vctx.beginPath();
          for (let j2 = 0; j2 <= g; j2++) {
            const p = puppetMap(i2 * sx, j2 * sy);
            if (j2 === 0) vctx.moveTo(p.x, p.y); else vctx.lineTo(p.x, p.y);
          }
          vctx.stroke();
        }

        // Pins on top, with a line back to where each one started.
        const r = 8 / z;
        puppet.pins.forEach((p, i) => {
          const moved = (p.x !== p.ox || p.y !== p.oy);
          if (moved) {
            vctx.beginPath();
            vctx.moveTo(p.ox, p.oy); vctx.lineTo(p.x, p.y);
            vctx.setLineDash([4 / z, 4 / z]);
            vctx.lineWidth = 1.4 / z;
            vctx.strokeStyle = 'rgba(194,137,95,.75)';
            vctx.stroke();
            vctx.setLineDash([]);
            // faint marker at the original position
            vctx.beginPath(); vctx.arc(p.ox, p.oy, 3 / z, 0, Math.PI * 2);
            vctx.fillStyle = 'rgba(194,137,95,.45)'; vctx.fill();
          }
          const active = (puppet.drag === i);
          // white halo so a pin stays visible over dark artwork
          vctx.beginPath(); vctx.arc(p.x, p.y, r + 1.6 / z, 0, Math.PI * 2);
          vctx.fillStyle = 'rgba(255,255,255,.9)'; vctx.fill();
          vctx.beginPath(); vctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          vctx.fillStyle = active ? '#e0a071' : '#c2895f'; vctx.fill();
          vctx.beginPath(); vctx.arc(p.x, p.y, r * 0.34, 0, Math.PI * 2);
          vctx.fillStyle = '#16191e'; vctx.fill();
        });
        vctx.restore();
      }


      function beginTransform() {
        const l = active();
        if (!l || l.kind === 'vector') return banner('Transform works on a pixel layer.');
        if (maskEditing) return banner('Finish editing the mask first (turn off Edit mask), then transform.');
        if (xform) return;
        let sx0, sy0, w, h, src;
        if (sel && selBounds) {
          const { x0, y0, x1, y1 } = selBounds;
          w = x1 - x0 + 1; h = y1 - y0 + 1; sx0 = x0; sy0 = y0;
          src = document.createElement('canvas'); src.width = w; src.height = h;
          const sc = src.getContext('2d');
          sc.drawImage(l.canvas, x0, y0, w, h, 0, 0, w, h);
          const mcv = document.createElement('canvas'); mcv.width = w; mcv.height = h;
          const mx = mcv.getContext('2d'); const mimg = mx.createImageData(w, h);
          for (let y=0;y<h;y++) for (let x=0;x<w;x++) if (sel[(y+y0)*W+(x+x0)]) {
            const i=(y*w+x)*4; mimg.data[i]=mimg.data[i+1]=mimg.data[i+2]=mimg.data[i+3]=255;
          }
          mx.putImageData(mimg,0,0);
          sc.globalCompositeOperation='destination-in'; sc.drawImage(mcv,0,0);
          l.ctx.save(); l.ctx.globalCompositeOperation='destination-out'; l.ctx.drawImage(selMaskToCanvas(),0,0); l.ctx.restore();
        } else {
          w = W; h = H; sx0 = 0; sy0 = 0;
          src = document.createElement('canvas'); src.width = W; src.height = H;
          src.getContext('2d').drawImage(l.canvas, 0, 0);
          l.ctx.clearRect(0, 0, W, H);
        }
        xform = { canvas: src, w, h, cx: sx0 + w/2, cy: sy0 + h/2, sx: 1, sy: 1, angle: 0, mode: null, grab: null,
                  ocx: sx0 + w/2, ocy: sy0 + h/2 };   // ocx/ocy = original centre, for a true cancel
        touch(l); composite();
        banner('Drag a corner to scale, outside to rotate, inside to move. Apply when done.');
      }
      function xformCorners() {
        if (!xform) return [];
        const hw = xform.w*xform.sx/2, hh = xform.h*xform.sy/2;
        const ca = Math.cos(xform.angle), sa = Math.sin(xform.angle);
        return [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y]) => ({
          x: xform.cx + x*ca - y*sa, y: xform.cy + x*sa + y*ca
        }));
      }
      function drawTransformOverlay() {
        if (!xform) return;
        vctx.save();
        vctx.translate(xform.cx, xform.cy);
        vctx.rotate(xform.angle);
        vctx.scale(xform.sx, xform.sy);
        vctx.drawImage(xform.canvas, -xform.w/2, -xform.h/2);
        vctx.restore();
        const cs = xformCorners();
        vctx.save();
        vctx.strokeStyle = '#5dd6ff'; vctx.lineWidth = 1.5 / zoom; vctx.setLineDash([5/zoom, 3/zoom]);
        vctx.beginPath();
        cs.forEach((p,i)=> i?vctx.lineTo(p.x,p.y):vctx.moveTo(p.x,p.y)); vctx.closePath(); vctx.stroke();
        vctx.setLineDash([]);
        vctx.fillStyle = '#5dd6ff';
        const r = 5/zoom;
        cs.forEach(p => { vctx.beginPath(); vctx.rect(p.x-r, p.y-r, r*2, r*2); vctx.fill(); });
        vctx.restore();
      }
      function transformHit(p) {
        if (!xform) return null;
        const cs = xformCorners();
        const r = 9/zoom;
        for (let i=0;i<4;i++) if (Math.abs(p.x-cs[i].x)<r && Math.abs(p.y-cs[i].y)<r) return { mode:'scale', corner:i };
        const dx=p.x-xform.cx, dy=p.y-xform.cy, ca=Math.cos(-xform.angle), sa=Math.sin(-xform.angle);
        const lx=dx*ca-dy*sa, ly=dx*sa+dy*ca;
        if (Math.abs(lx) < xform.w*xform.sx/2 && Math.abs(ly) < xform.h*xform.sy/2) return { mode:'move' };
        return { mode:'rotate' };
      }
      function commitTransform() {
        const l = active();
        if (!xform || !l) { xform = null; return; }
        l.ctx.save();
        l.ctx.translate(xform.cx, xform.cy);
        l.ctx.rotate(xform.angle);
        l.ctx.scale(xform.sx, xform.sy);
        l.ctx.drawImage(xform.canvas, -xform.w/2, -xform.h/2);
        l.ctx.restore();
        xform = null; touch(l);
        composite(); pushHistory('Transform'); renderLayerList();
        banner('Transform applied.');
      }
      function cancelTransform() {
        const l = active();
        if (!xform || !l) { xform = null; return; }
        // Put the pixels back exactly where they came from — original centre, no
        // scale or rotation — so cancel is a true undo of the lift.
        l.ctx.save();
        l.ctx.translate(xform.ocx, xform.ocy);
        l.ctx.drawImage(xform.canvas, -xform.w/2, -xform.h/2);
        l.ctx.restore();
        xform = null; touch(l);
        composite(); banner('Transform cancelled.');
      }


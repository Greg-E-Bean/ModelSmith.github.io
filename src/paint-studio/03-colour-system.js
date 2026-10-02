      // ── Colour system ───────────────────────────────────────────────────────
      // Kept as HSV internally (that's what the picker manipulates) and converted
      // to hex/rgba on demand. fg/bg mirror the classic two-swatch model.
      let fg = { h: 25, s: 0.51, v: 0.76, a: 1 };
      let bg = { h: 215, s: 0.30, v: 0.11, a: 1 };
      let swatches = [];
      const SW_KEY = 'modelsmith_paint_swatches_v1';

      function hsv2rgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
      }
      function rgb2hsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d) {
          if (mx === r) h = 60 * (((g - b) / d) % 6);
          else if (mx === g) h = 60 * ((b - r) / d + 2);
          else h = 60 * ((r - g) / d + 4);
        }
        return { h: ((h % 360) + 360) % 360, s: mx ? d / mx : 0, v: mx };
      }
      const hex2 = (n) => n.toString(16).padStart(2, '0');
      function toHex(c) { const { r, g, b } = hsv2rgb(c.h, c.s, c.v); return '#' + hex2(r) + hex2(g) + hex2(b); }
      function toRGBA(c) { const { r, g, b } = hsv2rgb(c.h, c.s, c.v); return `rgba(${r},${g},${b},${c.a})`; }

      // Build a linear or radial gradient between two drag points, honouring the Type
      // selector. Radial grows from the start point out to the release point. Shared
      // by the live preview (onMove) and the commit (onUp).
      function makeGradient(ctx, x0, y0, x1, y1) {
        const radial = $('ps-grad-type') && $('ps-grad-type').value === 'radial';
        const g = radial
          ? ctx.createRadialGradient(x0, y0, 0, x0, y0, Math.hypot(x1 - x0, y1 - y0) || 1)
          : ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, toRGBA(fg));
        g.addColorStop(1, ($('ps-gtobg') && $('ps-gtobg').checked) ? toRGBA(bg) : toRGBA({ ...fg, a: 0 }));
        return g;
      }
      function fromHex(hex, keepA) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
        if (!m) return null;
        const h = rgb2hsv(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
        h.a = keepA == null ? 1 : keepA;
        return h;
      }

      function syncColorUI() {
        if (liveText) { liveText.colour = toolColor(); composite(); }
        const hexv = toHex(fg);
        const { r, g, b } = hsv2rgb(fg.h, fg.s, fg.v);
        const set = (id, v) => { const e = $(id); if (e && document.activeElement !== e) e.value = v; };
        set('ps-hex', hexv.toUpperCase());
        set('ps-r', r); set('ps-g', g); set('ps-b', b);
        const sv = $('ps-sv'); if (sv) sv.style.background = `hsl(${fg.h}, 100%, 50%)`;
        const dot = $('ps-sv-dot');
        if (dot) { dot.style.left = (fg.s * 100) + '%'; dot.style.top = ((1 - fg.v) * 100) + '%'; dot.style.background = hexv; }
        const hd = $('ps-hue-dot'); if (hd) { hd.style.left = (fg.h / 360 * 100) + '%'; hd.style.background = `hsl(${fg.h},100%,50%)`; }
        const ad = $('ps-alpha-dot'); if (ad) { ad.style.left = (fg.a * 100) + '%'; ad.style.background = hexv; }
        const af = $('ps-alpha-fill');
        if (af) af.style.background = `linear-gradient(to right, ${toRGBA({ ...fg, a: 0 })}, ${toRGBA({ ...fg, a: 1 })})`;
        const pv = $('ps-preview'); if (pv) pv.style.setProperty('--cp-current', toRGBA(fg));
        const sf = $('ps-sw-fg'); if (sf) sf.style.background = toRGBA(fg);
        const sb = $('ps-sw-bg'); if (sb) sb.style.background = toRGBA(bg);
        // keep the wheel and swatch chip in step with any colour change
        if (window.redrawWheel) window.redrawWheel();
        if (window.syncFgBg) window.syncFgBg();
      }

      function renderSwatches() {
        const box = $('ps-swatches'); if (!box) return;
        box.innerHTML = '';
        swatches.forEach((hx, i) => {
          const b = document.createElement('button');
          b.className = 'cp-sw'; b.style.background = hx; b.title = hx + ' — click to use, long-press to remove';
          b.onclick = () => { const c = fromHex(hx, fg.a); if (c) { fg = c; syncColorUI(); } };
          let t = null;
          const rm = () => { swatches.splice(i, 1); saveSwatches(); renderSwatches(); };
          b.onpointerdown = () => { t = setTimeout(rm, 650); };
          b.onpointerup = b.onpointerleave = () => clearTimeout(t);
          b.oncontextmenu = (e) => { e.preventDefault(); rm(); };
          box.appendChild(b);
        });
      }
      function saveSwatches() { try { localStorage.setItem(SW_KEY, JSON.stringify(swatches)); } catch (e) {} }
      function loadSwatches() {
        try { const r = localStorage.getItem(SW_KEY); if (r) { swatches = JSON.parse(r); return; } } catch (e) {}
        swatches = ['#1a1d23','#ffffff','#c2895f','#e0685f','#e0a84a','#b7e36a','#5dd6ff','#7b6cff','#ff7ab8',
                    '#8b95a5','#d8dee8','#8a5a3a','#7a2f2a','#8a6420','#4e7a2a','#2a5f7a','#3a2f7a','#7a3a5c'];
      }

      // Drag handling shared by the SV field and the two rails.
      function railDrag(el, onMove) {
        if (!el) return;
        const run = (e) => {
          const r = el.getBoundingClientRect();
          onMove(
            Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
          );
          syncColorUI();
        };
        el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); run(e); });
        el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) run(e); });
      }

      function wireColor() {
        loadSwatches(); renderSwatches();
        railDrag($('ps-sv'), (x, y) => { fg.s = x; fg.v = 1 - y; });
        railDrag($('ps-hue'), (x) => { fg.h = x * 360; });
        railDrag($('ps-alpha'), (x) => { fg.a = x; });

        const pop = $('ps-color-pop');
        $('ps-color-open').onclick = (e) => { e.stopPropagation(); pop.classList.toggle('open'); syncColorUI(); };
        $('ps-color-close').onclick = () => pop.classList.remove('open');
        document.addEventListener('pointerdown', (e) => {
          if (!pop.classList.contains('open')) return;
          if (pop.contains(e.target) || $('ps-color-open').contains(e.target)) return;
          pop.classList.remove('open');
        });
        $('ps-swap').onclick = () => { const t = fg; fg = bg; bg = t; syncColorUI(); };
        $('ps-sw-add').onclick = () => {
          const hx = toHex(fg);
          if (!swatches.includes(hx)) { swatches.unshift(hx); if (swatches.length > 27) swatches.pop(); saveSwatches(); renderSwatches(); }
        };
        $('ps-hex').oninput = (e) => { const c = fromHex(e.target.value, fg.a); if (c) { fg = c; syncColorUI(); } };
        ['ps-r', 'ps-g', 'ps-b'].forEach(id => {
          $(id).oninput = () => {
            const r = +$('ps-r').value || 0, g = +$('ps-g').value || 0, b = +$('ps-b').value || 0;
            const h = rgb2hsv(Math.min(255, r), Math.min(255, g), Math.min(255, b));
            fg = { ...h, a: fg.a }; syncColorUI();
          };
        });
        syncColorUI();
      }


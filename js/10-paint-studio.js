
    // ═══════════════════════════════════════════════════════════════════════════
    //   PAINT STUDIO
    //   A layered raster + vector drawing workspace living alongside the 3D
    //   modeller. Each layer owns its own offscreen canvas; the visible canvas is
    //   a composite re-drawn whenever something changes. Vector layers keep a list
    //   of editable shapes and are re-rendered from that list, so they stay crisp
    //   and re-editable until rasterised.
    // ═══════════════════════════════════════════════════════════════════════════
    const Paint = (function () {
      let W = 1024, H = 1024;
      let layers = [];             // { id, name, canvas, ctx, visible, opacity, blend, kind, shapes[] }
      let activeId = null;
      let tool = 'brush';
      let zoom = 1;
      let history = [], histIndex = -1;
      const MAX_HIST = 60;

      const view = document.getElementById('paint-canvas');
      const vctx = view ? view.getContext('2d') : null;
      const wrap = document.getElementById('canvas-wrap');

      const $ = (id) => document.getElementById(id);
      const banner = (msg) => {
        const b = $('paint-banner'); if (!b) return;
        b.textContent = msg; b.classList.add('show');
        clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 2600);
      };

      // ── Tool rail definition ────────────────────────────────────────────────
      // Tools are grouped; the rail shows only the active tool of each group, with
      // a chevron that flies out the alternatives. `last` remembers which member
      // of the group was most recently used.
      const ICON = {
        triangle: '<path d="M12 4 21 19H3Z"/>',
        hexagon: '<path d="M12 2.5 20.5 7.2v9.6L12 21.5 3.5 16.8V7.2Z"/>',
        polygon: '<path d="M12 2.5 21.5 9.4 17.9 20.6H6.1L2.5 9.4Z"/>',
        star: '<path d="m12 2.8 2.9 5.9 6.5.95-4.7 4.6 1.1 6.5-5.8-3.05-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95Z"/>',
        arrow: '<path d="M2.5 12h15"/><path d="m13.5 6.5 7 5.5-7 5.5Z"/>',
        brush: '<path d="M14.5 5.5 18 2a2.1 2.1 0 0 1 3 3l-3.5 3.5Z"/><path d="m13.5 6.5 4 4L11 17l-4 1 1-4Z"/><path d="M6 18c-1.5.5-2.5 2-3 4 2-.5 3.5-1.5 4-3"/>',
        pencil: '<path d="M16.5 3.5 20.5 7.5 8 20H4v-4Z"/><path d="m14.5 5.5 4 4"/><path d="M4.5 16.5 7.5 19.5"/>',
        marker: '<path d="M15.5 3.5 20.5 8.5 11 18l-5-5Z"/><path d="M6 13 3 20l7-3"/><path d="m13.5 5.5 5 5"/>',
        airbrush: '<rect x="6" y="9" width="8" height="13" rx="2"/><path d="M9 9V5a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 13 5v4"/><path d="M14 6h3"/><circle cx="19.5" cy="4" r=".7"/><circle cx="21.5" cy="6.5" r=".7"/><circle cx="19" cy="9" r=".7"/><circle cx="22" cy="10" r=".7"/>',
        calligraphy: '<path d="M3 21c4-1 7-4 9-8l6-11"/><path d="M18 2l3 2-4 9-3-2Z"/>',
        spray: '<circle cx="7" cy="7" r=".7"/><circle cx="12" cy="5" r=".7"/><circle cx="17" cy="8" r=".7"/><circle cx="9" cy="12" r=".7"/><circle cx="14" cy="11" r=".7"/><circle cx="19" cy="14" r=".7"/><circle cx="6" cy="17" r=".7"/><circle cx="11" cy="18" r=".7"/><circle cx="16" cy="19" r=".7"/>',
        eraser: '<path d="m19 20-9.5.02L3 13.5a2 2 0 0 1 0-2.83l7.6-7.6a2 2 0 0 1 2.83 0l6.36 6.37a2 2 0 0 1 0 2.83L13 18"/><path d="M21 20h-9"/>',
        smudge: '<path d="M15.5 4.5a4.5 4.5 0 0 1 0 6.4l-3.2 3.2a1 1 0 0 1-1.4 0L8.3 11.5a1 1 0 0 1 0-1.4l3.2-3.2a4.5 4.5 0 0 1 4-2.4Z" opacity=".95"/><path d="M9 15.5c-2 1-4 1.6-6 1.8" opacity=".75"/><path d="M10.5 18c-2.5 1-5 1.7-7.5 2" opacity=".5"/><path d="M12.5 20.3c-2.5.6-5 1-7 1.2" opacity=".3"/>',
        blurbrush: '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8" opacity=".45" stroke-dasharray="2 3"/>',
        dodge: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
        burn: '<path d="M12 3s5 5 5 9.5a5 5 0 0 1-10 0C7 8 12 3 12 3Z"/><path d="M12 21c-2 0-3.5-1.2-3.5-3 0-2 3.5-4 3.5-4s3.5 2 3.5 4c0 1.8-1.5 3-3.5 3Z" opacity=".5"/>',
        clone: '<path d="M10 2.5h4a1 1 0 0 1 1 1V6a2 2 0 0 0 2 2h0v2H5V8h0a2 2 0 0 0 2-2V3.5a1 1 0 0 1 1-1Z"/><rect x="5" y="10" width="14" height="3" rx="1"/><path d="M7 13v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6"/>',
        fill: '<path d="m9 4 9 9-7.5 7.5a2.1 2.1 0 0 1-3 0L2 14a2.1 2.1 0 0 1 0-3L9 4Z"/><path d="m9 4-2-2"/><path d="M20 15s2 2.5 2 4a2 2 0 1 1-4 0c0-1.5 2-4 2-4Z"/>',
        gradient: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 18h18" opacity=".9"/><path d="M3 15h18" opacity=".65"/><path d="M3 12h18" opacity=".45"/><path d="M3 9h18" opacity=".28"/><path d="M3 6h18" opacity=".14"/>',
        picker: '<path d="m19 2 3 3-9 9-3-3 9-9Z"/><path d="m10 11-7 7v3h3l7-7"/>',
        line: '<path d="M4 20 20 4"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="4" r="2"/>',
        rect: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
        ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
        pen: '<path d="M3 21c0-6 4-10 8-12"/><path d="m12 2 7 5-4 8-6-4Z"/><path d="m9 11 6 4"/><circle cx="3" cy="21" r="1.3"/>',
        vedit: '<path d="M5 19 19 5"/><rect x="2" y="16" width="5" height="5" rx="1"/><rect x="17" y="3" width="5" height="5" rx="1"/>',
        move: '<path d="M12 3v18M3 12h18"/><path d="m12 3 2.5 2.5M12 3 9.5 5.5M12 21l2.5-2.5M12 21l-2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
        transform: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/><rect x="2" y="2" width="4" height="4" rx="1"/><rect x="18" y="2" width="4" height="4" rx="1"/><rect x="2" y="18" width="4" height="4" rx="1"/><rect x="18" y="18" width="4" height="4" rx="1"/>',
        selrect: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" stroke-dasharray="3 2"/>',
        seloval: '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 2"/>',
        lasso: '<path d="M7 20c-2 0-4-1.5-4-3.5S5 13 7 13c1 0 2 .4 2.6 1"/><path d="M3.5 16.5C3.5 9.6 8.6 4 15 4c3.9 0 6.5 2.4 6.5 5.6 0 3.4-2.8 6.4-6.4 6.4-2.6 0-4.6-1.6-4.6-3.7 0-1.9 1.5-3.3 3.4-3.3"/>',
        magic: '<path d="m3 21 9-9"/><path d="M12.5 6.5 15 4l2.5 2.5L20 4"/><path d="M15 4v6"/><path d="m14 12 3-3 4 4-3 3z"/><path d="M6 6l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
        selmove: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" stroke-dasharray="2.5 2"/>',
        text: '<path d="M4 6V4h16v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'
      };
      const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ''}</svg>`;
      const GROUP_CAP = { select: 'Select', paint: 'Paint', erase: 'Erase', retouch: 'Retouch', ink: 'Fill', vector: 'Shapes', type: 'Text', move: 'Move' };

      const TOOL_GROUPS = [
        { id: 'select', last: 'selrect', tools: [
          { t: 'selrect', label: 'Rectangle select (S)' },
          { t: 'seloval', label: 'Oval select' },
          { t: 'lasso', label: 'Lasso select — draw freehand' },
          { t: 'magic', label: 'Magic select — same colour (W)' },
          { t: 'selmove', label: 'Move selected pixels' }
        ]},
        { id: 'paint', last: 'brush', tools: [
          { t: 'brush', label: 'Brush (B)' },
          { t: 'pencil', label: 'Pencil — hard edge (N)' },
          { t: 'marker', label: 'Marker — builds up (M)' },
          { t: 'airbrush', label: 'Airbrush (A)' },
          { t: 'calligraphy', label: 'Calligraphy nib' },
          { t: 'spray', label: 'Spray / stipple' }
        ]},
        { id: 'erase', last: 'eraser', tools: [{ t: 'eraser', label: 'Eraser (E)' }] },
        { id: 'retouch', last: 'smudge', tools: [
          { t: 'smudge', label: 'Smudge' },
          { t: 'blurbrush', label: 'Blur brush' },
          { t: 'dodge', label: 'Dodge — lighten' },
          { t: 'burn', label: 'Burn — darken' },
          { t: 'clone', label: 'Clone stamp — Alt+click to set source' }
        ]},
        { id: 'ink', last: 'fill', tools: [
          { t: 'fill', label: 'Fill (G)' },
          { t: 'gradient', label: 'Gradient' },
          { t: 'picker', label: 'Colour picker (I)' }
        ]},
        { id: 'vector', last: 'rect', tools: [
          { t: 'rect', label: 'Rectangle' },
          { t: 'ellipse', label: 'Ellipse' },
          { t: 'line', label: 'Line' },
          { t: 'triangle', label: 'Triangle' },
          { t: 'hexagon', label: 'Hexagon' },
          { t: 'polygon', label: 'Polygon — set sides below' },
          { t: 'star', label: 'Star — set points below' },
          { t: 'arrow', label: 'Arrow' },
          { t: 'pen', label: 'Pen — click points, double-click to finish' },
          { t: 'vedit', label: 'Edit vector points — drag handles' }
        ]},
        { id: 'type', last: 'text', tools: [{ t: 'text', label: 'Text — click to place (T)' }] },
        { id: 'move', last: 'move', tools: [
          { t: 'move', label: 'Move layer (V)' },
          { t: 'transform', label: 'Transform — scale / rotate a selection' }
        ]}
      ];
      const groupOf = (t) => TOOL_GROUPS.find(g => g.tools.some(x => x.t === t));
      window.msPaintTools = { list: () => TOOL_GROUPS.flatMap(g => g.tools), set: (t) => setTool(t) };
      const labelOf = (t) => { const g = groupOf(t); const e = g && g.tools.find(x => x.t === t); return e ? e.label : t; };

      function buildRail() {
        const rail = $('paint-rail'); if (!rail) return;
        rail.innerHTML = '';
        TOOL_GROUPS.forEach((g, gi) => {
          if (gi) { const sep = document.createElement('div'); sep.className = 'rail-sep'; rail.appendChild(sep); }
          const slot = document.createElement('div');
          slot.className = 'rail-slot'; slot.dataset.group = g.id;
          const main = document.createElement('button');
          main.className = 'rail-main'; main.dataset.ptool = g.last;
          main.innerHTML = svg(g.last) + `<span class="tip">${labelOf(g.last)}</span><span class="rail-cap">${GROUP_CAP[g.id] || ''}</span>`;
          main.onclick = () => setTool(g.last);
          slot.appendChild(main);
          if (g.tools.length > 1) {
            const chev = document.createElement('button');
            chev.className = 'rail-chev'; chev.title = 'More tools';
            chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m8 10 4 4 4-4"/></svg>';
            chev.onclick = (e) => { e.stopPropagation(); openFlyout(g, slot); };
            slot.appendChild(chev);
          }
          rail.appendChild(slot);
        });
        refreshRail();
      }

      let flyout = null;
      function closeFlyout() { if (flyout) { flyout.remove(); flyout = null; } }
      function openFlyout(g, slot) {
        closeFlyout();
        const f = document.createElement('div');
        f.className = 'rail-flyout';
        g.tools.forEach(({ t, label }) => {
          const b = document.createElement('button');
          b.className = 'rail-fly-btn' + (t === tool ? ' active' : '');
          b.dataset.ptool = t;
          b.innerHTML = svg(t) + `<span>${label}</span>`;
          b.onclick = () => { setTool(t); closeFlyout(); };
          f.appendChild(b);
        });
        document.body.appendChild(f);
        const r = slot.getBoundingClientRect();
        f.style.top = Math.max(8, r.top - 4) + 'px';
        // open on whichever side has room (the rail can be flipped right)
        const right = r.left > window.innerWidth / 2;
        if (right) f.style.right = (window.innerWidth - r.left + 8) + 'px';
        else f.style.left = (r.right + 8) + 'px';
        flyout = f;
        setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }), 0);
        function onDocDown(e) { if (f.contains(e.target)) { setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }), 0); return; } closeFlyout(); }
      }

      function refreshRail() {
        document.querySelectorAll('#paint-rail .rail-slot').forEach(slot => {
          const g = TOOL_GROUPS.find(x => x.id === slot.dataset.group);
          const main = slot.querySelector('.rail-main');
          main.dataset.ptool = g.last;
          main.innerHTML = svg(g.last) + `<span class="tip">${labelOf(g.last)}</span><span class="rail-cap">${GROUP_CAP[g.id] || ''}</span>`;
          main.onclick = () => setTool(g.last);
          slot.classList.toggle('active', g.tools.some(x => x.t === tool));
        });
      }

      function setTool(t) {
        if (tool === 'pen' && penPts.length) finishPen();
        if (liveText && t !== 'text') commitText();   // settle live text on tool change
        if (xform && t !== 'transform') commitTransform();  // settle a transform on tool change
        // a lifted selection is committed when you move on to another tool
        if (floatSel && t !== 'selmove') dropSelection();
        tool = t;
        const g = groupOf(t); if (g) g.last = t;
        vSel = null; vHover = null;
        refreshRail();
        syncHud();
        syncToolContext(t);
        syncSizeUI();
        // Ring tools hide the OS cursor — the drawn ring IS the cursor, and two
        // overlapping pointers is worse than one.
        const c = RING_TOOLS.test(t) ? 'none'
          : t === 'picker' ? 'copy'
          : t === 'move' || t === 'selmove' ? 'move'
          : t === 'vedit' ? 'default'
          : t === 'text' ? 'text'
          : 'crosshair';
        if (view) view.style.cursor = c;
        composite();
        if (t === 'vedit') {
          const l = active();
          if (l && l.kind !== 'vector') banner('Pick a vector layer (VEC) to edit its points.');
          drawVectorHandles();
        }
        banner(labelOf(t));
      }

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

      // ── Persistence ─────────────────────────────────────────────────────────
      const SAVE_KEY = 'modelsmith_paint_v1';
      let saveTimer = null;
      let _saveWarned = false;
      function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 1200); }
      function save() {
        let json;
        try { json = JSON.stringify(snapshot()); } catch (e) { return; }
        // IndexedDB has room for full-resolution layers, imported PSDs and custom
        // brushes, all of which used to compete for the same ~5MB as everything
        // else and could push the autosave over the edge without warning.
        if (window.Store && Store.available) {
          Store.set(SAVE_KEY, json)
            .then(() => { _saveWarned = false; localStorage.removeItem(SAVE_KEY); })
            .catch(() => {
              try { localStorage.setItem(SAVE_KEY, json); _saveWarned = false; }
              catch (e2) {
                if (!_saveWarned) {
                  _saveWarned = true;
                  banner('⚠️ Artwork too large to auto-save — export it from the Files tab to keep it safe.');
                }
              }
            });
          return;
        }
        try {
          localStorage.setItem(SAVE_KEY, json);
          _saveWarned = false;
        }
        catch (e) {
          if (!_saveWarned) {
            _saveWarned = true;
            banner('⚠️ Artwork too large to auto-save — export it from the Files tab to keep it safe.');
          }
        }
      }
      function load(onReady) {
        // Try IndexedDB first, then fall back to any legacy localStorage copy.
        if (window.Store && Store.available) {
          Store.get(SAVE_KEY).then(raw => {
            if (!raw) raw = localStorage.getItem(SAVE_KEY);
            if (!raw) { if (onReady) onReady(); return; }
            try { restore(JSON.parse(raw), onReady); } catch (e) { if (onReady) onReady(); }
          }).catch(() => {
            try {
              const raw = localStorage.getItem(SAVE_KEY);
              if (raw) restore(JSON.parse(raw), onReady); else if (onReady) onReady();
            } catch (e) { if (onReady) onReady(); }
          });
          return true;
        }
        try {
          const raw = localStorage.getItem(SAVE_KEY);
          if (!raw) return false;
          restore(JSON.parse(raw), onReady);
          return true;
        } catch (e) { return false; }
      }

      // ── Canvas sizing / zoom ────────────────────────────────────────────────
      function sizeWrap() {
        if (!wrap) return;
        wrap.style.width = (W * zoom) + 'px';
        wrap.style.height = (H * zoom) + 'px';
        view.style.width = (W * zoom) + 'px';
        view.style.height = (H * zoom) + 'px';
        const zv = $('ps-zoom-val'); if (zv) zv.textContent = Math.round(zoom * 100) + '%';
      }
      function fitZoom() {
        const vp = $('paint-viewport'); if (!vp) return;
        // Leave room for the floating tool rail (top) and brush bar (bottom) so
        // "Fit" shows the whole canvas instead of tucking its edges under them.
        const padX = 60, padY = vp.clientHeight > 520 ? 170 : 96;
        zoom = Math.min((vp.clientWidth - padX) / W, (vp.clientHeight - padY) / H, 1);
        zoom = Math.max(0.05, zoom);
        sizeWrap();
      }

      // ── Pointer → canvas coords ─────────────────────────────────────────────
      function pos(e) {
        const r = view.getBoundingClientRect();
        return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom, p: e.pressure > 0 ? e.pressure : 0.5 };
      }

      // ── Brush ───────────────────────────────────────────────────────────────
      // Deterministic pseudo-random from a seed. Bristle/chalk/spatter need scatter
      // that stays PUT — a Math.random() stamp would shimmer differently on every
      // repaint, and a stroke re-rendered from history wouldn't match what you drew.
      function tipRnd(seed) {
        let s = seed >>> 0;
        return () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
      }

      // The angle for tips that have a direction (flat, oval, diamond).
      function tipAngle() {
        const e = $('pb-angle');
        return ((parseInt(e ? e.value : 45) || 0) * Math.PI) / 180;
      }

      // Paint one stamp of the current tip. Every tip honours size, colour,
      // hardness and alpha so they stay interchangeable across the brush family.
      function brushStamp(ctx, x, y, size, color, hardness, shape, alpha, seed) {
        const r = Math.max(0.5, size / 2);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        // A soft round dab — the building block most tips are made from.
        const dab = (cx, cy, rad, a) => {
          if (rad <= 0) return;
          ctx.globalAlpha = a;
          if (hardness >= 0.99) {
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
          } else {
            const g = ctx.createRadialGradient(cx, cy, rad * hardness, cx, cy, rad);
            g.addColorStop(0, color);
            g.addColorStop(1, hexA(color, 0));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = color;
          }
        };

        switch (shape) {
          case 'square':
            ctx.fillRect(x - r, y - r, size, size);
            break;

          case 'diamond':
            ctx.translate(x, y); ctx.rotate(tipAngle());
            ctx.beginPath();
            ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
            ctx.closePath(); ctx.fill();
            break;

          case 'flat': {
            // A chisel nib: wide across, thin along. Rotating the context keeps the
            // nib's angle fixed regardless of stroke direction, which is what makes
            // the line swell and thin like real calligraphy.
            ctx.translate(x, y); ctx.rotate(tipAngle());
            const thin = Math.max(0.6, r * 0.28);
            ctx.fillRect(-r, -thin, size, thin * 2);
            break;
          }

          case 'oval': {
            ctx.translate(x, y); ctx.rotate(tipAngle());
            const ry = Math.max(0.5, r * 0.42);
            if (hardness >= 0.99) {
              ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2); ctx.fill();
            } else {
              // scale a radial gradient into an ellipse so softness follows the shape
              ctx.save();
              ctx.scale(1, ry / r);
              const g = ctx.createRadialGradient(0, 0, r * hardness, 0, 0, r);
              g.addColorStop(0, color); g.addColorStop(1, hexA(color, 0));
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'bristle': {
            // Individual hairs, fixed relative to the tip so the stroke reads as one
            // brush dragged along rather than a cloud of dots.
            const n = Math.max(6, Math.min(28, Math.round(size * 0.9)));
            const rnd = tipRnd(1337);
            ctx.translate(x, y); ctx.rotate(tipAngle());
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              const hr = Math.max(0.4, r * (0.06 + rnd() * 0.1));
              dab(Math.cos(a) * d, Math.sin(a) * d * 0.55, hr, alpha * (0.35 + rnd() * 0.5));
            }
            break;
          }

          case 'chalk': {
            // Grain: a soft core with holes punched through it, so it reads as
            // pigment catching on paper tooth.
            dab(x, y, r, alpha * 0.55);
            const n = Math.max(8, Math.min(40, Math.round(size * 1.4)));
            const rnd = tipRnd(90210);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.4, r * 0.16 * rnd()), alpha * rnd() * 0.9);
            }
            break;
          }

          case 'spatter': {
            // Scattered specks well beyond the nominal radius — an ink flick.
            const n = Math.max(4, Math.min(24, Math.round(size * 0.5)));
            const rnd = tipRnd(4242);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.pow(rnd(), 0.6) * r * 1.5;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.4, r * 0.22 * rnd()), alpha * (0.4 + rnd() * 0.6));
            }
            break;
          }

          case 'grass': {
            // Blades fanning upward from the stamp point — drag along the ground and
            // it grows a strip of grass. Blades tilt around the tip angle.
            const n = Math.max(4, Math.min(16, Math.round(size * 0.6)));
            const rnd = tipRnd(2024);
            ctx.translate(x, y); ctx.rotate(tipAngle());
            for (let i = 0; i < n; i++) {
              const spread = (rnd() - 0.5) * r * 1.6;      // horizontal position along the base
              const lean = (rnd() - 0.5) * 0.5;            // slight sideways lean
              const h = r * (1.1 + rnd() * 1.3);           // blade height
              const w = Math.max(0.6, r * (0.10 + rnd() * 0.10));
              ctx.save();
              ctx.translate(spread, 0);
              ctx.rotate(lean);
              ctx.beginPath();
              ctx.moveTo(-w, 0);
              ctx.quadraticCurveTo(w * 0.4, -h * 0.6, w * 0.3, -h);   // curved blade
              ctx.quadraticCurveTo(w * 0.2, -h * 0.6, w, 0);
              ctx.closePath();
              ctx.globalAlpha = alpha * (0.55 + rnd() * 0.45);
              ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'leaves': {
            // Small leaf/petal shapes scattered around the tip — good for foliage,
            // confetti, or a hedge texture when dragged.
            const n = Math.max(3, Math.min(12, Math.round(size * 0.4)));
            const rnd = tipRnd(7777);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              const lr = Math.max(1, r * (0.25 + rnd() * 0.28));
              ctx.save();
              ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
              ctx.rotate(rnd() * Math.PI * 2);
              ctx.globalAlpha = alpha * (0.5 + rnd() * 0.5);
              ctx.beginPath();
              ctx.moveTo(0, -lr);
              ctx.quadraticCurveTo(lr * 0.7, 0, 0, lr);      // pointed-oval leaf
              ctx.quadraticCurveTo(-lr * 0.7, 0, 0, -lr);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'fur': {
            // Soft fluffy clumps — overlapping faint dabs, like fur, wool or clouds.
            const n = Math.max(6, Math.min(30, Math.round(size * 1.1)));
            const rnd = tipRnd(5150);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.pow(rnd(), 0.7) * r;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.6, r * (0.28 + rnd() * 0.3)), alpha * (0.12 + rnd() * 0.25));
            }
            break;
          }

          case 'sparkle': {
            // Four-point stars of varying size — sparkles, stars, glints.
            const n = Math.max(2, Math.min(8, Math.round(size * 0.25)));
            const rnd = tipRnd(31337);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              const sr = Math.max(1.2, r * (0.2 + rnd() * 0.4));
              const thin = Math.max(0.4, sr * 0.16);
              ctx.save();
              ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
              ctx.rotate(rnd() * Math.PI);
              ctx.globalAlpha = alpha * (0.6 + rnd() * 0.4);
              ctx.beginPath();
              // vertical spike
              ctx.moveTo(0, -sr); ctx.lineTo(thin, 0); ctx.lineTo(0, sr); ctx.lineTo(-thin, 0); ctx.closePath();
              ctx.fill();
              ctx.beginPath();
              // horizontal spike
              ctx.moveTo(-sr, 0); ctx.lineTo(0, -thin); ctx.lineTo(sr, 0); ctx.lineTo(0, thin); ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'dots': {
            // Evenly-ish scattered round dots — stippling, halftone, texture fills.
            const n = Math.max(3, Math.min(18, Math.round(size * 0.5)));
            const rnd = tipRnd(1212);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.5, r * (0.10 + rnd() * 0.14)), alpha * (0.6 + rnd() * 0.4));
            }
            break;
          }

          default:
            if (shape && shape.startsWith('custom:')) {
              // Custom imported brush: stamp the tinted image. The image's own alpha
              // is the brush shape; we colourize it to the current paint colour.
              const cb = customBrushes[shape];
              if (cb && cb.tinted) {
                ctx.save();
                ctx.globalAlpha = alpha;
                if (ANGLED_TIPS.test(shape) || cb.angled) { ctx.translate(x, y); ctx.rotate(tipAngle()); ctx.drawImage(cb.tintedFor(color), -r, -r, size, size); }
                else ctx.drawImage(cb.tintedFor(color), x - r, y - r, size, size);
                ctx.restore();
              } else {
                dab(x, y, r, alpha);
              }
            } else {
              dab(x, y, r, alpha);   // round
            }
        }
        ctx.restore();
      }

      function hexA(hex, a) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return `rgba(0,0,0,${a})`;
        return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
      }

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

      // ── Custom imported brushes ─────────────────────────────────────────────
      // A custom brush is an image whose alpha defines the stamp shape. We keep a
      // white "mask" version and tint it to the current colour on demand (cached per
      // colour). Definitions persist in localStorage as data URLs.
      const customBrushes = {};   // key 'custom:<id>' -> { img, tinted, tintedFor, angled }
      const CUSTOM_BRUSH_KEY = 'modelsmith_brushes_v1';

      function makeCustomBrush(key, dataURL) {
        const img = new Image();
        const rec = { img, tinted: null, _cacheColor: null, _cacheCanvas: null, angled: false, dataURL };
        rec.tintedFor = (color) => {
          if (rec._cacheColor === color && rec._cacheCanvas) return rec._cacheCanvas;
          const s = 128;
          const cv = document.createElement('canvas'); cv.width = s; cv.height = s;
          const c = cv.getContext('2d');
          // draw the brush image, then use it as an alpha mask over a solid colour
          c.clearRect(0, 0, s, s);
          c.drawImage(img, 0, 0, s, s);
          c.globalCompositeOperation = 'source-in';
          c.fillStyle = color; c.fillRect(0, 0, s, s);
          c.globalCompositeOperation = 'source-over';
          rec._cacheColor = color; rec._cacheCanvas = cv;
          return cv;
        };
        img.onload = () => { rec.tinted = true; renderCustomTips(); drawTipPreviews(); };
        img.src = dataURL;
        customBrushes[key] = rec;
        return rec;
      }

      function loadCustomBrushes() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(CUSTOM_BRUSH_KEY) || '{}'); } catch (e) {}
        Object.keys(saved).forEach(key => makeCustomBrush(key, saved[key]));
        renderCustomTips();
      }
      function persistCustomBrushes() {
        const out = {};
        Object.keys(customBrushes).forEach(k => { out[k] = customBrushes[k].dataURL; });
        try { localStorage.setItem(CUSTOM_BRUSH_KEY, JSON.stringify(out)); }
        catch (e) { banner('⚠️ Not enough room to save the brush on this device.'); }
      }

      function renderCustomTips() {
        const wrap = $('pb-custom-tips'); if (!wrap) return;
        wrap.innerHTML = '';
        Object.keys(customBrushes).forEach(key => {
          const btn = document.createElement('button');
          btn.className = 'tip-btn'; btn.dataset.shape = key;
          btn.title = 'Custom brush — tap to use, long-press / right-click to remove';
          const cv = document.createElement('canvas'); cv.width = 44; cv.height = 44;
          const c = cv.getContext('2d');
          try {
            const n = 7;
            for (let i = 0; i < n; i++) { const t = i/(n-1); brushStamp(c, 10+t*24, 30-t*16, 15, '#e8e4dd', 1, key, 0.6); }
          } catch (e) {}
          btn.appendChild(cv);
          const nm = document.createElement('span'); nm.className = 'tip-name'; nm.textContent = 'Custom';
          btn.appendChild(nm);
          btn.onclick = () => {
            document.querySelectorAll('#pb-shape .tip-btn, #pb-custom-tips .tip-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            syncTipUI();
          };
          // remove via right-click / long-press
          btn.oncontextmenu = (e) => { e.preventDefault(); if (confirm('Remove this custom brush?')) { delete customBrushes[key]; persistCustomBrushes(); renderCustomTips(); } };
          let lp = null;
          btn.onpointerdown = () => { lp = setTimeout(() => { if (confirm('Remove this custom brush?')) { delete customBrushes[key]; persistCustomBrushes(); renderCustomTips(); } }, 650); };
          btn.onpointerup = btn.onpointerleave = () => { if (lp) clearTimeout(lp); };
          wrap.appendChild(btn);
        });
      }

      function importBrushImages(files) {
        let count = 0;
        Array.from(files).forEach(file => {
          if (!file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = () => {
            const key = 'custom:' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            makeCustomBrush(key, reader.result);
            persistCustomBrushes();
            count++;
            banner('Custom brush added — find it under the tips.');
          };
          reader.readAsDataURL(file);
        });
      }

      function onDown(e) {
        _sc = null; _scTicks = 0;   // a new gesture starts from a fresh layer cache
        let l = active();
        // If a group folder is selected, painting has no target — hop to the group's
        // topmost real layer (or warn if it's empty) so a stroke still lands somewhere.
        if (l && l.kind === 'group') {
          const child = [...layers].reverse().find(x => x.kind !== 'group' && x.groupId === l.id);
          if (child) { activeId = child.id; l = child; renderLayerList(); syncLayerControls(); }
          else { banner('This group is empty — add or move a layer into it first.'); return; }
        }
        if (!l) return;
        // On touch/pen, stop the browser running its own gesture (scroll, long-press
        // selection, iOS magnifier) in parallel with our drag — that parallel handling
        // is what made shapes "dodge" the finger. Mouse is unaffected.
        if (e.pointerType !== 'mouse' && e.cancelable) e.preventDefault();
        view.setPointerCapture(e.pointerId);
        const p = pos(e);

        // --- selection tools ---
        if (tool === 'selrect' || tool === 'seloval' || tool === 'lasso') {
          selDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, pts: [{ x: p.x, y: p.y }] };
          drawing = true; return;
        }
        if (tool === 'magic') {
          lastMagic = { x: p.x, y: p.y };
          magicSelect(p.x, p.y);
          composite();
          banner(sel ? 'Selected matching area — paint is now limited to it.' : 'Nothing matched there.');
          return;
        }
        if (tool === 'selmove') {
          if (!sel) return banner('Make a selection first.');
          // Lift the selected pixels into a "floating" buffer the first time we
          // start moving. After that the float and its mask travel together, so
          // repeated drags keep moving the same pixels instead of re-cutting the
          // layer at the original spot (which used to slice anything half-outside).
          if (!floatSel) liftSelection(l);
          selMoveState = { start: p, ox: floatSel.x, oy: floatSel.y };
          drawing = true; return;
        }

        if (tool === 'text') {
          if (l.kind === 'vector') return banner('Text lands on raster layers — pick a PIX layer.');
          // Clicking existing live text grabs it to drag; clicking away settles it.
          if (liveText) {
            if (hitLiveText(p)) { textDrag = { dx: p.x - liveText.x, dy: p.y - liveText.y }; drawing = true; return; }
            commitText();
          }
          // Clicking an already-committed text object re-opens it for editing rather
          // than stacking a new one on top — this is what makes text re-typeable.
          const hit = hitLayerText(l, p);
          if (hit >= 0) {
            const t = l.texts[hit];
            // lift it out of the baked set while editing so it isn't shown twice
            l.texts.splice(hit, 1);
            renderTextLayer(l); composite();
            startLiveText({ x: t.x, y: t.y }, t.str, t);
            if ($('ps-textsize')) { $('ps-textsize').value = t.size; if ($('ps-textsize-val')) $('ps-textsize-val').textContent = t.size; }
            if ($('ps-font')) $('ps-font').value = t.key;
            return;
          }
          // Start an empty live text at the click point and type straight onto the
          // canvas — no popover. Keystrokes are handled by the text keyboard hook
          // below, and the caret blinks at the insertion point.
          startLiveText(p);
          return;
        }

        if (tool === 'picker') {
          // read from a clean flatten so ants/handles can't be picked up as colour
          const d = flatten().getContext('2d').getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
          if (d[3] > 0) {
            const h = rgb2hsv(d[0], d[1], d[2]);
            fg = { ...h, a: fg.a };
            syncColorUI();
            banner('Picked ' + toHex(fg).toUpperCase());
          }
          return;
        }
        if (tool === 'fill') {
          if (l.kind === 'vector') return banner('Fill works on raster layers.');
          if (sel && !sel[Math.floor(p.y) * W + Math.floor(p.x)]) return banner('That point is outside the selection.');
          const before = sel ? l.ctx.getImageData(0, 0, W, H) : null;
          floodFill(l, p.x, p.y, toolColor());
          if (sel) {
            // keep only the part of the fill that falls inside the selection
            const filled = document.createElement('canvas'); filled.width = W; filled.height = H;
            const fx = filled.getContext('2d');
            fx.drawImage(l.canvas, 0, 0);
            fx.globalCompositeOperation = 'destination-in';
            fx.drawImage(selMaskToCanvas(), 0, 0);
            l.ctx.setTransform(1, 0, 0, 1, 0, 0);
            l.ctx.putImageData(before, 0, 0);
            l.ctx.save(); l.ctx.globalCompositeOperation = 'destination-out';
            l.ctx.drawImage(selMaskToCanvas(), 0, 0); l.ctx.restore();
            l.ctx.drawImage(filled, 0, 0);
          }
          composite(); pushHistory(); return;
        }
        // Clone source can be set with Alt/Cmd+click on a desktop, or by arming the
        // "Set source" button first — tablets have no modifier keys, so without the
        // button the tool was unusable on touch.
        if (tool === 'clone' && (e.altKey || e.metaKey || cloneArmed)) {
          cloneSrc = { x: p.x, y: p.y }; cloneOffset = null;
          cloneArmed = false; if (window.syncCloneUI) window.syncCloneUI();
          banner('Clone source set — now paint elsewhere.'); return;
        }
        if (tool === 'clone' && !cloneSrc) {
          banner('Tap "Set source" (or Alt+click) to pick what to clone from.'); return;
        }
        if (tool === 'puppet' && puppet) {
          // Grab an existing pin if one is under the finger, otherwise drop a new one.
          const r = 12 / zoom;
          const pt = p;
          let hit = -1;
          for (let i = puppet.pins.length - 1; i >= 0; i--) {
            const pin = puppet.pins[i];
            if (Math.hypot(pin.x - pt.x, pin.y - pt.y) <= r) { hit = i; break; }
          }
          if (hit < 0) {
            puppet.pins.push({ x: pt.x, y: pt.y, ox: pt.x, oy: pt.y });
            hit = puppet.pins.length - 1;
            puppetPreview();
          }
          puppet.drag = hit;
          drawing = true;
          composite();
          return;
        }
        if (tool === 'vedit') {
          if (l.kind !== 'vector') return banner('Switch to a vector layer (VEC) to edit points.');
          const h = hitHandle(l, p);
          if (h) { vSel = h; vSel.mode = 'handle'; drawing = true; }
          else {
            const si = hitShape(l, p);
            if (si >= 0) { vSel = { shapeIndex: si, mode: 'shape', grab: p, orig: JSON.parse(JSON.stringify(l.shapes[si])) }; drawing = true; }
            else vSel = null;
          }
          composite();
          return;
        }
        if (tool === 'gradient') {
          if (l.kind === 'vector') return banner('Gradient works on raster layers.');
          gradStart = p; drawing = true; return;
        }
        if (tool === 'transform') {
          if (!xform) beginTransform();
          if (xform) {
            const hit = transformHit(p);
            xform.mode = hit ? hit.mode : 'move';
            xform.grab = { p, cx: xform.cx, cy: xform.cy, sx: xform.sx, sy: xform.sy, angle: xform.angle,
                           ang0: Math.atan2(p.y - xform.cy, p.x - xform.cx) };
            drawing = true;
          }
          return;
        }
        if (tool === 'move') {
          moveStart = p; moveSnapshot = l.ctx.getImageData(0, 0, W, H);
          drawing = true; return;
        }
        if (tool === 'pen') {
          // Snap each new point relative to the previous one when angle-snap is on,
          // so a click-to-click polyline locks to 0/45/90° just like the drag shapes.
          const pt = (penPts.length && vSnapEnabled) ? snapAngle(penPts[penPts.length - 1], p, 'line') : p;
          penPts.push({ x: pt.x, y: pt.y });
          previewShape = { type: 'path', pts: penPts.slice(), stroke: toolColor(), width: toolSize(), strokeOn: true, fill: ($('ps-vfill') && $('ps-vfill').checked) ? toolColor() : 'transparent' };
          drawPreview(); return;
        }
        if (DRAG_SHAPES.test(tool)) {
          shapeStart = p; drawing = true; return;
        }

        // brush / eraser / smudge / retouch — clipped to the selection if there is one
        drawing = true; last = p; dist = 0;
        beginStroke(l);
        strokeAt(l, p, p);
        compositeStroke(l);
      }

      // Pixel-level helpers shared by the retouch brushes (blur/dodge/burn).
      function patchOp(ctx, x, y, size, fn) {
        const s = Math.max(3, Math.ceil(size));
        const x0 = Math.floor(x - s / 2), y0 = Math.floor(y - s / 2);
        const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0);
        const cx1 = Math.min(W, x0 + s), cy1 = Math.min(H, y0 + s);
        const w = cx1 - cx0, h = cy1 - cy0;
        if (w <= 0 || h <= 0) return;
        const img = ctx.getImageData(cx0, cy0, w, h);
        fn(img, w, h, x - cx0, y - cy0, s / 2);
        ctx.putImageData(img, cx0, cy0);
      }
      // circular falloff weight for a pixel inside the brush
      const falloff = (dx, dy, r, hard) => {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) return 0;
        return hard >= 0.99 ? 1 : Math.min(1, (1 - d) / Math.max(0.001, 1 - hard));
      };

      // When a selection is active, brush work is drawn onto a scratch layer that
      // mirrors the target, then masked and blitted back — so strokes stop at the
      // selection edge. Retouch tools (blur/dodge/burn/smudge/clone) read pixels
      // directly, so they operate on the scratch copy too and stay consistent.
      let strokeScratch = null;
      function beginStroke(l) {
        if (!sel) { strokeScratch = null; return; }
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(l.canvas, 0, 0);
        strokeScratch = { canvas: c, ctx: x, before: l.ctx.getImageData(0, 0, W, H) };
      }
      function endStroke(l) {
        if (!strokeScratch) return;
        // Keep only what changed inside the selection: restore the original, then
        // paint the scratch result back through the mask.
        const masked = document.createElement('canvas'); masked.width = W; masked.height = H;
        const mx = masked.getContext('2d');
        mx.drawImage(strokeScratch.canvas, 0, 0);
        mx.globalCompositeOperation = 'destination-in';
        mx.drawImage(selMaskToCanvas(), 0, 0);
        l.ctx.setTransform(1, 0, 0, 1, 0, 0);
        l.ctx.putImageData(strokeScratch.before, 0, 0);
        l.ctx.save();
        l.ctx.globalCompositeOperation = 'destination-out';
        l.ctx.drawImage(selMaskToCanvas(), 0, 0);
        l.ctx.restore();
        l.ctx.drawImage(masked, 0, 0);
        strokeScratch = null;
        touch(l);
      }
      // Live preview mid-stroke: show the layer as it will land, without committing.
      function compositeStroke(l) {
        if (!strokeScratch) { composite(); return; }
        const masked = document.createElement('canvas'); masked.width = W; masked.height = H;
        const mx = masked.getContext('2d');
        mx.drawImage(strokeScratch.canvas, 0, 0);
        mx.globalCompositeOperation = 'destination-in';
        mx.drawImage(selMaskToCanvas(), 0, 0);
        // temporarily swap the layer's pixels for the preview
        const keep = l.canvas;
        const prev = document.createElement('canvas'); prev.width = W; prev.height = H;
        const px = prev.getContext('2d');
        px.putImageData(strokeScratch.before, 0, 0);
        px.save(); px.globalCompositeOperation = 'destination-out';
        px.drawImage(selMaskToCanvas(), 0, 0); px.restore();
        px.drawImage(masked, 0, 0);
        l.canvas = prev;
        composite();
        drawAnts();
        l.canvas = keep;
      }

      function strokeAt(l, from, to) {
        const ctx = (strokeScratch ? strokeScratch.ctx : l.ctx);
        const pressure = ($('pb-pressure').checked && to.p) ? (0.35 + to.p * 0.65) : 1;
        const size = toolSize() * pressure;
        const alpha = toolAlpha();
        const hard = hardness();
        const shape = brushShape();
        const col = toolColor();

        switch (tool) {
          case 'eraser':
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            brushStamp(ctx, to.x, to.y, size, '#000', hard, shape, alpha);
            ctx.restore();
            break;

          case 'pencil': {
            // Hard-edged, no feathering, no build-up — like a pixel pencil.
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.fillStyle = col;
            const r = Math.max(1, size / 2);
            ctx.beginPath(); ctx.arc(to.x, to.y, r, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            break;
          }

          case 'marker':
            // Translucent ink that builds where strokes overlap.
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            brushStamp(ctx, to.x, to.y, size, col, Math.min(hard, 0.9), shape, alpha * 0.5);
            ctx.restore();
            break;

          case 'airbrush': {
            // Soft, low-opacity build-up — many faint stamps.
            ctx.save();
            brushStamp(ctx, to.x, to.y, size, col, 0.02, 'round', alpha * 0.12);
            ctx.restore();
            break;
          }

          case 'calligraphy': {
            // A flat nib: width depends on stroke direction.
            const ang = Math.atan2(to.y - from.y, to.x - from.x);
            const nib = THREEangle(); // nib angle in radians (from slider)
            const w = Math.max(1, size * Math.abs(Math.sin(ang - nib)) + size * 0.12);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.lineCap = 'butt';
            ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
            ctx.restore();
            break;
          }

          case 'spray': {
            // Random stipple within the brush radius.
            const r = size / 2;
            const n = Math.max(4, Math.round(r * 0.9));
            ctx.save();
            ctx.fillStyle = col;
            for (let i = 0; i < n; i++) {
              const a = Math.random() * Math.PI * 2;
              const d = Math.sqrt(Math.random()) * r;
              ctx.globalAlpha = alpha * (0.25 + Math.random() * 0.5);
              ctx.beginPath();
              ctx.arc(to.x + Math.cos(a) * d, to.y + Math.sin(a) * d, Math.max(0.5, size * 0.03), 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
            break;
          }

          case 'smudge': {
            const s = Math.max(2, Math.floor(size));
            const sx = Math.floor(from.x - s / 2), sy = Math.floor(from.y - s / 2);
            if (sx >= 0 && sy >= 0 && sx + s <= W && sy + s <= H) {
              const patch = ctx.getImageData(sx, sy, s, s);
              ctx.save(); ctx.globalAlpha = 0.5 * alpha;
              ctx.putImageData(patch, Math.floor(to.x - s / 2), Math.floor(to.y - s / 2));
              ctx.restore();
            }
            break;
          }

          case 'blurbrush':
            // Local box blur weighted by the brush falloff.
            patchOp(ctx, to.x, to.y, size, (img, w, h, bx, by, r) => {
              const src = new Uint8ClampedArray(img.data);
              const at = (x, y, c) => src[((y * w) + x) * 4 + c];
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const wgt = falloff(x - bx, y - by, r, hard) * alpha;
                if (wgt <= 0) continue;
                for (let c = 0; c < 4; c++) {
                  let sum = 0, n = 0;
                  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    sum += at(nx, ny, c); n++;
                  }
                  const i = ((y * w) + x) * 4 + c;
                  img.data[i] = src[i] + (sum / n - src[i]) * wgt;
                }
              }
            });
            break;

          case 'dodge':
          case 'burn': {
            const up = tool === 'dodge';
            patchOp(ctx, to.x, to.y, size, (img, w, h, bx, by, r) => {
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const wgt = falloff(x - bx, y - by, r, hard) * alpha * 0.28;
                if (wgt <= 0) continue;
                const i = ((y * w) + x) * 4;
                if (img.data[i + 3] === 0) continue;
                for (let c = 0; c < 3; c++) {
                  const v = img.data[i + c];
                  img.data[i + c] = up ? v + (255 - v) * wgt : v * (1 - wgt);
                }
              }
            });
            break;
          }

          case 'clone': {
            if (!cloneSrc) return;
            if (!cloneOffset) cloneOffset = { x: cloneSrc.x - to.x, y: cloneSrc.y - to.y };
            const s = Math.max(2, Math.ceil(size));
            const sx = Math.round(to.x + cloneOffset.x - s / 2), sy = Math.round(to.y + cloneOffset.y - s / 2);
            if (sx < 0 || sy < 0 || sx + s > W || sy + s > H) return;
            // Sample a clean flatten (not the on-screen canvas, which also carries
            // marching ants and vector handles) so clones never pick up overlays.
            const tmp = document.createElement('canvas'); tmp.width = s; tmp.height = s;
            tmp.getContext('2d').drawImage(flatten(), sx, sy, s, s, 0, 0, s, s);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(to.x, to.y, s / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(tmp, Math.round(to.x - s / 2), Math.round(to.y - s / 2));
            ctx.restore();
            break;
          }

          default:   // brush
            brushStamp(ctx, to.x, to.y, size, col, hard, shape, alpha);
        }
      }
      // nib angle for the calligraphy tool, in radians
      function THREEangle() { const e = $('ps-nib'); return ((parseInt(e ? e.value : 45) || 45) * Math.PI) / 180; }

      function drawPreview() {
        composite();
        if (!previewShape) return;
        const s = previewShape;
        vctx.save();
        vctx.strokeStyle = s.stroke; vctx.lineWidth = s.width;
        vctx.fillStyle = s.fill || 'transparent';
        vctx.lineCap = 'round'; vctx.lineJoin = 'round';
        vctx.beginPath();
        shapePath(vctx, s);
        if (s.fill && s.fill !== 'transparent') vctx.fill();
        vctx.stroke();
        vctx.restore();
      }

      function onMove(e) {
        const l = active(); if (!l) return;
        // While actively dragging on touch/pen, keep the browser's own gesture from
        // fighting ours — the cause of the touch-only shape dodge.
        if (drawing && e.pointerType !== 'mouse' && e.cancelable) e.preventDefault();
        const p = pos(e);
        // keep the ring under the pointer; repaint only when idle so strokes stay fast
        if (RING_TOOLS.test(tool)) {
          cursorPos = p;
          if (!drawing) composite();
        }

        // --- selection gestures ---
        if (tool === 'puppet' && puppet && drawing && puppet.drag != null) {
          const pin = puppet.pins[puppet.drag];
          if (pin) { pin.x = p.x; pin.y = p.y; puppetPreview(); }
          return;
        }
        if (drawing && selDrag && /^(selrect|seloval|lasso)$/.test(tool)) {
          // Shift (or the Lock ratio toggle) keeps the selection box even — a perfect
          // square for Rectangle select, a circle for Oval select. Lasso is freehand
          // so it's unaffected. Constrain the point first so the marquee preview and
          // the committed selection always agree.
          let sp = p;
          if (tool !== 'lasso' && ((e && e.shiftKey) || aspectLock)) {
            const dx = p.x - selDrag.x0, dy = p.y - selDrag.y0;
            const s = Math.max(Math.abs(dx), Math.abs(dy));
            sp = { x: selDrag.x0 + Math.sign(dx || 1) * s, y: selDrag.y0 + Math.sign(dy || 1) * s, p: p.p };
          }
          selDrag.x1 = sp.x; selDrag.y1 = sp.y;
          if (tool === 'lasso') selDrag.pts.push({ x: sp.x, y: sp.y });
          composite();
          vctx.save();
          vctx.strokeStyle = '#5dd6ff'; vctx.lineWidth = 1 / zoom;
          vctx.setLineDash([4 / zoom, 3 / zoom]);
          vctx.beginPath();
          if (tool === 'selrect') vctx.rect(Math.min(selDrag.x0, sp.x), Math.min(selDrag.y0, sp.y), Math.abs(sp.x - selDrag.x0), Math.abs(sp.y - selDrag.y0));
          else if (tool === 'seloval') vctx.ellipse((selDrag.x0 + sp.x) / 2, (selDrag.y0 + sp.y) / 2, Math.abs(sp.x - selDrag.x0) / 2, Math.abs(sp.y - selDrag.y0) / 2, 0, 0, Math.PI * 2);
          else { const q = selDrag.pts; vctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < q.length; i++) vctx.lineTo(q[i].x, q[i].y); }
          vctx.stroke(); vctx.restore();
          return;
        }
        if (drawing && textDrag && liveText) {
          liveText.x = p.x - textDrag.dx;
          liveText.y = p.y - textDrag.dy;
          composite();
          return;
        }
        if (drawing && selMoveState && tool === 'selmove' && floatSel) {
          floatSel.x = selMoveState.ox + (p.x - selMoveState.start.x);
          floatSel.y = selMoveState.oy + (p.y - selMoveState.start.y);
          syncFloatMask();
          composite();
          return;
        }

        if (tool === 'vedit') {
          if (drawing && vSel) {
            const s = l.shapes[vSel.shapeIndex];
            if (!s) return;
            if (vSel.mode === 'handle') setHandle(s, vSel.handleIndex, p.x, p.y);
            else {
              // drag the whole shape by the offset since grab
              const dx = p.x - vSel.grab.x, dy = p.y - vSel.grab.y;
              const o = vSel.orig;
              if (s.type === 'path') s.pts.forEach((pt, i) => { pt.x = o.pts[i].x + dx; pt.y = o.pts[i].y + dy; });
              else { s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; s.x2 = o.x2 + dx; s.y2 = o.y2 + dy; }
            }
            renderVector(l); composite();
          } else {
            const h = hitHandle(l, p);
            const changed = JSON.stringify(h) !== JSON.stringify(vHover);
            vHover = h;
            view.style.cursor = h ? 'grab' : (hitShape(l, p) >= 0 ? 'move' : 'default');
            if (changed) { composite(); }
          }
          return;
        }

        if (tool === 'pen' && penPts.length) {
          const pe = (penPts.length && vSnapEnabled) ? snapAngle(penPts[penPts.length-1], p, 'line') : p;
          previewShape = { type:'path', pts: penPts.concat([{x:pe.x,y:pe.y}]), stroke: toolColor(), width: toolSize(), strokeOn:true, fill:'transparent' };
          drawPreview(); return;
        }
        if (!drawing) return;

        if (tool === 'transform' && drawing && xform && xform.grab) {
          const g = xform.grab;
          if (xform.mode === 'move') {
            xform.cx = g.cx + (p.x - g.p.x);
            xform.cy = g.cy + (p.y - g.p.y);
          } else if (xform.mode === 'rotate') {
            const now = Math.atan2(p.y - xform.cy, p.x - xform.cx);
            xform.angle = g.angle + (now - g.ang0);
          } else if (xform.mode === 'scale') {
            // distance from centre along the box's local axes, relative to grab
            const ca=Math.cos(-g.angle), sa=Math.sin(-g.angle);
            const toLocal = (px,py)=>{ const dx=px-xform.cx, dy=py-xform.cy; return { x:dx*ca-dy*sa, y:dx*sa+dy*ca }; };
            const gl = toLocal(g.p.x, g.p.y), nl = toLocal(p.x, p.y);
            let nsx = g.sx * (Math.abs(nl.x) / (Math.abs(gl.x)||1));
            let nsy = g.sy * (Math.abs(nl.y) / (Math.abs(gl.y)||1));
            if ($('pt-keep-aspect') && $('pt-keep-aspect').checked) { const s=Math.max(nsx,nsy); nsx=nsy=s; }
            xform.sx = Math.max(0.02, nsx); xform.sy = Math.max(0.02, nsy);
          }
          composite(); return;
        }
        if (tool === 'move' && moveStart && moveSnapshot) {
          const dx = Math.round(p.x - moveStart.x), dy = Math.round(p.y - moveStart.y);
          l.ctx.setTransform(1,0,0,1,0,0);
          l.ctx.clearRect(0,0,W,H);
          l.ctx.putImageData(moveSnapshot, dx, dy);
          composite(); return;
        }
        if (tool === 'gradient' && gradStart) {
          composite();
          vctx.save();
          const g = makeGradient(vctx, gradStart.x, gradStart.y, p.x, p.y);
          vctx.fillStyle = g; vctx.fillRect(0, 0, W, H);
          vctx.strokeStyle = 'rgba(255,255,255,.85)'; vctx.lineWidth = 1;
          vctx.beginPath(); vctx.moveTo(gradStart.x, gradStart.y); vctx.lineTo(p.x, p.y); vctx.stroke();
          vctx.restore();
          return;
        }
        if (DRAG_SHAPES.test(tool)) {
          const e2 = snapAngle(shapeStart, p, tool, e && e.shiftKey);
          previewShape = {
            type: tool, x1: shapeStart.x, y1: shapeStart.y, x2: e2.x, y2: e2.y,
            sides: parseInt($('ps-sides') ? $('ps-sides').value : 5) || 5,
            points: parseInt($('ps-sides') ? $('ps-sides').value : 5) || 5,
            stroke: toolColor(), width: toolSize(),
            fill: ($('ps-vfill') && $('ps-vfill').checked) ? toolColor() : 'transparent',
            strokeOn: ($('ps-vstroke') && $('ps-vstroke').checked)
          };
          drawPreview(); return;
        }

        // brush-family: interpolate along the segment for a smooth line
        const dx = p.x - last.x, dy = p.y - last.y;
        const seg = Math.hypot(dx, dy);
        const step = spacing();
        if (seg < step) return;
        const n = Math.floor(seg / step);
        for (let i = 1; i <= n; i++) {
          const t = (step * i) / seg;
          const q = { x: last.x + dx * t, y: last.y + dy * t, p: p.p };
          strokeAt(l, last, q);
        }
        last = { x: last.x + dx * ((step*n)/seg), y: last.y + dy * ((step*n)/seg), p: p.p };
        compositeStrokeSoon(l);
      }

      // Pointer events can arrive several times per frame (pen/high-rate mice), and
      // compositing re-draws every layer at full canvas size. The stroke itself is
      // still painted for every event; only the on-screen redraw is coalesced to
      // once per animation frame. onUp flushes it so the final segment always shows.
      let _strokeRaf = 0, _strokeLayer = null;
      function compositeStrokeSoon(l) {
        _strokeLayer = l;
        if (_strokeRaf) return;
        _strokeRaf = requestAnimationFrame(() => {
          _strokeRaf = 0;
          const sl = _strokeLayer; _strokeLayer = null;
          if (drawing && sl) compositeStroke(sl);
        });
      }

      function onUp(e) {
        if (tool === 'puppet' && puppet) { puppet.drag = null; drawing = false; composite(); return; }
        let l = active();          // may be swapped for a fresh vector layer below
        if (!l) return;

        // --- finish a selection gesture ---
        if (selDrag && /^(selrect|seloval|lasso)$/.test(tool)) {
          const d = selDrag; selDrag = null; drawing = false;
          const tiny = Math.abs(d.x1 - d.x0) < 2 && Math.abs(d.y1 - d.y0) < 2;
          if (tiny && tool !== 'lasso') { clearSelection(); banner('Selection cleared.'); return; }
          const m = maskFromDraw(x => {
            x.beginPath();
            if (tool === 'selrect') x.rect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
            else if (tool === 'seloval') x.ellipse((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, Math.abs(d.x1 - d.x0) / 2, Math.abs(d.y1 - d.y0) / 2, 0, 0, Math.PI * 2);
            else { const q = d.pts; if (q.length < 3) return; x.moveTo(q[0].x, q[0].y); for (let i = 1; i < q.length; i++) x.lineTo(q[i].x, q[i].y); x.closePath(); }
            x.fill();
          });
          selFromMask(m);
          composite();
          banner(sel ? 'Selected — painting is limited to this area.' : 'Selection cleared.');
          return;
        }
        if (textDrag) { textDrag = null; drawing = false; return; }
        if (selMoveState && tool === 'selmove') {
          selMoveState = null; drawing = false;
          // NOTE: the float deliberately stays lifted so it can be dragged again.
          // It's committed by dropSelection() on deselect / tool change / edit.
          pushHistory(); renderLayerList(); composite();
          return;
        }

        if (tool === 'vedit') {
          if (drawing && vSel) { pushHistory(); renderLayerList(); }
          drawing = false;
          if (vSel) vSel.mode = null;
          composite();
          return;
        }
        if (tool === 'gradient' && gradStart && drawing) {
          const p = pos(e);
          const g = makeGradient(l.ctx, gradStart.x, gradStart.y, p.x, p.y);
          l.ctx.save();
          l.ctx.globalAlpha = toolAlpha() / Math.max(0.001, fg.a);
          l.ctx.fillStyle = g; l.ctx.fillRect(0, 0, W, H);
          l.ctx.restore();
          gradStart = null; drawing = false;
          composite(); pushHistory(); renderLayerList();
          return;
        }
        if (DRAG_SHAPES.test(tool)) {
          if (previewShape && drawing) {
            l = layerForShape() || l;
            if (l.kind === 'vector') { l.shapes.push(previewShape); renderVector(l); }
            else { // stamp into pixels
              const c = l.ctx;
              c.save(); c.strokeStyle = previewShape.stroke; c.fillStyle = previewShape.fill;
              c.lineWidth = previewShape.width; c.lineCap='round'; c.lineJoin='round';
              c.beginPath();
              const s = previewShape;
              shapePath(c, s);   // same builder as the preview and vector render
              if (s.fill && s.fill!=='transparent') c.fill();
              if (s.strokeOn) c.stroke();
              c.restore();
            }
            previewShape = null; composite(); pushHistory(); renderLayerList();
          }
          drawing = false; shapeStart = null; return;
        }
        if (_strokeRaf) { cancelAnimationFrame(_strokeRaf); _strokeRaf = 0; _strokeLayer = null; composite(); }
        if (drawing && strokeScratch) { endStroke(l); composite(); }
        if (drawing && tool !== 'pen') { pushHistory(); renderLayerList(); }
        drawing = false; last = null; moveStart = null; moveSnapshot = null;
        cloneOffset = null;   // next clone stroke re-anchors from the source point
      }

      function finishPen() {
        let l = active();          // may be swapped for a fresh vector layer below
        if (!l || penPts.length < 2) { penPts = []; previewShape = null; composite(); return; }
        const shape = { type:'path', pts: penPts.slice(), stroke: toolColor(), width: toolSize(),
          strokeOn: ($('ps-vstroke') && $('ps-vstroke').checked), fill: ($('ps-vfill') && $('ps-vfill').checked) ? toolColor() : 'transparent', closed: ($('ps-vfill') && $('ps-vfill').checked) };
        l = layerForShape() || l;
        if (l.kind === 'vector') { l.shapes.push(shape); renderVector(l); }
        else {
          const c = l.ctx; c.save();
          c.strokeStyle = shape.stroke; c.fillStyle = shape.fill; c.lineWidth = shape.width;
          c.lineCap='round'; c.lineJoin='round'; c.beginPath();
          c.moveTo(shape.pts[0].x, shape.pts[0].y);
          for (let i=1;i<shape.pts.length;i++) c.lineTo(shape.pts[i].x, shape.pts[i].y);
          if (shape.closed) c.closePath();
          if (shape.fill!=='transparent') c.fill();
          if (shape.strokeOn) c.stroke();
          c.restore();
        }
        penPts = []; previewShape = null; composite(); pushHistory(); renderLayerList();
      }

      // ── Layer list UI ───────────────────────────────────────────────────────
      function renderLayerList() {
        const box = $('layer-list'); if (!box) return;
        box.innerHTML = '';
        // Walk top-to-bottom in display order (reverse of paint order). Group headers
        // render as folder rows; their children render indented directly beneath and
        // are hidden when the group is collapsed.
        [...layers].reverse().forEach(l => {
          if (l.kind === 'group') { box.appendChild(buildGroupRow(l)); return; }
          // Skip children of a collapsed group.
          const g = layerGroupOf(l);
          if (g && g.collapsed) return;
          box.appendChild(buildLayerRow(l, !!g));
        });
        syncLayerControls();
        syncMaskButton();
      }

      // Rename a layer or group in place. window.prompt() opens an OS dialog that
      // sits outside the app, can't be styled, and on iPad covers the very thing
      // you're renaming. This swaps the label for a real input on the row itself.
      function inlineRename(labelEl, current, commit) {
        const row = labelEl.parentElement;
        if (!row || row.querySelector('.layer-rename')) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'layer-rename';
        input.value = current || '';
        labelEl.style.display = 'none';
        row.insertBefore(input, labelEl.nextSibling);
        let done = false;
        const finish = (save) => {
          if (done) return; done = true;
          const v = input.value.trim();
          input.remove();
          labelEl.style.display = '';
          if (save && v) commit(v);
          else renderLayerList();
        };
        input.onkeydown = (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
        };
        input.onblur = () => finish(true);
        input.onclick = (ev) => ev.stopPropagation();
        input.ondblclick = (ev) => ev.stopPropagation();
        setTimeout(() => { input.focus(); input.select(); }, 0);
      }

      // A folder row: collapse chevron, eye, folder icon, name, child count.
      function buildGroupRow(g) {
        const row = document.createElement('div');
        row.className = 'layer-group-row' + (g.id === activeId ? ' active' : '') + (g.visible ? '' : ' hidden-layer');
        const chev = document.createElement('button');
        chev.className = 'layer-group-chevron' + (g.collapsed ? ' collapsed' : '');
        chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        chev.title = g.collapsed ? 'Expand group' : 'Collapse group';
        chev.onclick = (ev) => { ev.stopPropagation(); g.collapsed = !g.collapsed; renderLayerList(); saveSoon(); };
        const eye = document.createElement('button');
        eye.className = 'layer-eye';
        eye.innerHTML = g.visible
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.9 4.2A10 10 0 0 1 12 4c6 0 10 8 10 8a18 18 0 0 1-2.3 3.2M6.6 6.6A17 17 0 0 0 2 12s4 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/></svg>';
        eye.onclick = (ev) => { ev.stopPropagation(); g.visible = !g.visible; composite(); renderLayerList(); saveSoon(); };
        const ic = document.createElement('span');
        ic.className = 'layer-group-icon';
        ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h5l2 3h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>';
        const nm = document.createElement('div');
        nm.className = 'layer-name'; nm.textContent = g.name;
        nm.ondblclick = (ev) => { ev.stopPropagation();
          inlineRename(nm, g.name, (v) => { g.name = v; renderLayerList(); saveSoon(); }); };
        const count = layers.filter(x => x.groupId === g.id).length;
        const badge = document.createElement('span');
        badge.className = 'layer-kind'; badge.textContent = count + (count === 1 ? ' layer' : ' layers');
        row.append(chev, eye, ic, nm, badge);
        row.onclick = () => { exitMaskEdit(); if (xform) commitTransform(); activeId = g.id; vSel = null; renderLayerList(); composite(); };
        return row;
      }

      // A normal layer row. `inGroup` indents it and marks it as a group child.
      function buildLayerRow(l, inGroup) {
        const row = document.createElement('div');
        row.className = 'layer-row' + (l.id === activeId ? ' active' : '') + (l.visible ? '' : ' hidden-layer') + (inGroup ? ' layer-in-group' : '');
        const eye = document.createElement('button');
        eye.className = 'layer-eye';
        eye.innerHTML = l.visible
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.9 4.2A10 10 0 0 1 12 4c6 0 10 8 10 8a18 18 0 0 1-2.3 3.2M6.6 6.6A17 17 0 0 0 2 12s4 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/></svg>';
        eye.onclick = (ev) => { ev.stopPropagation(); l.visible = !l.visible; composite(); renderLayerList(); saveSoon(); };
        // Grip — the visual cue that a row can be dragged.
        row.dataset.layerId = l.id;      // needed by the drag-to-reorder logic
        const grip = document.createElement('div');
        grip.className = 'layer-grip';
        grip.title = 'Drag to reorder';
        grip.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

        // Thumbnail at 44px with a checkerboard behind it, so transparent areas
        // read as transparent instead of as black — at 26px with no backing you
        // couldn't tell an empty layer from a dark one.
        const TH = 44;
        const th = document.createElement('canvas');
        th.className = 'layer-thumb';
        th.width = TH * 2; th.height = TH * 2;      // 2x for crisp retina rendering
        const tc = th.getContext('2d');
        const sq = 8;
        for (let yy = 0; yy < TH*2; yy += sq) for (let xx = 0; xx < TH*2; xx += sq) {
          tc.fillStyle = (((xx + yy) / sq) % 2) ? '#2a2e35' : '#343941';
          tc.fillRect(xx, yy, sq, sq);
        }
        // Fit the canvas into the square without distorting its aspect ratio.
        if (l.canvas && l.canvas.width && l.canvas.height) {
          const s = Math.min((TH*2) / l.canvas.width, (TH*2) / l.canvas.height);
          const dw = l.canvas.width * s, dh = l.canvas.height * s;
          tc.imageSmoothingQuality = 'high';
          tc.drawImage(l.canvas, ((TH*2) - dw) / 2, ((TH*2) - dh) / 2, dw, dh);
        }

        const info = document.createElement('div');
        info.className = 'layer-info';
        const nm = document.createElement('div');
        nm.className = 'layer-name'; nm.textContent = l.name;
        nm.ondblclick = (ev) => {
          ev.stopPropagation();
          inlineRename(nm, l.name, (v) => { l.name = v; renderLayerList(); saveSoon(); });
        };
        // Clicking the name of the layer you're already on renames it — the same
        // convention as the object browser, and easier on a touch screen than
        // finding a double-tap.
        nm.onclick = (ev) => {
          if (l.id !== activeId) return;           // first click just selects
          ev.stopPropagation();
          inlineRename(nm, l.name, (v) => { l.name = v; renderLayerList(); saveSoon(); });
        };
        const sub = document.createElement('div');
        sub.className = 'layer-sub';
        const bits = [l.kind === 'vector' ? 'VEC' : 'PIX'];
        if (l.blend && l.blend !== 'source-over' && l.blend !== 'normal') bits.push(String(l.blend));
        if (l.opacity != null && l.opacity < 1) bits.push(Math.round(l.opacity * 100) + '%');
        if (l.texts && l.texts.length) bits.push('TXT');
        if (fxActive(l)) bits.push('FX');
        sub.textContent = bits.join(' · ');
        info.append(nm, sub);

        // Quick actions on the row itself: effects and mask, without hunting
        // through the panel below.
        const acts = document.createElement('div');
        acts.className = 'layer-acts';
        const mkAct = (title, svg, on, fn) => {
          const b = document.createElement('button');
          b.className = 'layer-act' + (on ? ' on' : '');
          b.title = title; b.innerHTML = svg;
          b.onclick = (ev) => { ev.stopPropagation(); fn(); };
          return b;
        };
        acts.append(
          mkAct('Layer effects', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>',
            fxActive(l), () => { activeId = l.id; renderLayerList(); const o = $('fx-open'); if (o) o.click(); }),
          mkAct(l.mask ? 'Layer mask — click to edit' : 'Add layer mask', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M3 12h9" fill="currentColor"/></svg>',
            !!l.mask, () => {
              activeId = l.id;
              if (!l.mask) {
                const btn = $('pl-mask-add');
                if (btn) btn.click();               // create it, then show the dialog
              }
              renderLayerList();
              if (window.openMaskDialog) openMaskDialog(l);
            })
        );
        row.append(grip, eye, th, info, acts);

        // ── Drag to reorder ────────────────────────────────────────────────
        // Pointer events rather than HTML5 drag-and-drop, because the latter is
        // unreliable on touch — this needs to work on the iPad. The row follows
        // your finger and a bar shows exactly where it will land.
        grip.addEventListener('pointerdown', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          grip.setPointerCapture(ev.pointerId);
          const list = row.parentElement;
          if (!list) return;
          row.classList.add('dragging');
          let target = null, place = 'above';

          const clearMarks = () => list.querySelectorAll('.layer-row').forEach(r =>
            r.classList.remove('drop-above', 'drop-below'));

          const onMove = (e) => {
            clearMarks();
            target = null;
            const rows = [...list.querySelectorAll('.layer-row')].filter(r => r !== row);
            for (const r of rows) {
              const b = r.getBoundingClientRect();
              if (e.clientY >= b.top && e.clientY <= b.bottom) {
                target = r;
                place = (e.clientY < b.top + b.height / 2) ? 'above' : 'below';
                r.classList.add(place === 'above' ? 'drop-above' : 'drop-below');
                break;
              }
            }
          };
          const onUp = () => {
            grip.removeEventListener('pointermove', onMove);
            grip.removeEventListener('pointerup', onUp);
            grip.removeEventListener('pointercancel', onUp);
            row.classList.remove('dragging');
            clearMarks();
            if (!target) return;
            const fromId = l.id, toId = target.dataset.layerId;
            if (!toId || toId === fromId) return;
            const from = layers.findIndex(x => x.id === fromId);
            let to = layers.findIndex(x => x.id === toId);
            if (from < 0 || to < 0) return;
            // The list is drawn top-to-bottom as topmost-first, but `layers` is
            // bottom-first — so "above" in the UI means a HIGHER index.
            const moved = layers.splice(from, 1)[0];
            to = layers.findIndex(x => x.id === toId);
            const insertAt = (place === 'above') ? to + 1 : to;
            layers.splice(insertAt, 0, moved);
            activeId = fromId;
            renderLayerList(); composite(); pushHistory('Reordered layers'); saveSoon();
          };
          grip.addEventListener('pointermove', onMove);
          grip.addEventListener('pointerup', onUp);
          grip.addEventListener('pointercancel', onUp);
        });
        if (l.mask) {
          const mth = document.createElement('canvas');
          mth.className = 'layer-mask-chip' + (maskEditing && l.id === activeId ? ' editing' : '');
          mth.width = 20; mth.height = 20;
          mth.title = (maskEditing && l.id === activeId) ? 'Editing mask — click to stop' : 'Layer mask — click to open mask options';
          const mc = mth.getContext('2d');
          mc.fillStyle = '#3a3f47'; mc.fillRect(0,0,20,20);
          mc.fillStyle = '#2a2e35';
          for (let yy=0; yy<20; yy+=5) for (let xx=0; xx<20; xx+=5) if (((xx+yy)/5)%2) mc.fillRect(xx,yy,5,5);
          mc.drawImage(l.mask, 0, 0, 20, 20);
          // Click toggles mask painting (the common action); right-click or a long
          // press opens the full mask options, so both are reachable from the row.
          mth.onclick = (ev) => {
            ev.stopPropagation();
            if (l.id !== activeId) { activeId = l.id; renderLayerList(); syncLayerControls(); composite(); }
            toggleMaskPaint();
          };
          mth.oncontextmenu = (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (window.openMaskDialog) openMaskDialog(l);
          };
          let mHold = null;
          mth.addEventListener('pointerdown', () => {
            mHold = setTimeout(() => { if (window.openMaskDialog) openMaskDialog(l); }, 550);
          });
          ['pointerup','pointerleave','pointercancel'].forEach(ev =>
            mth.addEventListener(ev, () => { if (mHold) clearTimeout(mHold); mHold = null; }));
          row.append(mth);
        }
        // Join/leave group toggle: puts the layer into the nearest group above it,
        // or pulls it out if already grouped.
        const gt = document.createElement('button');
        gt.className = 'layer-group-toggle';
        gt.title = inGroup ? 'Remove from group' : 'Add to group above';
        gt.textContent = inGroup ? '⊟' : '⊞';
        gt.onclick = (ev) => { ev.stopPropagation(); toggleLayerGroup(l); };
        row.append(gt);
        row.onclick = () => {
          exitMaskEdit();
          if (xform) commitTransform();
          activeId = l.id; vSel = null; renderLayerList(); syncLayerControls(); composite();
        };
        return row;
      }

      // Join the layer to the nearest group header above it in paint order, or if it's
      // already in a group, remove it. Keeps the layer's pixels; only its membership
      // changes.
      function toggleLayerGroup(l) {
        if (l.groupId) { l.groupId = null; renderLayerList(); saveSoon(); return; }
        const idx = layers.indexOf(l);
        let gid = null;
        for (let i = idx + 1; i < layers.length; i++) {   // upward in display = later in array
          if (layers[i].kind === 'group') { gid = layers[i].id; break; }
        }
        if (!gid) { banner('No group above this layer — make a group first.'); return; }
        l.groupId = gid;
        renderLayerList(); composite(); saveSoon();
      }
      // Set during panel wiring; lets syncLayerControls refresh the effects panel
      // without depending on wiring order.
      let _syncFX = null;
      function syncLayerControls() {
        const l = active(); if (!l) return;
        const b = $('pl-blend'); if (b) b.value = l.blend;
        const o = $('pl-opacity'); if (o) o.value = Math.round(l.opacity * 100);
        const ov = $('pl-op-val'); if (ov) ov.textContent = Math.round(l.opacity * 100) + '%';
        if (_syncFX) _syncFX();
      }

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

      // ── Wiring ──────────────────────────────────────────────────────────────
      function wire() {
        if (!view) return;
        // passive:false is required or the browser ignores preventDefault on touch,
        // and the gesture-dodge returns. touch-action:none in CSS covers most of it,
        // but Safari still needs the explicit non-passive listener.
        view.addEventListener('pointerdown', onDown, { passive: false });
        view.addEventListener('pointermove', onMove, { passive: false });
        view.addEventListener('pointerleave', () => { if (cursorPos) { cursorPos = null; composite(); } });
        view.addEventListener('pointerup', onUp);
        view.addEventListener('pointercancel', onUp);
        view.addEventListener('dblclick', () => { if (tool === 'pen') finishPen(); });

        buildRail();

        $('ps-tol').oninput = e => $('ps-tol-val').textContent = e.target.value + '%';
        const selAll = () => { selFromMask(new Uint8Array(W * H).fill(1)); composite(); banner('Selected the whole canvas.'); };
        const selNone = () => { clearSelection(); banner('Deselected.'); };
        $('ps-sel-all').onclick = selAll;
        $('ps-sel-none').onclick = selNone;
        $('ps-sel-all2').onclick = selAll;
        $('ps-sel-none2').onclick = selNone;
        $('ps-sel-invert').onclick = () => { invertSelection(); banner('Selection inverted.'); };
        $('ps-hard').oninput = e => $('ps-hard-val').textContent = e.target.value + '%';
        $('ps-nib').oninput = e => $('ps-nib-val').textContent = e.target.value + '°';
        // Font/size/colour changes re-render live text on the spot, so you can try
        // options against the artwork before setting it down.
        $('ps-textsize').oninput = e => {
          $('ps-textsize-val').textContent = e.target.value;
          updateLiveText({ size: parseInt(e.target.value) || 72 });
        };
        $('ps-font').onchange = e => updateLiveText({ key: e.target.value });
        // in-app text entry
        if ($('ps-text-ok')) $('ps-text-ok').onclick = acceptText;
        if ($('ps-text-cancel')) $('ps-text-cancel').onclick = closeTextPop;
        if ($('ps-text-input')) $('ps-text-input').onkeydown = (ev) => {
          ev.stopPropagation();   // don't let tool shortcuts fire while typing
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); acceptText(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); closeTextPop(); }
        };
        // Re-run magic select live when its settings change, so the slider is
        // something you can feel rather than guess at.
        ['ps-invert', 'ps-global'].forEach(id => {
          const el = $(id);
          if (el) el.onchange = () => { if (tool === 'magic' && lastMagic) { magicSelect(lastMagic.x, lastMagic.y); composite(); } };
        });
        $('ps-tol').onchange = () => { if (tool === 'magic' && lastMagic) { magicSelect(lastMagic.x, lastMagic.y); composite(); } };
        // text: share the 3D side's font list and uploader
        syncFontList();
        $('ps-font-upload').onclick = () => {
          const b = document.getElementById('bld-text3d-upload');
          if (b) { b.click(); setTimeout(syncFontList, 1500); }
          else banner('Font upload lives on the 3D side — switch to 3D › Create › 3D Text.');
        };
        requestAnimationFrame(antsTick);

        document.querySelectorAll('#paint-tabs button[data-ptab]').forEach(b => {
          b.onclick = () => { _userPickedTab = b.dataset.ptab; showPaintTab(b.dataset.ptab); };
        });
        // Apply the starting tab once. Without this the docks keep whatever
        // visibility their markup had, so the Swatches dock appeared under Layers
        // as well as under Colour — the per-tab rule only took effect after the
        // first manual tab change.
        showPaintTab('layers');

        $('ps-size').oninput = e => {
          $('ps-size-val').textContent = e.target.value;
          toolSizes[sizeFor(tool)] = parseInt(e.target.value) || 12;
          updateLiveText({});   // shape/text previews follow the slider live
        };
        $('ps-flow').oninput = e => $('ps-flow-val').textContent = e.target.value + '%';
        if ($('ps-sides')) $('ps-sides').oninput = e => {
          $('ps-sides-val').textContent = e.target.value;
          if (previewShape) drawPreview();
        };
        $('pb-space').oninput = e => $('pb-space-val').textContent = e.target.value + '%';
        document.querySelectorAll('#pb-shape .tip-btn').forEach(b => b.onclick = () => {
          document.querySelectorAll('#pb-shape .tip-btn, #pb-custom-tips .tip-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          syncTipUI();
        });
        if ($('pb-angle')) $('pb-angle').oninput = e => {
          $('pb-angle-val').textContent = e.target.value + '°';
          drawTipPreviews();
        };
        // Custom brush import
        if ($('pb-import-brush') && $('pb-brush-file')) {
          $('pb-import-brush').onclick = () => $('pb-brush-file').click();
          $('pb-brush-file').onchange = e => { importBrushImages(e.target.files); e.target.value = ''; };
        }
        loadCustomBrushes();
        drawTipPreviews(); syncTipUI();
        if ($('pb-sides-mirror')) $('pb-sides-mirror').oninput = e => {
          if ($('ps-sides')) { $('ps-sides').value = e.target.value; $('ps-sides').dispatchEvent(new Event('input')); }
          if ($('pb-sides-val')) $('pb-sides-val').textContent = e.target.value;
        };
        if ($('ps-vsnap')) $('ps-vsnap').onchange = e => {
          vSnapEnabled = e.target.checked;
          banner(vSnapEnabled ? 'Angle-snap on — lines lock to 0/45/90°, boxes to square.' : 'Angle-snap off — freehand shapes.');
        };
        // ── Menu bar ──────────────────────────────────────────────────────────
        // Everything here already existed somewhere — behind a tab, a popover or a
        // button on a panel you had to find first. Gathering the commands under
        // File / Edit / Layer / Filter / View puts them where anyone coming from
        // Photoshop or GIMP will look, without changing what they do.
        const MENUS = [
          { name: 'File', items: [
            { label: 'New / clear artwork',   fn: () => $('pf-clear') && $('pf-clear').click() },
            { sep: true },
            { label: 'Open image as layer…',  fn: () => $('pf-open') && $('pf-open').click() },
            { label: 'Import image…',         fn: () => $('pl-import') && $('pl-import').click() },
            { sep: true },
            { label: 'Export image…',         fn: () => window.openExportDialog && openExportDialog('all') },
            { label: 'Export current layer…', fn: () => window.openExportDialog && openExportDialog('layer') },
            { sep: true },
            { menulabel: 'Send to 3D' },
            { label: 'Extrude shape (Image → 3D)', fn: () => $('pf-to3d') && $('pf-to3d').click() },
            { label: 'Use as texture',             fn: () => $('pf-to3d-tex') && $('pf-to3d-tex').click() },
            { label: 'Place as flat image',        fn: () => $('pf-to3d-plane') && $('pf-to3d-plane').click() }
          ]},
          { name: 'Edit', items: [
            { label: 'Undo',        fn: () => undo(),  key: 'Ctrl Z' },
            { label: 'Redo',        fn: () => redo(),  key: 'Ctrl ⇧ Z' },
            { sep: true },
            { label: 'Select all',  fn: () => { const m = new Uint8Array(W*H).fill(1); selFromMask(m); composite(); banner('Selected the whole canvas.'); }, key: 'Ctrl A' },
            { label: 'Deselect',    fn: () => { clearSelection(); composite(); banner('Deselected.'); }, key: 'Ctrl D' },
            { label: 'Invert selection', fn: () => msImageOps.invertSel(), key: 'Ctrl ⇧ I' },
            { label: 'Grow selection 4 px',   fn: () => msImageOps.modifySel(4) },
            { label: 'Shrink selection 4 px', fn: () => msImageOps.modifySel(-4) },
            { sep: true },
            { label: 'Keyboard shortcuts…', fn: () => $('keys-open') && $('keys-open').click() },
            { label: 'Search commands…', fn: () => window.openCommandPalette && openCommandPalette(), key: 'Ctrl K' }
          ]},
          { name: 'Image', items: [
            { label: 'Canvas size…',          fn: () => window.openCanvasSize && openCanvasSize() },
            { label: 'Crop to selection',     fn: () => msImageOps.crop() },
            { label: 'Trim empty edges',      fn: () => msImageOps.trim() },
            { sep: true },
            { menulabel: 'Rotate canvas' },
            { label: 'Rotate 90° clockwise',     fn: () => msImageOps.rotate(90) },
            { label: 'Rotate 90° anticlockwise', fn: () => msImageOps.rotate(270) },
            { label: 'Rotate 180°',              fn: () => msImageOps.rotate(180) },
            { label: 'Flip canvas horizontal',   fn: () => msImageOps.flip(true) },
            { label: 'Flip canvas vertical',     fn: () => msImageOps.flip(false) },
            { sep: true },
            { menulabel: 'Current layer' },
            { label: 'Flip layer horizontal',    fn: () => $('pi-flip-h') && $('pi-flip-h').click() },
            { label: 'Flip layer vertical',      fn: () => $('pi-flip-v') && $('pi-flip-v').click() }
          ]},
          { name: 'Layer', items: [
            { label: 'New layer',          fn: () => $('pl-add') && $('pl-add').click() },
            { label: 'New vector layer',   fn: () => $('pl-add-vec') && $('pl-add-vec').click() },
            { label: 'New group',          fn: () => $('pl-add-group') && $('pl-add-group').click() },
            { label: 'QR / Barcode…',      fn: () => window.msRevealQR2D && msRevealQR2D() },
            { label: 'Duplicate layer',    fn: () => $('pl-dup') && $('pl-dup').click() },
            { label: 'Delete layer',       fn: () => $('pl-del') && $('pl-del').click() },
            { sep: true },
            { menulabel: 'Arrange' },
            { label: 'Move up',            fn: () => $('pl-up') && $('pl-up').click() },
            { label: 'Move down',          fn: () => $('pl-down') && $('pl-down').click() },
            { sep: true },
            { label: 'Merge down',         fn: () => $('pl-merge') && $('pl-merge').click() },
            { label: 'Rasterize layer',    fn: () => $('pl-rasterize') && $('pl-rasterize').click() },
            { label: 'Flatten text',       fn: () => $('pl-flatten-text') && $('pl-flatten-text').click() },
            { sep: true },
            { label: 'Add layer mask',     fn: () => $('pl-mask-add') && $('pl-mask-add').click() },
            { label: 'Layer effects…',     fn: () => $('fx-open') && $('fx-open').click() }
          ]},
          { name: 'Filter', items: [
            { menulabel: 'Adjust' },
            { label: 'Brightness / contrast…', fn: () => showPaintTab('image') },
            { label: 'Levels…',                fn: () => showPaintTab('image') },
            { label: 'Curves…',                fn: () => showPaintTab('image') },
            { label: 'Invert colours',  fn: () => $('pi-invert') && $('pi-invert').click() },
            { label: 'Greyscale',       fn: () => $('pi-grayscale') && $('pi-grayscale').click() },
            { label: 'Sepia',           fn: () => $('pi-sepia') && $('pi-sepia').click() },
            { label: 'Threshold',       fn: () => $('pi-threshold') && $('pi-threshold').click() },
            { label: 'Posterize',       fn: () => $('pi-posterize') && $('pi-posterize').click() },
            { sep: true },
            { menulabel: 'Stylise' },
            { label: 'Blur',        fn: () => $('pi-blur') && $('pi-blur').click() },
            { label: 'Sharpen',     fn: () => $('pi-sharpen') && $('pi-sharpen').click() },
            { label: 'Emboss',      fn: () => $('pi-emboss') && $('pi-emboss').click() },
            { label: 'Find edges',  fn: () => $('pi-edges') && $('pi-edges').click() },
            { label: 'Pixelate',    fn: () => $('pi-pixelate') && $('pi-pixelate').click() },
            { label: 'Add noise',   fn: () => $('pi-noise') && $('pi-noise').click() },
            { label: 'Vignette',    fn: () => $('pi-vignette') && $('pi-vignette').click() },
            { sep: true },
            { menulabel: 'Distort' },
            { label: 'Puppet warp', fn: () => $('pi-puppet') && $('pi-puppet').click() },
            { label: 'Ripple',      fn: () => $('pi-ripple') && $('pi-ripple').click() }
          ]},
          { name: 'View', items: [
            { label: 'Panels…', fn: () => window.openPanelManager && openPanelManager() },
            { sep: true },
            { label: 'Zoom in',   fn: () => $('ps-zoom-in') && $('ps-zoom-in').click() },
            { label: 'Zoom out',  fn: () => $('ps-zoom-out') && $('ps-zoom-out').click() },
            { label: 'Fit to screen', fn: () => $('ps-zoom-fit') && $('ps-zoom-fit').click() },
            { sep: true },
            { label: 'Layers panel',   fn: () => showPaintTab('layers') },
            { label: 'Tool options',   fn: () => showPaintTab('tool') },
            { label: 'Image panel',    fn: () => showPaintTab('image') }
          ]}
        ];
        function buildMenus() {
          const bar = $('paint-menubar'); if (!bar) return;
          bar.innerHTML = '';
          let openDrop = null;
          const closeAll = () => {
            bar.querySelectorAll('.menu-drop').forEach(d => d.classList.remove('open'));
            bar.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
            openDrop = null;
          };
          MENUS.forEach(m => {
            const wrap = document.createElement('div');
            wrap.style.position = 'relative';
            const btn = document.createElement('button');
            btn.className = 'menu-btn'; btn.textContent = m.name;
            const drop = document.createElement('div');
            drop.className = 'menu-drop';
            m.items.forEach(it => {
              if (it.sep) { const s = document.createElement('div'); s.className = 'menu-sep'; drop.appendChild(s); return; }
              if (it.menulabel) { const l = document.createElement('div'); l.className = 'menu-label'; l.textContent = it.menulabel; drop.appendChild(l); return; }
              const b = document.createElement('button');
              b.className = 'menu-item';
              b.innerHTML = '<span' + (it.cls ? ' class="' + it.cls + '"' : '') + '>' + it.label + '</span>' +
                          (it.key ? '<span class="mi-key">' + it.key + '</span>' : '');
              b.onclick = () => { closeAll(); try { it.fn(); } catch (e) { console.error(e); } };
              drop.appendChild(b);
            });
            btn.onclick = (e) => {
              e.stopPropagation();
              const wasOpen = drop.classList.contains('open');
              closeAll();
              if (!wasOpen) { drop.classList.add('open'); btn.classList.add('open'); openDrop = drop; }
            };
            // Hovering across the bar with a menu open switches menus, as desktop
            // apps do — otherwise you have to click each one.
            btn.onmouseenter = () => {
              if (openDrop && openDrop !== drop) { closeAll(); drop.classList.add('open'); btn.classList.add('open'); openDrop = drop; }
            };
            wrap.append(btn, drop);
            bar.appendChild(wrap);
          });
          document.addEventListener('click', closeAll);
        }
        buildMenus();

        // ── Colour wheel ──────────────────────────────────────────────────────
        // A hue ring with a saturation/value square inside it, the way GIMP and
        // Photoshop's wheel picker work. Previously the only picker was a square
        // hidden inside a popover, so choosing a colour meant opening something
        // first. This sits permanently in the swatches dock.
        const wheelCv = $('dk-wheel');
        if (wheelCv) {
          const WC = wheelCv.getContext('2d', { willReadFrequently: true });
          const SZ = 200, R_OUT = 96, R_IN = 74, CX = 100, CY = 100;
          let wheelDrag = null;

          function drawWheel() {
            WC.clearRect(0, 0, SZ, SZ);
            // Hue ring, drawn as fine wedges.
            for (let a = 0; a < 360; a++) {
              const s = (a - 0.6) * Math.PI / 180, e = (a + 1.2) * Math.PI / 180;
              WC.beginPath();
              WC.arc(CX, CY, R_OUT, s, e);
              WC.arc(CX, CY, R_IN, e, s, true);
              WC.closePath();
              WC.fillStyle = 'hsl(' + a + ',100%,50%)';
              WC.fill();
            }
            // Saturation / value square inside the ring, in the current hue.
            const half = R_IN * 0.70;
            const box = { x: CX - half, y: CY - half, w: half * 2, h: half * 2 };
            const g1 = WC.createLinearGradient(box.x, 0, box.x + box.w, 0);
            g1.addColorStop(0, '#fff');
            g1.addColorStop(1, 'hsl(' + Math.round(fg.h) + ',100%,50%)');
            WC.fillStyle = g1; WC.fillRect(box.x, box.y, box.w, box.h);
            const g2 = WC.createLinearGradient(0, box.y, 0, box.y + box.h);
            g2.addColorStop(0, 'rgba(0,0,0,0)');
            g2.addColorStop(1, '#000');
            WC.fillStyle = g2; WC.fillRect(box.x, box.y, box.w, box.h);
            // Hue marker on the ring.
            const ha = fg.h * Math.PI / 180;
            const hx = CX + Math.cos(ha) * (R_IN + R_OUT) / 2;
            const hy = CY + Math.sin(ha) * (R_IN + R_OUT) / 2;
            WC.beginPath(); WC.arc(hx, hy, 6, 0, Math.PI*2);
            WC.strokeStyle = '#fff'; WC.lineWidth = 2.5; WC.stroke();
            WC.strokeStyle = '#000'; WC.lineWidth = 1; WC.stroke();
            // Marker in the square.
            const sx = box.x + fg.s * box.w;
            const sy = box.y + (1 - fg.v) * box.h;
            WC.beginPath(); WC.arc(sx, sy, 6, 0, Math.PI*2);
            WC.strokeStyle = '#fff'; WC.lineWidth = 2.5; WC.stroke();
            WC.strokeStyle = '#000'; WC.lineWidth = 1; WC.stroke();
            wheelCv._box = box;
          }
          function wheelPick(e) {
            const r = wheelCv.getBoundingClientRect();
            const x = (e.clientX - r.left) * (SZ / r.width);
            const y = (e.clientY - r.top) * (SZ / r.height);
            const dx = x - CX, dy = y - CY, dist = Math.hypot(dx, dy);
            const box = wheelCv._box;
            if (wheelDrag === 'ring' || (wheelDrag === null && dist <= R_OUT + 6 && dist >= R_IN - 6)) {
              wheelDrag = 'ring';
              let a = Math.atan2(dy, dx) * 180 / Math.PI;
              if (a < 0) a += 360;
              fg.h = a;
            } else if (wheelDrag === 'sv' || (wheelDrag === null && box &&
                       x >= box.x - 6 && x <= box.x + box.w + 6 && y >= box.y - 6 && y <= box.y + box.h + 6)) {
              wheelDrag = 'sv';
              fg.s = Math.max(0, Math.min(1, (x - box.x) / box.w));
              fg.v = Math.max(0, Math.min(1, 1 - (y - box.y) / box.h));
            } else { return; }
            syncColorUI();
            drawWheel();
            const chip = $('dk-sw-chip'); if (chip) chip.style.background = toolColor();
            const hx2 = $('dk-hex'); if (hx2) hx2.value = toolColor();
          }
          wheelCv.addEventListener('pointerdown', (e) => {
            wheelCv.setPointerCapture(e.pointerId);
            wheelDrag = null; wheelPick(e);
          });
          wheelCv.addEventListener('pointermove', (e) => { if (wheelDrag) wheelPick(e); });
          ['pointerup','pointercancel'].forEach(ev =>
            wheelCv.addEventListener(ev, () => { wheelDrag = null; }));
          const hexIn = $('dk-hex');
          if (hexIn) hexIn.oninput = () => {
            const c = fromHex(hexIn.value, fg.a);
            if (c) { fg = c; syncColorUI(); drawWheel();
              const chip = $('dk-sw-chip'); if (chip) chip.style.background = toolColor(); }
          };
          window.redrawWheel = () => {
            drawWheel();
            const chip = $('dk-sw-chip'); if (chip) chip.style.background = toolColor();
            if (hexIn && document.activeElement !== hexIn) hexIn.value = toolColor();
          };
          drawWheel();
          if (hexIn) hexIn.value = toolColor();
        }

        // ── Layer mask dialog ────────────────────────────────────────────────
        // Opens from a layer's own row. It drives the same underlying actions the
        // old Mask subsection did — those buttons still exist, hidden, so the
        // behaviour is identical and there's only one implementation of each.
        let maskDlgLayer = null;
        function drawMaskPreview() {
          const cv = $('mask-preview'); if (!cv) return;
          const x = cv.getContext('2d');
          x.clearRect(0, 0, cv.width, cv.height);
          const l = maskDlgLayer;
          if (!l || !l.mask) {
            x.fillStyle = '#22262c'; x.fillRect(0, 0, cv.width, cv.height);
            x.fillStyle = '#6a7380'; x.font = '12px sans-serif'; x.textAlign = 'center';
            x.fillText('No mask on this layer', cv.width / 2, cv.height / 2);
            return;
          }
          const s = Math.min(cv.width / W, cv.height / H);
          const dw = W * s, dh = H * s;
          x.fillStyle = '#15181d'; x.fillRect(0, 0, cv.width, cv.height);
          x.drawImage(l.mask, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
        }
        function openMaskDialog(l) {
          maskDlgLayer = l;
          activeId = l.id;
          const t = $('mask-dlg-title');
          if (t) t.textContent = 'Layer mask — ' + (l.name || 'Layer');
          const hasMask = !!l.mask;
          ['mask-dlg-paint','mask-dlg-invert','mask-dlg-apply','mask-dlg-del'].forEach(id => {
            const b = $(id); if (b) b.disabled = !hasMask;
          });
          drawMaskPreview();
          $('mask-backdrop').classList.add('open');
          $('mask-dialog').classList.add('open');
        }
        function closeMaskDialog() {
          $('mask-backdrop').classList.remove('open');
          $('mask-dialog').classList.remove('open');
          maskDlgLayer = null;
        }
        window.openMaskDialog = openMaskDialog;
        const mbd = $('mask-backdrop'); if (mbd) mbd.onclick = closeMaskDialog;
        const mcl = $('mask-dlg-close'); if (mcl) mcl.onclick = closeMaskDialog;
        // Each button defers to the existing (now hidden) control, so there is
        // exactly one implementation of every mask action.
        const relay = (id, target, close) => {
          const b = $(id); if (!b) return;
          b.onclick = () => {
            const t = $(target); if (t) t.click();
            if (close) closeMaskDialog(); else { drawMaskPreview(); renderLayerList(); }
          };
        };
        relay('mask-dlg-paint',  'pl-mask-paint',  true);
        relay('mask-dlg-invert', 'pl-mask-invert', false);
        relay('mask-dlg-apply',  'pl-mask-apply',  true);
        relay('mask-dlg-del',    'pl-mask-del',    true);

        // ── Colour tab: fg/bg pair and a starting palette ────────────────────
        // Swatches start empty otherwise, which makes the panel look broken on a
        // first run. These are a neutral working set — greys plus the primaries and
        // secondaries — that anyone can paint with immediately and delete if they
        // don't want them.
        const DEFAULT_SWATCHES = [
          '#000000','#404040','#808080','#bfbfbf','#ffffff',
          '#c2895f','#8b5a3c','#e0b060',
          '#e04040','#e08040','#e0d040','#60c060','#40a0c0','#4060c0','#8040c0','#c04090'
        ];
        function syncFgBg() {
          const f = $('dk-fg-sw'), g = $('dk-bg-sw');
          if (f) f.style.background = toHex(fg);
          if (g) g.style.background = toHex(bg);
        }
        const fgSw = $('dk-fg-sw');
        if (fgSw) fgSw.onclick = () => { showPaintTab('colour'); banner('Foreground — pick with the wheel below.'); };
        const bgSw = $('dk-bg-sw');
        if (bgSw) bgSw.onclick = () => {
          const t = fg; fg = bg; bg = t; syncColorUI(); syncFgBg();
          banner('Background is now the foreground.');
        };
        const swapBtn = $('dk-swap');
        if (swapBtn) swapBtn.onclick = () => {
          const t = fg; fg = bg; bg = t; syncColorUI(); syncFgBg();
        };
        window.syncFgBg = syncFgBg;
        syncFgBg();

        // ── Stacked docks: history + swatches ────────────────────────────────
        // These sit under the layer list so the three things you use together are
        // visible at once, rather than each hidden behind its own tab.
        const DOCK_KEY = 'modelsmith_docks_v1';
        // Swatches (with the colour wheel) open by default because you reach for
        // colour constantly; History starts collapsed so the wheel is visible
        // without scrolling on a laptop-height panel.
        let dockState = { history: false, swatches: true };
        try {
          const raw = localStorage.getItem(DOCK_KEY);
          if (raw) dockState = Object.assign(dockState, JSON.parse(raw));
        } catch (e) {}
        function applyDocks() {
          document.querySelectorAll('.dock').forEach(d => {
            const head = d.querySelector('.dock-head');
            if (!head) return;
            d.classList.toggle('collapsed', !dockState[head.dataset.dock]);
          });
        }
        document.querySelectorAll('.dock-head').forEach(h => {
          h.onclick = () => {
            const k = h.dataset.dock;
            dockState[k] = !dockState[k];
            applyDocks();
            try { localStorage.setItem(DOCK_KEY, JSON.stringify(dockState)); } catch (e) {}
          };
        });
        applyDocks();

        // Swatches: a saved palette that persists, shown permanently.
        const SW_KEY = 'modelsmith_paint_swatches_v1';
        let swatches = [];
        try {
          const raw = localStorage.getItem(SW_KEY);
          // No stored palette yet (rather than a deliberately emptied one) — seed it.
          swatches = raw ? JSON.parse(raw) : DEFAULT_SWATCHES.slice();
          if (!Array.isArray(swatches)) swatches = DEFAULT_SWATCHES.slice();
        } catch (e) { swatches = DEFAULT_SWATCHES.slice(); }
        function saveSwatches() {
          try { localStorage.setItem(SW_KEY, JSON.stringify(swatches.slice(0, 64))); } catch (e) {}
        }
        window.renderSwatchDock = function renderSwatchDock() {
          const grid = $('dk-sw-grid'); if (!grid) return;
          const chip = $('dk-sw-chip');
          if (chip) chip.style.background = toolColor();
          const cnt = $('dk-sw-count');
          if (cnt) cnt.textContent = swatches.length ? String(swatches.length) : '';
          grid.innerHTML = '';
          swatches.forEach((c, i) => {
            const b = document.createElement('button');
            b.className = 'dk-sw'; b.style.background = c; b.title = c;
            b.onclick = () => {
              const parsed = fromHex(c, fg.a);
              if (parsed) { fg = parsed; syncColorUI(); }
              if (window.renderSwatchDock) renderSwatchDock();
            };
            b.oncontextmenu = (e) => {
              e.preventDefault();
              swatches.splice(i, 1); saveSwatches(); renderSwatchDock();
            };
            let hold = null;
            b.addEventListener('pointerdown', () => {
              hold = setTimeout(() => { swatches.splice(i, 1); saveSwatches(); renderSwatchDock(); }, 600);
            });
            ['pointerup','pointerleave','pointercancel'].forEach(ev =>
              b.addEventListener(ev, () => { if (hold) clearTimeout(hold); hold = null; }));
            grid.appendChild(b);
          });
        };
        const swAdd = $('dk-sw-add');
        if (swAdd) swAdd.onclick = () => {
          const c = toolColor();
          if (!swatches.includes(c)) { swatches.unshift(c); saveSwatches(); }
          renderSwatchDock();
          banner('Saved ' + c + ' to swatches.');
        };
        renderSwatchDock();

        // Text warp — retunes the live text as you drag, so you can see the shape.
        const warpSel = $('ps-warp'), warpAmt = $('ps-warp-amt'), warpVal = $('ps-warp-amt-val');
        const applyWarp = (commit) => {
          if (warpVal && warpAmt) warpVal.textContent = warpAmt.value + '%';
          if (liveText) {
            if (warpSel) liveText.warp = warpSel.value;
            if (warpAmt) liveText.amount = (+warpAmt.value) / 100;
            composite();
          }
          if (commit) saveSoon();
        };
        if (warpSel) warpSel.onchange = () => applyWarp(true);
        if (warpAmt) { warpAmt.oninput = () => applyWarp(false); warpAmt.onchange = () => applyWarp(true); }

        // Clone stamp: arm the next tap to set the source point.
        window.syncCloneUI = function syncCloneUI() {
          const btn = $('ps-clone-src'), st = $('ps-clone-state');
          if (btn) { btn.classList.toggle('primary', cloneArmed); btn.textContent = cloneArmed ? 'Tap the source…' : 'Set source'; }
          if (st) st.textContent = cloneArmed ? 'tap to pick' : (cloneSrc ? 'source set' : 'no source');
        };
        if ($('ps-clone-src')) $('ps-clone-src').onclick = () => {
          cloneArmed = !cloneArmed;
          syncCloneUI();
          banner(cloneArmed ? 'Now tap the part of the image you want to clone from.' : 'Cancelled.');
        };
        if ($('ps-aspect')) $('ps-aspect').onchange = e => {
          aspectLock = e.target.checked;
          banner(aspectLock ? 'Lock ratio on — squares, circles, 45° lines. (Or hold Shift.)' : 'Lock ratio off.');
        };
        wireColor();

        $('pl-add').onclick = () => { addLayer('raster'); banner('Layer added.'); };
        // ── Layer effects dialog ──────────────────────────────────────────────
        // Schema-driven: each effect declares its controls once, and the dialog
        // builds both the sidebar list and the detail pane from this.
        const FX_SCHEMA = [
          { key:'shadow', name:'Drop shadow',
            hint:'A soft copy of the layer offset behind it.',
            ctl:[['color','color','Colour'],['opacity','pct','Opacity'],['blend','blend','Blend'],
                 ['blur','num','Blur',0,60],['spread','num','Spread',0,20],
                 ['dx','num','Offset X',-60,60],['dy','num','Offset Y',-60,60]] },
          { key:'glowOut', name:'Outer glow',
            hint:'A halo of colour radiating outward from the edges.',
            ctl:[['color','color','Colour'],['opacity','pct','Opacity'],['blend','blend','Blend'],
                 ['blur','num','Blur',0,60],['spread','num','Spread',0,20]] },
          { key:'innerShadow', name:'Inner shadow',
            hint:'Shading just inside the edges, so the layer looks recessed.',
            ctl:[['color','color','Colour'],['opacity','pct','Opacity'],['blend','blend','Blend'],
                 ['blur','num','Blur',0,60],['dx','num','Offset X',-40,40],['dy','num','Offset Y',-40,40]] },
          { key:'innerGlow', name:'Inner glow',
            hint:'Light gathering just inside the edges.',
            ctl:[['color','color','Colour'],['opacity','pct','Opacity'],['blend','blend','Blend'],
                 ['blur','num','Blur',0,60]] },
          { key:'satin', name:'Satin',
            hint:'A soft interior sheen, like light across folded fabric.',
            ctl:[['color','color','Colour'],['opacity','pct','Opacity'],['blend','blend','Blend'],
                 ['blur','num','Blur',0,60],['dx','num','Offset X',-60,60],['dy','num','Offset Y',-60,60],
                 ['invert','check','Invert']] },
          { key:'colorOv', name:'Colour overlay',
            hint:'Floods the layer with a flat colour.',
            ctl:[['color','color','Colour'],['opacity','pct','Opacity'],['blend','blend','Blend']] },
          { key:'gradOv', name:'Gradient overlay',
            hint:'Fills the layer with a gradient between two colours.',
            ctl:[['c1','color','From'],['c2','color','To'],['opacity','pct','Opacity'],
                 ['blend','blend','Blend'],
                 ['style','sel','Style',['linear','radial']],
                 ['angle','deg','Angle',0,360],['reverse','check','Reverse']] },
          { key:'patternOv', name:'Pattern overlay',
            hint:'Tiles a generated pattern across the layer.',
            ctl:[['kind','sel','Pattern',['checks','stripes','dots','grid','noise']],
                 ['color','color','Colour'],['opacity','pct','Opacity'],['blend','blend','Blend'],
                 ['scale','num','Scale',2,80]] },
          { key:'stroke', name:'Stroke',
            hint:'An outline following the layer\u2019s edges.',
            ctl:[['fill','sel','Fill',['solid','gradient']],
                 ['color','color','Colour'],['c1','color','Gradient from'],['c2','color','Gradient to'],
                 ['angle','deg','Gradient angle',0,360],
                 ['width','num','Width',1,40],['opacity','pct','Opacity'],['blend','blend','Blend'],
                 ['align','sel','Position',['outside','inside','center']]] },
          { key:'bevel', name:'Bevel & emboss',
            hint:'Highlight and shade opposite edges to suggest relief.',
            ctl:[['depth','num','Depth',1,30],['blur','num','Soften',0,30],
                 ['angle','deg','Light angle',0,360],
                 ['light','pct','Highlight'],['shadow','pct','Shadow']] }
        ];
        const FX_BLEND_OPTS = ['normal','multiply','screen','overlay','darken','lighten',
          'color-dodge','color-burn','hard-light','soft-light','difference','exclusion',
          'hue','saturation','color','luminosity'];
        let fxSel = 'shadow';          // which effect the detail pane is showing
        let fxPreview = true;
        let fxBackup = null;           // layer fx snapshot, for Preview off

        function fxTargetLayer() {
          const l = active();
          return (l && l.kind !== 'group') ? l : null;
        }
        function ensureFX() {
          const l = fxTargetLayer(); if (!l) return null;
          if (!l.fx) l.fx = defaultFX();
          return l.fx;
        }
        // One-line description of what's switched on, for the sidebar panel.
        function fxSummaryText(l) {
          if (!l || l.kind === 'group') return 'Select a layer to add effects.';
          if (!l.fx) return 'No effects on this layer.';
          const on = FX_SCHEMA.filter(s => l.fx[s.key] && l.fx[s.key].on).map(s => s.name);
          return on.length ? '<b>' + on.length + '</b> active: ' + on.join(', ') : 'No effects on this layer.';
        }
        function syncFXPanel() {
          const el = $('fx-summary');
          const l = active();
          if (el) el.innerHTML = fxSummaryText(l);
          // Badges let you see what a layer carries without opening the sections.
          const fxb = $('fx-badge');
          if (fxb) {
            const n = (l && l.kind !== 'group' && l.fx)
              ? FX_SCHEMA.filter(s => l.fx[s.key] && l.fx[s.key].on).length : 0;
            fxb.textContent = n ? String(n) : '';
          }
          const mb = $('mask-badge');
          if (mb) mb.textContent = (l && l.kind !== 'group' && l.mask) ? 'on' : '';
        }
        _syncFX = syncFXPanel;

        // Collapsible subsections in the Layers tab. Open/closed state is
        // remembered so the panel comes back the way you left it.
        const LSUB_KEY = 'modelsmith_lsub_v1';
        let lsubState = { fx:false, mask:false, new:true, shape:false };
        try {
          const raw = localStorage.getItem(LSUB_KEY);
          if (raw) lsubState = Object.assign(lsubState, JSON.parse(raw));
        } catch (e) { /* corrupt or unavailable — defaults are fine */ }
        function applyLsub() {
          document.querySelectorAll('.lsub').forEach(box => {
            const head = box.querySelector('.lsub-head');
            if (!head) return;
            box.classList.toggle('open', !!lsubState[head.dataset.sub]);
          });
        }
        document.querySelectorAll('.lsub-head').forEach(head => {
          head.onclick = () => {
            const k = head.dataset.sub;
            lsubState[k] = !lsubState[k];
            applyLsub();
            try { localStorage.setItem(LSUB_KEY, JSON.stringify(lsubState)); } catch (e) {}
          };
        });
        applyLsub();

        function fxBuildList() {
          const box = $('fx-list'); if (!box) return;
          const l = fxTargetLayer();
          const f = (l && l.fx) ? l.fx : defaultFX();
          box.innerHTML = '';
          FX_SCHEMA.forEach(s => {
            const row = document.createElement('div');
            row.className = 'fx-item' + (s.key === fxSel ? ' sel' : '') + (f[s.key].on ? ' enabled' : '');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = !!f[s.key].on;
            cb.onclick = (ev) => {
              ev.stopPropagation();
              const fx = ensureFX(); if (!fx) return;
              fx[s.key].on = cb.checked;
              fxSel = s.key;
              fxBuildList(); fxBuildDetail(); composite(); syncFXPanel();
              pushHistory(); saveSoon();
            };
            const nm = document.createElement('span');
            nm.className = 'fx-item-name'; nm.textContent = s.name;
            row.append(cb, nm);
            row.onclick = () => { fxSel = s.key; fxBuildList(); fxBuildDetail(); };
            box.appendChild(row);
          });
        }

        // Live preview of the active layer with its effects applied. Mirrors the
        // mask dialog's preview: you can see the result while tuning, instead of
        // closing the dialog to check and reopening to adjust.
        function fxDrawPreview() {
          const cv = document.getElementById('fx-preview-canvas');
          if (!cv) return;
          const x = cv.getContext('2d');
          const l = active();
          x.clearRect(0, 0, cv.width, cv.height);
          // Checkerboard so transparency reads as transparency.
          const sq = 10;
          for (let yy = 0; yy < cv.height; yy += sq) for (let xx = 0; xx < cv.width; xx += sq) {
            x.fillStyle = (((xx + yy) / sq) % 2) ? '#23272d' : '#2b3038';
            x.fillRect(xx, yy, sq, sq);
          }
          if (!l || l.kind === 'group') return;
          try {
            // renderLayerWithFX gives the layer exactly as it composites, so the
            // preview can't drift from the real result.
            const full = renderLayerWithFX(l, l.canvas);
            const s = Math.min(cv.width / W, cv.height / H);
            const dw = W * s, dh = H * s;
            x.drawImage(full, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
          } catch (e) { /* preview is optional — never let it break the dialog */ }
        }
        window.fxDrawPreview = fxDrawPreview;

        function fxBuildDetail() {
          // Any rebuild of the detail pane means something changed — keep the
          // preview in step.
          setTimeout(() => { if (window.fxDrawPreview) fxDrawPreview(); }, 0);
          const box = $('fx-detail'); if (!box) return;
          const schema = FX_SCHEMA.find(s => s.key === fxSel) || FX_SCHEMA[0];
          const l = fxTargetLayer();
          box.innerHTML = '';
          const t = document.createElement('div');
          t.className = 'fx-detail-title'; t.textContent = schema.name;
          const h = document.createElement('div');
          h.className = 'fx-detail-hint'; h.textContent = schema.hint;
          box.append(t, h);
          if (!l) {
            const n = document.createElement('div');
            n.className = 'fx-off-note'; n.textContent = 'Select a layer first — groups can\u2019t take effects.';
            box.appendChild(n); return;
          }
          const f = l.fx || defaultFX();
          if (!f[schema.key].on) {
            const n = document.createElement('div');
            n.className = 'fx-off-note';
            n.textContent = 'This effect is off. Tick it in the list to switch it on — the settings below still apply once it is.';
            box.appendChild(n);
          }
          schema.ctl.forEach(([key, type, label, a, b]) => {
            // hide gradient-only stroke fields when the stroke is a flat colour
            if (schema.key === 'stroke') {
              const isGrad = f.stroke.fill === 'gradient';
              if (!isGrad && (key === 'c1' || key === 'c2' || key === 'angle')) return;
              if (isGrad && key === 'color') return;
            }
            const row = document.createElement('div');
            row.className = 'fx-row';
            const lab = document.createElement('span'); lab.textContent = label;
            row.appendChild(lab);
            let input;
            const commit = (live) => {
              const fx = ensureFX(); if (!fx) return;
              let v;
              if (type === 'check') v = input.checked;
              else if (type === 'color' || type === 'sel' || type === 'blend') v = input.value;
              else if (type === 'pct') v = (+input.value) / 100;
              else v = +input.value;
              fx[schema.key][key] = v;
              if (valEl) valEl.textContent = type === 'pct' ? Math.round(v*100) + '%'
                : type === 'deg' ? v + '\u00b0' : v;
              if (fxPreview) composite();
              // Refresh the dialog preview on EVERY change, not just on commit —
              // it was previously inside the !live branch, so dragging a slider
              // updated the canvas behind the dialog but left the preview stale
              // until you let go.
              if (window.fxDrawPreview) fxDrawPreview();
              if (!live) { pushHistory(); saveSoon(); syncFXPanel();
                if (schema.key === 'stroke' && key === 'fill') fxBuildDetail(); }
            };
            let valEl = null;
            if (type === 'color') {
              input = document.createElement('input'); input.type = 'color';
              input.value = f[schema.key][key];
              input.oninput = () => commit(true); input.onchange = () => commit(false);
              row.appendChild(input);
            } else if (type === 'check') {
              input = document.createElement('input'); input.type = 'checkbox';
              input.checked = !!f[schema.key][key];
              input.onchange = () => commit(false);
              row.appendChild(input);
            } else if (type === 'sel' || type === 'blend') {
              input = document.createElement('select'); input.className = 'hud-select';
              (type === 'blend' ? FX_BLEND_OPTS : a).forEach(o => {
                const op = document.createElement('option');
                op.value = o; op.textContent = o.charAt(0).toUpperCase() + o.slice(1).replace(/-/g,' ');
                input.appendChild(op);
              });
              input.value = f[schema.key][key];
              input.onchange = () => commit(false);
              row.appendChild(input);
            } else {
              // numeric: value readout above a full-width slider
              valEl = document.createElement('span');
              valEl.className = 'val';
              const v0 = f[schema.key][key];
              valEl.textContent = type === 'pct' ? Math.round(v0*100) + '%'
                : type === 'deg' ? v0 + '\u00b0' : v0;
              row.appendChild(valEl);
              box.appendChild(row);
              input = document.createElement('input');
              input.type = 'range';
              input.min = type === 'pct' ? 0 : a;
              input.max = type === 'pct' ? 100 : b;
              input.step = type === 'deg' ? 5 : 1;
              input.value = type === 'pct' ? Math.round(v0*100) : v0;
              input.oninput = () => commit(true);
              input.onchange = () => commit(false);
              box.appendChild(input);
              return;
            }
            box.appendChild(row);
          });
        }

        function fxOpenDialog() {
          const l = fxTargetLayer();
          if (!l) return banner('Select a layer first — groups can\u2019t take effects.');
          fxBackup = l.fx ? JSON.parse(JSON.stringify(l.fx)) : null;
          $('fx-dlg-layer').textContent = l.name || '';
          $('fx-backdrop').classList.add('open');
          $('fx-dialog').classList.add('open');
          fxBuildList(); fxBuildDetail();
          if (window.fxDrawPreview) fxDrawPreview();
        }
        function fxCloseDialog() {
          $('fx-backdrop').classList.remove('open');
          $('fx-dialog').classList.remove('open');
          fxBackup = null;
          composite(); syncFXPanel();
        }
        $('fx-open').onclick = fxOpenDialog;
        $('fx-close').onclick = fxCloseDialog;
        $('fx-done').onclick = fxCloseDialog;
        $('fx-backdrop').onclick = fxCloseDialog;
        $('fx-preview').onchange = (e) => {
          fxPreview = e.target.checked;
          const l = fxTargetLayer(); if (!l) return;
          if (!fxPreview) { l._fxHold = l.fx; l.fx = null; }
          else if (l._fxHold !== undefined) { l.fx = l._fxHold; delete l._fxHold; }
          composite();
        };
        $('fx-reset').onclick = () => {
          const fx = ensureFX(); if (!fx) return;
          const fresh = defaultFX();
          fx[fxSel] = fresh[fxSel];
          fxBuildList(); fxBuildDetail(); composite(); syncFXPanel(); pushHistory(); saveSoon();
          banner('Reset ' + (FX_SCHEMA.find(s=>s.key===fxSel)||{}).name + '.');
        };
        $('fx-clear').onclick = () => {
          const l = fxTargetLayer();
          if (!l) return banner('Select a layer first.');
          l.fx = null;
          syncFXPanel(); composite(); renderLayerList();
          if ($('fx-dialog').classList.contains('open')) { fxBuildList(); fxBuildDetail(); }
          pushHistory(); saveSoon();
          banner('Effects cleared.');
        };
        $('fx-rasterize').onclick = () => {
          const l = fxTargetLayer();
          if (!l) return banner('Select a layer first.');
          if (!fxActive(l)) return banner('No effects to bake in.');
          const baked = renderLayerWithFX(l, l.canvas);
          const keep = document.createElement('canvas');
          keep.width = W; keep.height = H;
          keep.getContext('2d').drawImage(baked, 0, 0);
          l.ctx.setTransform(1,0,0,1,0,0);
          l.ctx.globalAlpha = 1; l.ctx.globalCompositeOperation = 'source-over';
          l.ctx.clearRect(0,0,W,H);
          l.ctx.drawImage(keep, 0, 0);
          l.fx = null; touch(l);
          fxBuildList(); fxBuildDetail();
          syncFXPanel(); composite(); renderLayerList(); pushHistory(); saveSoon();
          banner('Effects baked into the layer.');
        };


        $('pl-add-group').onclick = () => {
          // Insert a group header just above the active layer, and drop that layer in.
          const g = makeGroup('Group');
          const l = active();
          let idx = layers.findIndex(x => x.id === activeId);
          if (idx < 0) idx = layers.length - 1;
          // header sits just after the active layer in the array (= above it in display)
          layers.splice(idx + 1, 0, g);
          if (l && l.kind !== 'group') l.groupId = g.id;
          activeId = g.id;
          renderLayerList(); composite(); pushHistory(); banner('Group added.');
        };
        $('pl-add-vec').onclick = () => { addLayer('vector', 'Vector ' + layerSeq); banner('Vector layer added — draw shapes, then edit their points.'); };
        $('pl-rasterize').onclick = () => {
          const l = active();
          if (!l) return;
          if (l.kind !== 'vector') return banner('That layer is already pixels.');
          l.kind = 'raster'; l.shapes = [];
          vSel = null; renderLayerList(); composite(); pushHistory();
          banner('Vector layer baked into pixels.');
        };
        if ($('pl-unite')) $('pl-unite').onclick = () => uniteOverlaps();
        if ($('pl-mask-add')) $('pl-mask-add').onclick = addMask;
        if ($('pl-mask-paint')) $('pl-mask-paint').onclick = toggleMaskPaint;
        if ($('pl-mask-invert')) $('pl-mask-invert').onclick = invertMask;
        if ($('pl-mask-apply')) $('pl-mask-apply').onclick = applyMask;
        if ($('pl-mask-del')) $('pl-mask-del').onclick = deleteMask;
        if ($('pt-commit')) $('pt-commit').onclick = commitTransform;
        if ($('pt-cancel')) $('pt-cancel').onclick = cancelTransform;
        if ($('pl-shape-copy')) $('pl-shape-copy').onclick = () => copyShape(false);
        if ($('pl-shape-cut')) $('pl-shape-cut').onclick = () => copyShape(true);
        if ($('pl-shape-paste')) $('pl-shape-paste').onclick = () => pasteShape();
        if ($('pl-flatten-text')) $('pl-flatten-text').onclick = () => {
          const l = active();
          if (!l || !l.texts || !l.texts.length) return banner('No editable text on this layer.');
          // the canvas already shows paint+text; just drop the editable objects and
          // the paint-base so it becomes ordinary pixels
          l.texts = []; l._paint = null;
          touch(l); pushHistory('Flattened text'); renderLayerList();
          banner('Text baked into pixels — no longer editable.');
        };
        $('pl-dup').onclick = () => {
          const l = active(); if (!l) return;
          if (l.kind === 'group') return banner('Select a layer to duplicate, not a group.');
          const n = addLayer(l.kind, l.name + ' copy');
          n.ctx.drawImage(l.canvas, 0, 0);
          n.shapes = JSON.parse(JSON.stringify(l.shapes || []));
          n.blend = l.blend; n.opacity = l.opacity; n.groupId = l.groupId || null;
          composite(); renderLayerList(); pushHistory();
        };
        $('pl-del').onclick = () => {
          const cur = active();
          exitMaskEdit();
          if (xform) cancelTransform();
          const i = layers.findIndex(l => l.id === activeId);
          if (i < 0) return;
          if (cur && cur.kind === 'group') {
            // Deleting a group removes the folder but keeps its layers, ungrouped.
            layers.forEach(x => { if (x.groupId === cur.id) x.groupId = null; });
            layers.splice(i, 1);
            const nextReal = layers.find(x => x.kind !== 'group');
            activeId = nextReal ? nextReal.id : (layers[0] && layers[0].id);
            composite(); renderLayerList(); pushHistory(); banner('Group removed; layers kept.');
            return;
          }
          const realLayers = layers.filter(l => l.kind !== 'group');
          if (realLayers.length <= 1) return banner('Keep at least one layer.');
          layers.splice(i, 1);
          // pick a neighbouring real layer as active
          let ni = Math.max(0, i - 1);
          while (ni < layers.length && layers[ni].kind === 'group') ni++;
          if (ni >= layers.length) { ni = layers.length - 1; while (ni >= 0 && layers[ni].kind === 'group') ni--; }
          activeId = layers[ni] ? layers[ni].id : (layers[0] && layers[0].id);
          composite(); renderLayerList(); pushHistory();
        };
        $('pl-up').onclick = () => {
          const i = layers.findIndex(l => l.id === activeId);
          if (i < layers.length - 1) { [layers[i], layers[i+1]] = [layers[i+1], layers[i]]; composite(); renderLayerList(); pushHistory(); }
        };
        $('pl-down').onclick = () => {
          const i = layers.findIndex(l => l.id === activeId);
          if (i > 0) { [layers[i], layers[i-1]] = [layers[i-1], layers[i]]; composite(); renderLayerList(); pushHistory(); }
        };
        $('pl-merge').onclick = () => {
          const cur = active();
          if (cur && cur.kind === 'group') return banner('Select a layer to merge, not a group.');
          const i = layers.findIndex(l => l.id === activeId);
          if (i <= 0) return banner('Nothing below to merge into.');
          const top = layers[i], below = layers[i-1];
          if (below.kind === 'group') return banner('Can\'t merge into a group header.');
          below.ctx.save();
          below.ctx.globalAlpha = top.opacity;
          below.ctx.globalCompositeOperation = top.blend || 'source-over';
          below.ctx.drawImage(top.canvas, 0, 0); touch(below);
          below.ctx.restore();
          if (below.kind === 'vector') { below.kind = 'raster'; below.shapes = []; }
          layers.splice(i, 1); activeId = below.id;
          composite(); renderLayerList(); pushHistory(); banner('Merged down.');
        };
        $('pl-blend').onchange = e => { const l = active(); if (l) { l.blend = e.target.value; composite(); saveSoon(); } };
        $('pl-opacity').oninput = e => {
          const l = active(); if (!l) return;
          l.opacity = (parseInt(e.target.value) || 0) / 100;
          $('pl-op-val').textContent = e.target.value + '%';
          composite(); saveSoon();
        };

        $('pi-w').oninput = e => $('pi-w-val').textContent = e.target.value + ' px';
        $('pi-h').oninput = e => $('pi-h-val').textContent = e.target.value + ' px';
        $('pi-bright').oninput = e => $('pi-bright-val').textContent = e.target.value;
        $('pi-contrast').oninput = e => $('pi-contrast-val').textContent = e.target.value;
        $('pi-sat').oninput = e => $('pi-sat-val').textContent = e.target.value;
        $('pi-resize').onclick = () => {
          const nw = parseInt($('pi-w').value), nh = parseInt($('pi-h').value);
          layers.forEach(l => {
            if (l.kind === 'group') return;
            const tmp = document.createElement('canvas'); tmp.width = nw; tmp.height = nh;
            tmp.getContext('2d').drawImage(l.canvas, 0, 0);
            l.canvas = tmp; l.ctx = tmp.getContext('2d', { willReadFrequently: true });
          });
          W = nw; H = nh; view.width = W; view.height = H;
          touchAll(); fitZoom(); composite(); pushHistory(); banner(`Canvas is now ${W}×${H}.`);
        };
        $('pi-apply-adjust').onclick = applyAdjust;
        $('pi-blur').onclick = blurLayer;
        $('pi-flip-h').onclick = () => flip(true);
        $('pi-flip-v').onclick = () => flip(false);
        // hue slider label
        if ($('pi-hue')) $('pi-hue').oninput = e => { $('pi-hue-val').textContent = e.target.value + '°'; };
        // levels
        if ($('pi-lvl-black')) $('pi-lvl-black').oninput = e => { $('pi-lvl-black-val').textContent = e.target.value; };
        if ($('pi-lvl-white')) $('pi-lvl-white').oninput = e => { $('pi-lvl-white-val').textContent = e.target.value; };
        if ($('pi-lvl-gamma')) $('pi-lvl-gamma').oninput = e => { $('pi-lvl-gamma-val').textContent = (e.target.value/100).toFixed(2); };
        if ($('pi-apply-levels')) $('pi-apply-levels').onclick = applyLevels;
        // curves
        if ($('pi-apply-curve')) $('pi-apply-curve').onclick = applyCurve;
        if ($('pi-curve-reset')) $('pi-curve-reset').onclick = () => { curvePts = [{x:0,y:0},{x:1,y:1}]; drawCurveEditor(); };
        wireCurveEditor();
        drawCurveEditor();
        // filters
        if ($('pi-invert')) $('pi-invert').onclick = invertLayer;
        if ($('pi-threshold')) $('pi-threshold').onclick = thresholdLayer;
        if ($('pi-posterize')) $('pi-posterize').onclick = posterizeLayer;
        if ($('pi-sharpen')) $('pi-sharpen').onclick = sharpenLayer;
        if ($('pi-grayscale')) $('pi-grayscale').onclick = grayscaleLayer;
        if ($('pi-sepia'))    $('pi-sepia').onclick = filterSepia;
        if ($('pi-emboss'))   $('pi-emboss').onclick = filterEmboss;
        if ($('pi-edges'))    $('pi-edges').onclick = filterEdges;
        if ($('pi-noise'))    $('pi-noise').onclick = filterNoise;
        if ($('pi-pixelate')) $('pi-pixelate').onclick = filterPixelate;
        if ($('pi-vignette')) $('pi-vignette').onclick = filterVignette;
        if ($('pi-ripple'))   $('pi-ripple').onclick = filterRipple;
        if ($('pi-puppet'))   $('pi-puppet').onclick = puppetBegin;

        $('ps-zoom-in').onclick = () => { zoom = Math.min(8, zoom * 1.25); sizeWrap(); };
        $('ps-zoom-out').onclick = () => { zoom = Math.max(0.05, zoom / 1.25); sizeWrap(); };
        $('ps-zoom-fit').onclick = fitZoom;

        // files
        const fileIn = document.createElement('input');
        fileIn.type = 'file';
        fileIn.accept = 'image/png,image/jpeg,image/jpg,image/bmp,image/gif,image/webp,.psd,image/vnd.adobe.photoshop,image/*';
        fileIn.multiple = true;
        fileIn.style.display = 'none';
        document.body.appendChild(fileIn);
        $('pf-open').onclick = () => fileIn.click();
        const plImport = $('pl-import');
        if (plImport) plImport.onclick = () => fileIn.click();
        fileIn.onchange = () => { [...fileIn.files].forEach(placeImage); fileIn.value = ''; };

        // Drag an image straight onto the canvas, or paste one from the clipboard.
        const vp = $('paint-viewport');
        if (vp) {
          ['dragenter', 'dragover'].forEach(ev => vp.addEventListener(ev, e => {
            e.preventDefault(); vp.classList.add('drop-hot');
          }));
          ['dragleave', 'drop'].forEach(ev => vp.addEventListener(ev, e => {
            e.preventDefault(); vp.classList.remove('drop-hot');
          }));
          vp.addEventListener('drop', e => {
            const fs = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
            if (fs.length) fs.forEach(placeImage);
            else banner('That file type isn\'t an image.');
          });
        }
        document.addEventListener('paste', e => {
          if ($('paint-app').style.display === 'none') return;
          const items = [...(e.clipboardData.items || [])];
          const img = items.find(i => /^image\//.test(i.type));
          if (img) { placeImage(img.getAsFile()); banner('Pasted image as a new layer.'); }
        });
        // Export: name + format. JPG has no alpha, so transparent areas are flattened
        // onto white rather than turning black, which is what the raw encoder would do.
        function exportFormat() {
          const f = ($('pf-format') && $('pf-format').value) || 'png';
          const q = (parseInt($('pf-quality') ? $('pf-quality').value : 92) || 92) / 100;
          const mime = f === 'png' ? 'image/png' : f === 'webp' ? 'image/webp' : 'image/jpeg';
          return { ext: f, mime, q };
        }
        function exportName(fallback) {
          let n = ($('pf-name') && $('pf-name').value || '').trim() || fallback;
          n = n.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(png|jpe?g|webp)$/i, '');
          return n || fallback;
        }
        function flattenFor(cv, mime) {
          if (mime !== 'image/jpeg') return cv;
          const out = document.createElement('canvas');
          out.width = cv.width; out.height = cv.height;
          const g = out.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
          g.drawImage(cv, 0, 0);
          return out;
        }
      // ── PSD export ──────────────────────────────────────────────────────────
      // PNG/JPG flatten everything, so a multi-layer document loses its structure
      // the moment it leaves the app. This writes a real .psd with each layer kept
      // separate, so work can continue in Photoshop, Affinity, GIMP or Krita.
      //
      // Format notes: PSD is big-endian throughout. Channel data is written
      // uncompressed (compression 0) — larger files than RLE, but simple and hard
      // to get subtly wrong. Layers are stored bottom-up, matching our own order.
      //
      // The buffer is sized EXACTLY up front. An earlier version grew by doubling
      // and blew up on allocation: a 1024x1024 document is 1MB per channel, and
      // four channels per layer adds up fast enough that repeated doubling asks
      // for far more memory than the file actually needs.
      function psdExport(name) {
        const src = layers.filter(l => l.kind !== 'group' && l.canvas);
        if (!src.length) throw new Error('there are no layers to export');
        const n = W * H;

        // Pull every layer's channels first — needed for sizing and for writing.
        const planes = src.map(l => {
          const d = l.ctx.getImageData(0, 0, W, H).data;
          const a = new Uint8Array(n), r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n);
          for (let i = 0; i < n; i++) {
            r[i] = d[i*4]; g[i] = d[i*4+1]; b[i] = d[i*4+2]; a[i] = d[i*4+3];
          }
          return { r, g, b, a, layer: l };
        });

        const names = planes.map(p => (p.layer.name || 'Layer').slice(0, 255));
        // Per layer: 16 bounds + 2 channel count + 4*6 channel info + 12 blend
        //            + 4 extra-length + 8 (mask+ranges) + padded name
        const nameLen = (s) => { let L = 1 + s.length; while (L % 4) L++; return L; };
        let recLen = 2;
        planes.forEach((p, k) => { recLen += 16 + 2 + 24 + 12 + 4 + 8 + nameLen(names[k]); });
        const chanLen = planes.length * 4 * (2 + n);
        const layerInfoLen = recLen + chanLen;
        const pad = (layerInfoLen % 2) ? 1 : 0;
        const total = 26 + 4 + 4                    // header + colour mode + resources
                    + 4 + 4 + layerInfoLen + pad + 4 // layer & mask section
                    + 2 + 3 * n;                     // composite
        const buf = new Uint8Array(total);
        let len = 0;
        const u8  = (v) => { buf[len++] = v & 0xff; };
        const u16 = (v) => { u8(v >> 8); u8(v); };
        const u32 = (v) => { u8(v >>> 24); u8(v >>> 16); u8(v >>> 8); u8(v); };
        const str = (s) => { for (let i = 0; i < s.length; i++) u8(s.charCodeAt(i)); };
        const blob = (arr) => { buf.set(arr, len); len += arr.length; };

        // ── Header ──
        str('8BPS'); u16(1); for (let i = 0; i < 6; i++) u8(0);
        u16(3); u32(H); u32(W); u16(8); u16(3);
        u32(0);                     // colour mode data
        u32(0);                     // image resources

        // ── Layer & mask information ──
        u32(4 + layerInfoLen + pad + 4);
        u32(layerInfoLen + pad);
        u16(planes.length);
        planes.forEach((p, k) => {
          u32(0); u32(0); u32(H); u32(W);         // bounds: the full canvas
          u16(4);                                  // channels: A,R,G,B
          [0xffff, 0, 1, 2].forEach(id => { u16(id); u32(2 + n); });
          str('8BIM');
          str(psdBlendKey(p.layer.blend));
          u8(Math.round((p.layer.opacity != null ? p.layer.opacity : 1) * 255));
          u8(0);                                   // clipping
          u8(p.layer.visible === false ? 2 : 0);   // flags: bit 1 = hidden
          u8(0);                                   // filler
          const nm = names[k];
          u32(8 + nameLen(nm));                    // extra data length
          u32(0);                                  // layer mask data
          u32(0);                                  // blending ranges
          const at = len;
          u8(nm.length); str(nm);
          while ((len - at) % 4) u8(0);
        });
        // Channel data, in the order the records declared it.
        planes.forEach(p => {
          [p.a, p.r, p.g, p.b].forEach(ch => { u16(0); blob(ch); });
        });
        if (pad) u8(0);
        u32(0);                                    // global layer mask info

        // ── Composite (what apps show before parsing layers) ──
        const flat = flatten();
        const fd = flat.getContext('2d').getImageData(0, 0, W, H).data;
        u16(0);
        for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) u8(fd[i*4 + c]);
        return buf.subarray(0, len);
      }

      // Map our CSS blend names onto PSD's four-character keys.
      function psdBlendKey(b) {
        const m = { 'source-over':'norm', 'normal':'norm', 'multiply':'mul ', 'screen':'scrn',
          'overlay':'over', 'darken':'dark', 'lighten':'lite', 'color-dodge':'div ',
          'color-burn':'idiv', 'hard-light':'hLit', 'soft-light':'sLit', 'difference':'diff',
          'exclusion':'smud', 'hue':'hue ', 'saturation':'sat ', 'color':'colr', 'luminosity':'lum ' };
        return m[b] || 'norm';
      }

        function doExport(cv, fallback) {
          const { ext, mime, q } = exportFormat();
          const src = flattenFor(cv, mime);
          const url = src.toDataURL(mime, (mime === 'image/jpeg' || mime === 'image/webp') ? q : undefined);
          const a = document.createElement('a');
          a.href = url; a.download = `${exportName(fallback)}.${ext}`;
          document.body.appendChild(a); a.click(); a.remove();
          banner(`Exported ${a.download}.`);
        }
        if ($('pf-format')) $('pf-format').onchange = e => {
          const row = $('pf-quality-row');
          if (row) row.style.display = e.target.value === 'png' ? 'none' : '';   // quality applies to jpg/webp
        };
        if ($('pf-quality')) $('pf-quality').oninput = e => $('pf-quality-val').textContent = e.target.value;
        // ── Canvas size dialog ────────────────────────────────────────────────
        // Width/height lived at the top of the Image tab, above a long column of
        // adjustments — so changing canvas size meant scrolling past filters you
        // weren't using. It's a document-level setting, so it belongs with Edit.
        // Drives the existing resize control, so one implementation.
        function openCanvasSize() {
          const w = $('pi-w'), h = $('pi-h');
          if (w && $('cs-w')) { $('cs-w').value = w.value; $('cs-w-val').textContent = w.value + ' px'; }
          if (h && $('cs-h')) { $('cs-h').value = h.value; $('cs-h-val').textContent = h.value + ' px'; }
          $('cs-backdrop').classList.add('open');
          $('cs-dialog').classList.add('open');
        }
        function closeCanvasSize() {
          $('cs-backdrop').classList.remove('open');
          $('cs-dialog').classList.remove('open');
        }
        window.openCanvasSize = openCanvasSize;
        ['cs-w','cs-h'].forEach(id => {
          const el = $(id); if (!el) return;
          el.oninput = () => { $(id + '-val').textContent = el.value + ' px'; };
        });
        document.querySelectorAll('[data-cspreset]').forEach(b => {
          b.onclick = () => {
            const [pw, ph] = b.dataset.cspreset.split(',');
            $('cs-w').value = pw; $('cs-w-val').textContent = pw + ' px';
            $('cs-h').value = ph; $('cs-h-val').textContent = ph + ' px';
          };
        });
        if ($('cs-close'))  $('cs-close').onclick = closeCanvasSize;
        if ($('cs-cancel')) $('cs-cancel').onclick = closeCanvasSize;
        if ($('cs-backdrop')) $('cs-backdrop').onclick = closeCanvasSize;
        if ($('cs-go')) $('cs-go').onclick = () => {
          const w = $('pi-w'), h = $('pi-h');
          if (w) { w.value = $('cs-w').value; if (w.oninput) w.oninput({ target: w }); }
          if (h) { h.value = $('cs-h').value; if (h.oninput) h.oninput({ target: h }); }
          closeCanvasSize();
          const r = $('pi-resize'); if (r) r.click();
        };

        // ── Export dialog ─────────────────────────────────────────────────────
        // Name and format used to live in the Files panel while the export button
        // was in the File menu, so you had to visit two places to change one
        // thing. This asks for both at the point you export. It writes the values
        // through to the existing Files-panel controls and then triggers the same
        // doExport path, so there's still one implementation of the export itself.
        let expScope = 'all';
        function expSyncExt() {
          const f = $('exp-format');
          const ext = f ? f.value : 'png';
          const e = $('exp-ext'); if (e) e.textContent = '.' + ext;
          const row = $('exp-quality-row');
          // Quality is a lossy-format idea; PNG and PSD are both lossless.
          if (row) row.style.display = (ext === 'png' || ext === 'psd') ? 'none' : '';
          // A PSD is the whole layered document by definition, so the scope
          // toggle would be meaningless.
          const scope = $('exp-scope');
          if (scope) scope.style.display = (ext === 'psd') ? 'none' : '';
        }
        function openExportDialog(scope) {
          expScope = scope || 'all';
          document.querySelectorAll('#exp-scope .toggle-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.scope === expScope));
          // Seed from the panel so the dialog reflects whatever is already set.
          const pf = $('pf-format'), pn = $('pf-name'), pq = $('pf-quality');
          if (pf && $('exp-format')) $('exp-format').value = (pf.value === 'jpeg') ? 'jpg' : pf.value;
          if (pq && $('exp-quality')) { $('exp-quality').value = pq.value; $('exp-quality-val').textContent = pq.value; }
          const nameField = $('exp-name');
          if (nameField) {
            const l = active();
            // Suggest from the SCOPE first. Reading the stored panel name first
            // meant "Export current layer" still proposed the whole-image name,
            // so you'd save a single layer under a misleading filename.
            const suggested = (expScope === 'layer')
              ? ((l && l.name) || 'layer')
              : ((pn && pn.value.trim()) || 'artwork');
            nameField.value = suggested;
            delete nameField.dataset.touched;   // fresh dialog, fresh suggestion
          }
          expSyncExt();
          expNote();
          $('exp-backdrop').classList.add('open');
          $('exp-dialog').classList.add('open');
          setTimeout(() => { if (nameField) nameField.select(); }, 30);
        }
        function closeExportDialog() {
          $('exp-backdrop').classList.remove('open');
          $('exp-dialog').classList.remove('open');
        }
        function expNote() {
          const n = $('exp-note'); if (!n) return;
          const fmt = $('exp-format') ? $('exp-format').value : 'png';
          const l = active();
          const bits = [];
          if (expScope === 'layer') bits.push('Exporting "' + ((l && l.name) || 'current layer') + '" only.');
          else bits.push('Exporting all visible layers, flattened.');
          if (fmt === 'jpg') bits.push('JPG has no transparency — transparent areas become white.');
          if (fmt === 'psd') bits.push('PSD keeps every layer separate, with its name, opacity and blend mode.');
          n.textContent = bits.join(' ');
        }
        document.querySelectorAll('#exp-scope .toggle-btn').forEach(b => {
          b.onclick = () => {
            expScope = b.dataset.scope;
            document.querySelectorAll('#exp-scope .toggle-btn').forEach(x =>
              x.classList.toggle('active', x === b));
            const nameField = $('exp-name');
            if (nameField && !nameField.dataset.touched) {
              const l = active();
              nameField.value = expScope === 'layer' ? ((l && l.name) || 'layer') : 'artwork';
            }
            expNote();
          };
        });
        if ($('exp-name')) $('exp-name').oninput = (e) => { e.target.dataset.touched = '1'; };
        if ($('exp-format')) $('exp-format').onchange = () => { expSyncExt(); expNote(); };
        if ($('exp-quality')) $('exp-quality').oninput = (e) => { $('exp-quality-val').textContent = e.target.value; };
        if ($('exp-close'))  $('exp-close').onclick  = closeExportDialog;
        if ($('exp-cancel')) $('exp-cancel').onclick = closeExportDialog;
        if ($('exp-backdrop')) $('exp-backdrop').onclick = closeExportDialog;
        if ($('exp-go')) $('exp-go').onclick = () => {
          // Push the dialog's choices into the panel controls, which are what
          // exportFormat() and exportName() read.
          const pf = $('pf-format'), pn = $('pf-name'), pq = $('pf-quality');
          if (pf) { pf.value = $('exp-format').value; if (pf.onchange) pf.onchange({ target: pf }); }
          if (pq && $('exp-quality')) pq.value = $('exp-quality').value;
          const nm = ($('exp-name').value || '').trim();
          closeExportDialog();
          if (($('exp-format') || {}).value === 'psd') {
            try {
              banner('Building PSD…');
              const data = psdExport(nm);
              const blob = new Blob([data], { type: 'image/vnd.adobe.photoshop' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = (nm || 'artwork') + '.psd';
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              const n = layers.filter(l => l.kind !== 'group' && l.canvas).length;
              banner('Exported ' + n + ' layer' + (n === 1 ? '' : 's') + ' as PSD.');
            } catch (err) {
              console.error('PSD export failed:', err);
              banner('\u26a0\ufe0f Couldn\'t build the PSD: ' + ((err && err.message) || err));
            }
            return;
          }
          // doExport reads the name from the shared panel field, so set it for the
          // duration of this export. For a layer export we restore the previous
          // value afterwards, otherwise the layer's name would silently become the
          // default for the next whole-image export.
          const prevName = pn ? pn.value : null;
          if (pn) pn.value = nm;
          try {
            if (expScope === 'layer') {
              const l = active();
              if (!l) return banner('Select a layer first.');
              doExport(l.canvas, l.name || 'layer');
            } else {
              doExport(flatten(), 'artwork');
            }
          } finally {
            if (pn && expScope === 'layer') pn.value = prevName;
          }
        };
        window.openExportDialog = openExportDialog;

        $('pf-png').onclick = () => doExport(flatten(), 'artwork');
        $('pf-png-layer').onclick = () => { const l = active(); if (l) doExport(l.canvas, l.name || 'layer'); };
        $('pf-to3d').onclick = () => {
          const flat = flatten();
          flat.toBlob(b => {
            const f = new File([b], 'artwork.png', { type: 'image/png' });
            // Hand the flattened artwork to the 3D side's Image→3D input.
            const inp = document.getElementById('bld-img3d-input');
            if (!inp) return banner('Image → 3D input not found.');
            const dt = new DataTransfer(); dt.items.add(f);
            inp.files = dt.files;
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            setMode('model');
            // make sure the Create tab (which holds Image → 3D) is showing
            const createTab = document.querySelector('#side-tabs button[data-tab="create"]');
            if (createTab) createTab.click();
            const sec = document.getElementById('sec-img3d');
            if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
            banner('Sent to Image → 3D.');
          }, 'image/png');
        };
        $('pf-plane-w').oninput = e => $('pf-plane-w-val').textContent = e.target.value + ' mm';

        // Wrap the artwork onto the currently selected 3D object as colour.
        $('pf-to3d-tex').onclick = () => {
          if (!window.ModelSmith3D || !window.ModelSmith3D.applyImageTexture) {
            return banner("⚠️ The 3D side hasn't finished loading — try again in a moment.");
          }
          const url = flatten().toDataURL('image/png');
          setMode('model');
          // hand over once the 3D workspace is actually on screen
          setTimeout(() => window.ModelSmith3D.applyImageTexture(url, { alpha: true }), 60);
        };

        // Drop the artwork in as a flat picture standing on the build plate.
        $('pf-to3d-plane').onclick = () => {
          if (!window.ModelSmith3D || !window.ModelSmith3D.createImagePlane) {
            return banner("⚠️ The 3D side hasn't finished loading — try again in a moment.");
          }
          const mm = parseInt($('pf-plane-w').value) || 40;
          const url = flatten().toDataURL('image/png');
          setMode('model');
          setTimeout(() => window.ModelSmith3D.createImagePlane(url, mm), 60);
        };

        $('pf-clear').onclick = () => {
          if (!confirm('Clear all artwork? This cannot be undone.')) return;
          layers = []; layerSeq = 1;
          const bg = makeLayer('Background', 'raster');
          bg.ctx.fillStyle = '#ffffff'; bg.ctx.fillRect(0, 0, W, H);
          layers.push(bg); activeId = bg.id;
          history = []; histIndex = -1;
          composite(); renderLayerList(); pushHistory(); banner('Cleared.');
        };

        // keyboard (only while in paint mode)
        document.addEventListener('keydown', (e) => {
          if (document.getElementById('paint-app').style.display === 'none') return;
          // The hidden text-capture field is a textarea, but it IS the live text
          // editor rather than an unrelated form field — it handles its own keys, so
          // let it through rather than treating focus there as "typing elsewhere".
          const ae = document.activeElement;
          const inCapture = ae && ae.id === 'ps-text-capture';
          const typing = !inCapture && /INPUT|TEXTAREA|SELECT/.test(ae ? ae.tagName : '');
          if (typing) return;
          if (inCapture) return;   // its own listeners handle Enter/Escape/input
          const k = e.key.toLowerCase();
          const pick = (t) => setTool(t);
          // While text is live the canvas is the text field, so keystrokes must be
          // consumed here BEFORE any tool shortcut matching — otherwise typing "b"
          // would switch to the brush instead of adding a letter.
          // Puppet warp owns the keyboard while it's active.
          if (puppet) {
            if (k === 'enter')  { e.preventDefault(); puppetCommit(); return; }
            if (k === 'escape') { e.preventDefault(); puppetCancel(); return; }
            if (k === 'backspace') {
              e.preventDefault();
              puppet.pins.pop(); puppetPreview(); composite(); return;
            }
          }
          if (liveText) {
            if (k === 'escape') {
              e.preventDefault();
              liveText = null; textDrag = null; stopCaret(); blurTextCapture(); composite();
              banner('Text discarded.'); return;
            }
            if (k === 'enter') { e.preventDefault(); commitText(); return; }
            if (k === 'backspace') {
              e.preventDefault();
              liveText.str = liveText.str.slice(0, -1);
              syncTextCapture(); composite(); return;
            }
            if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              liveText.str += e.key;
              syncTextCapture(); composite(); return;
            }
          }
          if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
          else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
          else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); clearSelection(); banner('Deselected.'); }
          else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'i') { e.preventDefault(); msImageOps.invertSel(); }
          else if ((e.ctrlKey || e.metaKey) && k === 'a') {
            e.preventDefault();
            const m = new Uint8Array(W * H).fill(1);
            selFromMask(m); composite(); banner('Selected the whole canvas.');
          }
          // Tool shortcuts come from the shared keybind registry so they can be
          // remapped from the settings cog. The literals below are only a fallback
          // for the case where the registry hasn't loaded.
          else if (window.Keys && Keys.is('paint','brush',e)) pick('brush');
          else if (window.Keys && Keys.is('paint','pencil',e)) pick('pencil');
          else if (window.Keys && Keys.is('paint','marker',e)) pick('marker');
          else if (window.Keys && Keys.is('paint','airbrush',e)) pick('airbrush');
          else if (window.Keys && Keys.is('paint','eraser',e)) pick('eraser');
          else if (window.Keys && Keys.is('paint','fill',e)) pick('fill');
          else if (window.Keys && Keys.is('paint','picker',e)) pick('picker');
          else if (window.Keys && Keys.is('paint','selectTool',e)) pick('selrect');
          else if (window.Keys && Keys.is('paint','moveTool',e)) pick('move');
          else if (window.Keys && Keys.is('paint','text',e)) pick('text');
          else if (window.Keys && Keys.is('paint','magic',e)) pick('magic');
          else if (window.Keys && Keys.is('paint','clone',e)) pick('clone');
          else if (window.Keys && Keys.is('paint','swapColors',e)) { const t = fg; fg = bg; bg = t; syncColorUI(); }
          else if (!window.Keys && k === 'b') pick('brush');
          else if (!window.Keys && k === 'e') pick('eraser');
          else if (!window.Keys && k === 'v') pick('selrect')
          else if (k === 'enter' && liveText) { e.preventDefault(); commitText(); }
          else if (k === 'enter' && xform) { e.preventDefault(); commitTransform(); }
          else if (k === 'escape') {
            if (xform) { cancelTransform(); }
            else if (liveText) { liveText = null; textDrag = null; composite(); banner('Text discarded.'); }
            else if (penPts.length) { penPts = []; previewShape = null; composite(); }
            else if (sel) { clearSelection(); banner('Deselected.'); }
          }
          else if ((k === 'delete' || k === 'backspace') && tool === 'vedit' && vSel) {
            const l = active();
            if (l && l.kind === 'vector' && l.shapes[vSel.shapeIndex]) {
              e.preventDefault();
              l.shapes.splice(vSel.shapeIndex, 1);
              vSel = null; renderVector(l); composite();
              pushHistory(); renderLayerList(); banner('Shape deleted.');
            }
          }
          else if (k === 'enter' && tool === 'pen') finishPen();
        });

        window.addEventListener('resize', () => { if ($('paint-app').style.display !== 'none') sizeWrap(); });
      
        _wired = true;
}

      // ── Mode switching ──────────────────────────────────────────────────────
      function setMode(mode) {
        const model = document.querySelector('.app-container:not(.paint-app)');
        const paint = $('paint-app');
        if (!model || !paint) return;
        const toPaint = mode === 'paint';
        model.style.display = toPaint ? 'none' : '';
        paint.style.display = toPaint ? '' : 'none';
        document.querySelectorAll('#mode-switch .mode-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.mode === mode));
        const sub = document.querySelector('.brand-sub');
        if (sub) sub.textContent = toPaint ? 'paint studio' : 'CAD suite';
        if (toPaint) { if (!layers.length) init(); fitZoom(); composite(); }
        else if (window.invalidate3D) {
          // Coming back to 3D: the render loop idles while the 2D studio is showing,
          // so explicitly ask for frames or the viewport stays blank until you touch
          // something. Two passes — one now, one after layout settles.
          window.invalidate3D();
          setTimeout(() => { if (window.invalidate3D) window.invalidate3D(); }, 60);
          window.dispatchEvent(new Event('resize'));
        }
        if (window.renderHistoryPanel) window.renderHistoryPanel();
        else if (window.dispatchEvent) window.dispatchEvent(new Event('resize'));
      }

      function init() {
        if (!view) return;
        view.width = W; view.height = H;
        // Record the opening state, whether the document is new or restored. Without
        // it the timeline starts empty, the first stroke lands at index 0, and undo
        // has nothing to step back to — the "can't undo my first stroke" bug.
        const baseline = () => {
          if (history.length) return;
          history = []; histIndex = -1;
          pushHistory('Opened');
        };
        // A restored session decodes its layers asynchronously, so the snapshot has
        // to wait for the pixels; otherwise undo would restore a blank canvas.
        if (!load(baseline) || !layers.length) {
          const bg = makeLayer('Background', 'raster');
          bg.ctx.fillStyle = '#ffffff'; bg.ctx.fillRect(0, 0, W, H);
          const l1 = makeLayer('Layer 1', 'raster');
          layers = [bg, l1]; activeId = l1.id;
          baseline();
        }
        fitZoom(); renderLayerList(); composite(); syncHud(); syncFontList();
      }

      // boot
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { wire(); });
      else wire();
      document.querySelectorAll('#mode-switch .mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));

      // ── Collapsible panel sections ──────────────────────────────────────────
      // Make every panel section (both the 3D and Paint side panels) collapse from
      // its header, so unused tool groups don't eat vertical space. Runs once at
      // load; state persists per-section in localStorage.
      function enhanceCollapsibleSections() {
        const CHEVRON = '<svg class="collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        // Sections whose visibility/content is managed dynamically must NOT be made
        // collapsible — wrapping their body fights the code that shows/hides parts of
        // them (e.g. the contextual Tool panel swaps .tool-ctx children in and out).
        const SKIP = new Set(['psec-tool']);
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('modelsmith_collapsed_v1') || '{}'); } catch (e) {}
        const persist = () => { try { localStorage.setItem('modelsmith_collapsed_v1', JSON.stringify(saved)); } catch (e) {} };

        document.querySelectorAll('.section').forEach(section => {
          if (SKIP.has(section.id) || section.dataset.collapsibleReady) return;
          // Only a real .section-label is a valid collapse header. Never treat a
          // .tool-ctx-name (which changes text as tools switch) as one.
          const header = section.querySelector(':scope > .section-label');
          if (!header) return;
          section.dataset.collapsibleReady = '1';

          // Wrap everything after the header into a body wrapper we can animate.
          const body = document.createElement('div');
          body.className = 'section-body';
          let node = header.nextSibling;
          while (node) { const next = node.nextSibling; body.appendChild(node); node = next; }
          section.appendChild(body);

          header.classList.add('collapsible');
          header.insertAdjacentHTML('beforeend', CHEVRON);

          const key = section.id || header.textContent.trim();
          const setState = (collapsed, animate) => {
            if (collapsed) {
              body.style.height = body.scrollHeight + 'px';
              requestAnimationFrame(() => { section.classList.add('section-collapsed'); body.style.height = '0px'; });
            } else {
              section.classList.remove('section-collapsed');
              body.style.height = body.scrollHeight + 'px';
              const done = () => { if (!section.classList.contains('section-collapsed')) body.style.height = ''; body.removeEventListener('transitionend', done); };
              if (animate) body.addEventListener('transitionend', done); else body.style.height = '';
            }
          };

          if (saved[key]) { section.classList.add('section-collapsed'); body.style.height = '0px'; }

          header.addEventListener('click', (e) => {
            if (e.target.closest('button, input, select, a')) return;
            const nowCollapsed = !section.classList.contains('section-collapsed');
            setState(nowCollapsed, true);
            saved[key] = nowCollapsed; persist();
          });
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceCollapsibleSections);
      else enhanceCollapsibleSections();

      return { setMode, addLayer, undo, redo, init, composite,
               _history: () => history, _histIndex: () => histIndex, _jump: jumpToStep,
               _liveText: () => liveText, _setTool: (t) => setTool(t), _icon: (k) => svg(k),
               _cursorPos: () => cursorPos, _floatSel: () => floatSel, _sel: () => sel,
               _tool: () => tool, _layers: () => layers, _xform: () => xform, _zoom: () => zoom, _vsel: () => vSel };
    })();
    window.Paint = Paint;

    // Expose the paint timeline to the shared history panel.
    (window.__historyPending = window.__historyPending || []).push(['paint', {
      list: () => Paint._history(),
      index: () => Paint._histIndex(),
      jump: (i) => Paint._jump(i),
      limit: 60
    }]);

    // The header Undo/Redo must serve whichever workspace is on screen. This is
    // wired here (outside the 3D module's init) so it stays reliable even if the
    // 3D side is still starting up or failed to load — the paint studio doesn't
    // depend on three.js.
    (function wireHeaderHistory() {
      const attach = () => {
        const u = document.getElementById('bld-undo');
        const r = document.getElementById('bld-redo');
        if (!u || !r) return;
        const inPaint = () => {
          const p = document.getElementById('paint-app');
          return p && p.style.display !== 'none';
        };
        u.addEventListener('click', (e) => {
          if (inPaint()) { e.stopImmediatePropagation(); Paint.undo(); }
        }, true);
        r.addEventListener('click', (e) => {
          if (inPaint()) { e.stopImmediatePropagation(); Paint.redo(); }
        }, true);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
      else attach();
    })();
  
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


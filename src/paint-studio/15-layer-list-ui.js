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


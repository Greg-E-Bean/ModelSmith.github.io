
    // ── 3D menu bar (standalone) ─────────────────────────────────────────────
    // Mirrors the 2D studio's File/Edit/... bar so both workspaces are consistent.
    // Every entry drives an existing panel control rather than reimplementing the
    // command, so there's one implementation of each and the panels stay usable.
    // Deliberately outside the 3D engine's script block, which bails out early
    // without WebGL — the menu should still be there to explain what's missing.
    (function () {
      function build() {
        const bar = document.getElementById('model-menubar');
        if (!bar || bar.dataset.built) return;
        bar.dataset.built = '1';
        const hit = (id) => { const e = document.getElementById(id); if (e) e.click(); };
        const tab = (t) => { const b = document.querySelector('#side-tabs button[data-tab="' + t + '"]'); if (b) b.click(); };
        const prim = (p) => { const b = document.querySelector('[data-prim="' + p + '"]'); if (b) b.click(); };
        const tool = (t) => { const b = document.getElementById('tool-' + t); if (b) b.click(); };
        const dlg = (sec, title, run, lbl) => window.openToolDialog && openToolDialog(sec, title, run, lbl);
        const T3 = () => window.msTools3D || {};

        const MENUS = [
          { name: 'File', items: [
            { label: 'Files…',               fn: () => window.openFilesDialog && openFilesDialog() },
            { sep: true },
            { label: 'Import model…',        fn: () => hit('bld-dropzone') },
            { label: 'Export model…',        fn: () => window.openExportModel && openExportModel() },
            { sep: true },
            { label: 'Saved versions…',      fn: () => { if (window.openFilesDialog) { openFilesDialog(); setTimeout(() => { const b=document.querySelector('#fd-tabs button[data-fd="versions"]'); if(b) b.click(); }, 40); } } },
            { sep: true },
            { label: 'Save session now',     fn: () => hit('bld-session-save') },
            { label: 'Clear scene',          fn: () => hit('bld-session-clear') }
          ]},
          { name: 'Edit', items: [
            { label: 'Undo',            fn: () => hit('bld-undo'), key: 'Ctrl Z' },
            { label: 'Redo',            fn: () => hit('bld-redo'), key: 'Ctrl \u21e7 Z' },
            { label: 'History…',        fn: () => hit('bld-history') },
            { sep: true },
            { label: 'Select all',      fn: () => hit('bld-select-all'), key: 'Ctrl A' },
            { label: 'Deselect',        fn: () => hit('bld-select-none') },
            { label: 'Multi-select on/off', fn: () => hit('bld-multiselect-toggle') },
            { sep: true },
            { label: 'Keyboard shortcuts…', fn: () => hit('keys-open') },
            { label: 'Search commands…', fn: () => window.openCommandPalette && openCommandPalette(), key: 'Ctrl K' }
          ]},
          { name: 'Select', items: [
            { label: 'Centre on plate', fn: () => hit('bld-centre') },
            { label: 'Drop to plate',   fn: () => hit('bld-settle') },
            { sep: true },
            { label: 'Duplicate',       fn: () => hit('bld-duplicate'), key: 'Ctrl D' },
            { label: 'Delete',          fn: () => hit('bld-delete'), key: 'Del' },
            { sep: true },
            { menulabel: 'Align' },
            { label: 'Align min',    fn: () => hit('bld-align-min') },
            { label: 'Align centre', fn: () => hit('bld-align-mid') },
            { label: 'Align max',    fn: () => hit('bld-align-max') },
            { label: 'Distribute',   fn: () => hit('bld-distribute') },
            { label: 'Align axis…',  fn: () => tab('select') }
          ]},
          { name: 'Create', items: [
            { menulabel: 'Primitives' },
            { label: 'Cube', fn: () => prim('box'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>' },
            { label: 'Sphere', fn: () => prim('sphere'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="3.6" ry="9"/></svg>' },
            { label: 'Cylinder', fn: () => prim('cylinder'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12a7 3 0 0 0 14 0V6"/></svg>' },
            { label: 'Cone', fn: () => prim('cone'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3 4.5 18"/><path d="M12 3l7.5 15"/><ellipse cx="12" cy="18" rx="7.5" ry="3"/></svg>' },
            { label: 'Wedge', fn: () => prim('wedge'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 19h18L21 8 3 19Z"/><path d="M21 8 9 12l-6 7"/></svg>' },
            { sep: true },
            { label: '3D text…',        fn: () => window.openBuilderDialog && openBuilderDialog('text3d') },
            { label: 'Image → 3D…',     fn: () => window.openBuilderDialog && openBuilderDialog('img3d') },
            { label: 'Screw thread…',   fn: () => window.openBuilderDialog && openBuilderDialog('thread') },
            { label: 'QR code / barcode…', fn: () => dlg('sec-qr3d', 'QR code / barcode', 'bld-qr3d-go', 'Add to scene') },
            { sep: true },
            { menulabel: 'From sketches' },
            { label: 'Sketch',          fn: () => tool('sketch') },
            { label: 'Revolve…',        fn: () => dlg('sec-revolve', 'Revolve', 'bld-revolve-run', 'Revolve') },
            { label: 'Loft…',           fn: () => dlg('sec-loft', 'Loft', 'bld-loft-run', 'Loft') }
          ]},
          { name: 'Modify', items: [
            { menulabel: 'Combine' },
            { label: 'Subtract',   fn: () => hit('bld-boolean-subtract') },
            { label: 'Intersect',  fn: () => hit('bld-boolean-intersect') },
            { label: 'Split',      fn: () => hit('bld-boolean-split') },
            { sep: true },
            { label: 'Group',      fn: () => hit('bld-group') },
            { label: 'Ungroup',    fn: () => hit('bld-ungroup') },
            { label: 'Merge',      fn: () => hit('bld-merge') },
            { sep: true },
            { menulabel: 'Arrange' },
            { label: 'Mirror X',   fn: () => hit('bld-mirror-x') },
            { label: 'Mirror Y',   fn: () => hit('bld-mirror-y') },
            { label: 'Mirror Z',   fn: () => hit('bld-mirror-z') },
            { label: 'Array…',     fn: () => dlg('sec-array', 'Array', 'bld-array-run', 'Create array') },
            { label: 'Lay flat on face', fn: () => T3().layFlat && T3().layFlat() },
            { sep: true },
            { menulabel: 'Shape' },
            { label: 'Shell / hollow…', fn: () => dlg('sec-shell', 'Shell / hollow', 'bld-shell-run', 'Hollow') },
            { label: 'Smooth…',    fn: () => dlg('sec-smooth', 'Smooth', 'bld-smooth-run', 'Smooth') },
            { label: 'Subdivide',  fn: () => hit('bld-sculpt-subdivide') },
            { label: 'Repair mesh', fn: () => hit('bld-repair-mesh') }
          ]},
          { name: 'Tools', items: [
            { label: 'Select & transform', fn: () => tool('select'), key: 'V' },
            { label: 'Sketch',             fn: () => tool('sketch'), key: 'K' },
            { label: 'Push / pull',        fn: () => tool('pushpull') },
            { label: 'Sculpt',             fn: () => tool('sculpt') },
            { sep: true },
            { label: 'Slice',              fn: () => tool('slice'), key: 'L' },
            { label: 'Fillet / chamfer',   fn: () => tool('fillet') },
            { label: 'Paint',              fn: () => tool('paint') },
            { label: 'Mould / cast',       fn: () => tool('mold'), key: 'O' },
            { label: 'Measure',            fn: () => tool('measure'), key: 'U' },
            { sep: true },
            { label: 'Model info…',        fn: () => T3().info && T3().info() }
          ]},
          { name: 'View', items: [
            { label: 'Panels…', fn: () => window.openPanelManager && openPanelManager() },
            { label: 'Display…', fn: () => window.openDisplaySettings && openDisplaySettings() },
            { sep: true },
            { label: 'X-ray enclosing objects', fn: () => {
                if (window.setXray) { const on = !window.getXray(); setXray(on);
                  const b = document.getElementById('bld-banner');
                  if (b) b.textContent = on
                    ? 'X-ray on — anything containing your selection shows as a blue mesh.'
                    : 'X-ray off.'; } } },
            { sep: true },
            { label: 'Section view',    fn: () => T3().section && T3().section(), key: 'X' },
            { sep: true },
            { label: 'Frame selection', fn: () => hit('bld-frame-sel'), key: 'F' },
            { label: 'Frame all',       fn: () => hit('bld-frame-all') },
            { menulabel: 'Standard views' },
            { label: 'Top',    fn: () => T3().view('top'),    key: '7' },
            { label: 'Front',  fn: () => T3().view('front'),  key: '1' },
            { label: 'Right',  fn: () => T3().view('right'),  key: '3' },
            { label: '3/4 view', fn: () => T3().view('iso'),  key: '0' },
            { sep: true },
            { menulabel: 'Snapping' },
            { label: 'Move snap: off / 0.5 / 1 / 5 mm', fn: () => { const s = T3().snapState(); const seq = [0, 0.5, 1, 5]; T3().moveSnap(seq[(seq.indexOf(s.move) + 1) % seq.length]); } },
            { label: 'Rotate snap: off / 5° / 15° / 45°', fn: () => { const s = T3().snapState(); const seq = [0, 5, 15, 45]; T3().rotateSnap(seq[(seq.indexOf(s.rotate) + 1) % seq.length]); } },
            { sep: true },
            { menulabel: 'Panels' },
            { label: 'Select',          fn: () => tab('select') },
            { label: 'Create',          fn: () => tab('create') },
            { label: 'Edit',            fn: () => tab('edit') },
          ]}
        ];

        let open = null;
        const closeAll = () => {
          bar.querySelectorAll('.menu-drop').forEach(d => d.classList.remove('open'));
          bar.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
          open = null;
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
            b.innerHTML = (it.icon ? '<span class="mi-icon">' + it.icon + '</span>' : '') +
                          '<span>' + it.label + '</span>' +
                          (it.key ? '<span class="mi-key">' + it.key + '</span>' : '');
            b.onclick = () => { closeAll(); try { it.fn(); } catch (e) { console.error(e); } };
            drop.appendChild(b);
          });
          btn.onclick = (e) => {
            e.stopPropagation();
            const was = drop.classList.contains('open');
            closeAll();
            if (!was) { drop.classList.add('open'); btn.classList.add('open'); open = drop; }
          };
          btn.onmouseenter = () => {
            if (open && open !== drop) { closeAll(); drop.classList.add('open'); btn.classList.add('open'); open = drop; }
          };
          wrap.append(btn, drop);
          bar.appendChild(wrap);
        });
        document.addEventListener('click', closeAll);
      }
      function boot() {
        build();
        // The renderer sizes itself to the workspace at start-up. Adding the menu
        // bar changes that height AFTER the engine has measured, so without this
        // the canvas keeps its old size — which showed up as a 0-height viewport.
        setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 400);
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else boot();
    })();
  
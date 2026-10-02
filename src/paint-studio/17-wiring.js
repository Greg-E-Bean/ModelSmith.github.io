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

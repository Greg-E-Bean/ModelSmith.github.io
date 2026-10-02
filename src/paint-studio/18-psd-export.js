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


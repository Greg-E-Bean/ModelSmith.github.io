
    // ── Simple / Advanced mode ────────────────────────────────────────────────
    // Simple shows the everyday tools with plain labels; Advanced shows all of
    // them. It only hides things — every command still works the same, is still
    // reachable from Command search, and its keyboard shortcut still works.
    (function () {
      const KEY = 'modelsmith_uimode_v1';
      const SEEN = 'modelsmith_welcome_v1';
      // Menu items that only appear in Advanced, per workspace (matched by label).
      const ADV = {
        model: ['Files…', 'History…', 'Multi-select on/off', 'Keyboard shortcuts…',
          'Align min', 'Align centre', 'Align max', 'Distribute', 'Align axis…',
          'Wedge', 'Screw thread…', 'Sketch', 'Revolve…', 'Loft…',
          'Intersect', 'Split', 'Mirror Z', 'Array…', 'Smooth…', 'Subdivide',
          'Push / pull', 'Sculpt', 'Paint', 'Mould / cast',
          'Panels…', 'X-ray enclosing objects', 'Move snap: off / 0.5 / 1 / 5 mm', 'Rotate snap: off / 5° / 15° / 45°',
          'Select', 'Create', 'Edit'],
        paint: ['Import image…', 'Export current layer…', 'Use as texture', 'Place as flat image',
          'Invert selection', 'Grow selection 4 px', 'Shrink selection 4 px', 'Keyboard shortcuts…',
          'Trim empty edges', 'Rotate 180°', 'Flip canvas vertical', 'Flip layer horizontal', 'Flip layer vertical',
          'New vector layer', 'New group', 'Rasterize layer', 'Flatten text', 'Add layer mask', 'Layer effects…',
          'Levels…', 'Curves…', 'Sepia', 'Threshold', 'Posterize', 'Emboss', 'Find edges', 'Pixelate', 'Add noise',
          'Vignette', 'Puppet warp', 'Ripple', 'Panels…', 'Tool options', 'Image panel']
      };
      // 'Select' / 'Create' / 'Edit' above are the View → Panels entries (the
      // sidebar panels are an Advanced feature); the Select *menu* is a menu button.
      const ADV_TOOLS_3D = ['sketch', 'sculpt', 'pushpull', 'mold'];
      const ADV_TOOLS_2D = ['calligraphy', 'spray', 'smudge', 'blurbrush', 'dodge', 'burn', 'clone', 'gradient',
        'hexagon', 'polygon', 'star', 'pen', 'vedit', 'transform', 'selmove', 'lasso', 'seloval'];

      // Small, consistent icons for the commands people use most.
      const P = {
        import: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
        export: '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
        folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>',
        save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
        trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
        undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
        redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
        history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
        selall: '<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2.2"/><path d="m8 12 3 3 5-6"/>',
        desel: '<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2.2"/><path d="m9 9 6 6M15 9l-6 6"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        keys: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M7 14h10"/>',
        centre: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
        drop: '<path d="M12 3v11M8 10l4 4 4-4"/><path d="M3.5 19.5h17"/>',
        dup: '<rect x="8" y="8" width="12.5" height="12.5" rx="2"/><path d="M16 8V5.5A2 2 0 0 0 14 3.5H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H8"/>',
        text: '<path d="M4 6.5V4h16v2.5M12 4v16M9 20h6"/>',
        image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5.5-5.5L5 20"/>',
        qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/>',
        subtract: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M15 9h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-4" stroke-dasharray="2.5 2"/>',
        group: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 7h3a3 3 0 0 1 3 3v3" opacity=".6"/>',
        merge: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
        mirror: '<path d="M12 3v18" stroke-dasharray="2.5 2"/><path d="M9 7 4 17h5ZM15 7l5 10h-5Z"/>',
        layflat: '<path d="M3.5 20.5h17"/><path d="m7 16.5 5-9 5 9Z"/><path d="M12 3v2" opacity=".6"/>',
        shell: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>',
        repair: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3.5 17.5l3 3 5.7-5.7a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5Z"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
        measure: '<rect x="2.5" y="8" width="19" height="8" rx="1.6"/><path d="M6.5 8v3M10.5 8v4.5M14.5 8v3M18.5 8v4.5"/>',
        fillet: '<path d="M4.5 20V11.5a7 7 0 0 1 7-7h8.5"/>',
        slice: '<path d="M4 8.5 12 4.5l8 4v8l-8 4-8-4Z"/><path d="M2.5 13.5 21.5 10" stroke-dasharray="2.6 2.2"/>',
        select: '<path d="M5.5 3.5 18.5 10l-5.7 1.7-2.3 5.8Z"/>',
        section: '<path d="M4 8.5 12 4.5l8 4v8l-8 4-8-4Z"/><path d="M4 12.5l8 4 8-4" fill="currentColor" fill-opacity=".25"/>',
        frame: '<path d="M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8M16 3h3.5A1.5 1.5 0 0 1 21 4.5V8M21 16v3.5a1.5 1.5 0 0 1-1.5 1.5H16M8 21H4.5A1.5 1.5 0 0 1 3 19.5V16"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
        cube: '<path d="M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7Z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>',
        display: '<circle cx="12" cy="12" r="3.5"/><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/>',
        layer: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5" opacity=".7"/>',
        crop: '<path d="M6 2.5V18h15.5"/><path d="M2.5 6H18v15.5"/>',
        rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3.5v5h-5"/>',
        flip: '<path d="M12 3v18" stroke-dasharray="2.5 2"/><path d="M8.5 7 3.5 12l5 5ZM15.5 7l5 5-5 5Z"/>',
        adjust: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" fill-opacity=".35"/>',
        blur: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 2.6" opacity=".6"/>',
        invert: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor"/>',
        zoomin: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
        zoomout: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
        to3d: '<path d="M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7Z"/><path d="M8.5 12h7M12 8.5v7" opacity=".7"/>',
        newdoc: '<path d="M6 2.5h8l4.5 4.5v13a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-16A1.5 1.5 0 0 1 6 2.5Z"/><path d="M14 2.5V7h4.5M11.5 11v6M8.5 14h6"/>',
        views: '<rect x="3" y="3" width="8" height="8" rx="1.3"/><rect x="13" y="3" width="8" height="8" rx="1.3"/><rect x="3" y="13" width="8" height="8" rx="1.3"/><rect x="13" y="13" width="8" height="8" rx="1.3"/>'
      };
      const ICON_BY_LABEL = [
        [/^Import|^Open image/, 'import'], [/^Export/, 'export'], [/^Files…|^Saved versions/, 'folder'], [/^Save session/, 'save'],
        [/^Clear scene|^Delete|^New \/ clear/, 'trash'], [/^Undo$/, 'undo'], [/^Redo$/, 'redo'], [/^History/, 'history'],
        [/^Select all/, 'selall'], [/^Deselect/, 'desel'], [/^Search commands/, 'search'], [/^Keyboard shortcuts/, 'keys'],
        [/^Centre on plate/, 'centre'], [/^Drop to plate/, 'drop'], [/^Duplicate/, 'dup'], [/^3D text/, 'text'],
        [/^Image → 3D|^Place as flat image|^Use as texture/, 'image'], [/^QR/, 'qr'], [/^Subtract/, 'subtract'],
        [/^Group$|^Ungroup$|^New group/, 'group'], [/^Merge/, 'merge'], [/^Mirror/, 'mirror'], [/^Lay flat/, 'layflat'],
        [/^Shell/, 'shell'], [/^Repair/, 'repair'], [/^Model info/, 'info'], [/^Measure/, 'measure'], [/^Fillet/, 'fillet'],
        [/^Slice/, 'slice'], [/^Select & transform/, 'select'], [/^Section view/, 'section'], [/^Frame/, 'frame'],
        [/^Top$|^Front$|^Right$|^3\/4 view/, 'views'], [/^Display/, 'display'], [/^New layer|^New vector layer|^Layers panel/, 'layer'],
        [/^Canvas size|^Crop|^Trim/, 'crop'], [/^Rotate 90|^Rotate 180/, 'rotate'], [/^Flip/, 'flip'],
        [/^Brightness|^Levels|^Curves/, 'adjust'], [/^Blur|^Sharpen/, 'blur'], [/^Invert colours|^Greyscale/, 'invert'],
        [/^Zoom in/, 'zoomin'], [/^Zoom out/, 'zoomout'], [/^Fit to screen/, 'frame'], [/^Extrude shape/, 'to3d']
      ];
      const svgOf = (k) => '<svg class="mi-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + P[k] + '</svg>';

      function mode() { try { return localStorage.getItem(KEY) || 'simple'; } catch (e) { return 'simple'; } }
      function decorate(barId, scope) {
        const bar = document.getElementById(barId); if (!bar) return;
        const adv = new Set(ADV[scope]);
        bar.querySelectorAll('.menu-drop').forEach(drop => {
          const menuName = drop.parentElement.querySelector('.menu-btn').textContent.trim();
          let inPanels = false;
          [...drop.children].forEach(ch => {
            if (ch.classList.contains('menu-label')) inPanels = scope === 'model' && menuName === 'View' && ch.textContent.trim() === 'Panels';
            if (!ch.classList.contains('menu-item')) return;
            const sp = ch.querySelector('span:not(.mi-ic):not(.mi-key)'); const label = (sp || ch).textContent.trim();
            // "Select"/"Create"/"Edit" are Advanced only as View → Panels entries
            const isPanelDup = ['Select', 'Create', 'Edit'].includes(label);
            ch.classList.toggle('mi-adv', adv.has(label) && (!isPanelDup || inPanels));
            if (!ch.querySelector('.mi-ic') && !ch.querySelector('svg')) {
              const hit = ICON_BY_LABEL.find(([re]) => re.test(label));
              ch.insertAdjacentHTML('afterbegin', hit ? svgOf(hit[1]) : '<span class="mi-ic mi-ic-blank"></span>');
            } else if (ch.querySelector('svg') && !ch.querySelector('.mi-ic')) {
              ch.querySelector('svg').classList.add('mi-ic');
            }
          });
          // Hide section labels / separators whose whole group is Advanced-only.
          const kids = [...drop.children];
          kids.forEach((ch, i) => {
            if (!ch.classList.contains('menu-label') && !ch.classList.contains('menu-sep')) return;
            let j = i + 1, any = false, count = 0;
            while (j < kids.length && !kids[j].classList.contains('menu-sep') && !(kids[j].classList.contains('menu-label') && j > i + 1)) {
              if (kids[j].classList.contains('menu-item')) { count++; if (!kids[j].classList.contains('mi-adv')) any = true; }
              j++;
            }
            ch.classList.toggle('mi-adv', count > 0 && !any);
          });
        });
      }
      function decorateAll() { decorate('model-menubar', 'model'); decorate('paint-menubar', 'paint'); }
      function apply(m) {
        document.body.classList.toggle('ms-simple', m === 'simple');
        document.body.classList.toggle('ms-advanced', m !== 'simple');
        document.querySelectorAll('#ui-mode button').forEach(b => b.classList.toggle('active', b.dataset.ui === m));
        // leaving an Advanced-only tool active in Simple would strand the user
        if (m === 'simple') {
          const a = document.querySelector('#tool-rail button[data-tool].active');
          if (a && ADV_TOOLS_3D.includes(a.dataset.tool)) { const s = document.getElementById('tool-select'); if (s) s.click(); }
        }
      }
      function set(m) {
        try { localStorage.setItem(KEY, m); } catch (e) {}
        apply(m);
        const msg = m === 'simple' ? 'Simple mode — the everyday tools. Switch to Advanced any time for everything.' : 'Advanced mode — every tool and option is shown.';
        ['bld-banner', 'paint-banner'].forEach(id => {
          const el = document.getElementById(id); if (!el || el.offsetParent === null) return;
          el.textContent = msg; el.classList.add('show');
          clearTimeout(el._uiT); el._uiT = setTimeout(() => el.classList.remove('show'), 3200);
        });
      }
      window.msUIMode = { get: mode, set, isAdvancedItem: (el) => el.classList.contains('mi-adv') };

      function welcome() {
        let seen = false; try { seen = !!localStorage.getItem(SEEN); } catch (e) {}
        if (seen) return;
        const w = document.createElement('div');
        w.className = 'ms-welcome';
        w.innerHTML = '<div class="mw-backdrop"></div><div class="mw-card" role="dialog" aria-label="Welcome">' +
          '<div class="mw-head"><div class="mw-logo">' + svgOf('cube').replace('mi-ic', '') + '</div><div><b>Welcome to ModelSmith</b><span>Design 3D-printed parts and prepare artwork, all offline.</span></div></div>' +
          '<div class="mw-spaces"><div><i>' + svgOf('cube').replace('mi-ic', '') + '</i><b>3D workspace</b><span>Shapes, scans, cuts, rounding and export for printing.</span></div>' +
          '<div><i>' + svgOf('image').replace('mi-ic', '') + '</i><b>2D studio</b><span>Paint, layers and filters — and send artwork to 3D.</span></div></div>' +
          '<div class="mw-q">How would you like to start?</div>' +
          '<div class="mw-modes"><button data-pick="simple" class="on"><b>Simple</b><span>The everyday tools, with labels. Best if you are new.</span></button>' +
          '<button data-pick="advanced"><b>Advanced</b><span>Every tool, option and panel.</span></button></div>' +
          '<div class="mw-foot"><span>You can switch at any time — top bar, or press <kbd>Ctrl K</kbd> to search every command.</span><button class="mini-btn primary" id="mw-go">Get started</button></div></div>';
        document.body.appendChild(w);
        let pick = 'simple';
        w.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { pick = b.dataset.pick; w.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', x === b)); });
        const done = () => { try { localStorage.setItem(SEEN, '1'); } catch (e) {} set(pick); w.remove(); };
        w.querySelector('#mw-go').onclick = done;
        w.querySelector('.mw-backdrop').onclick = done;
        requestAnimationFrame(() => w.classList.add('open'));
      }

      function init() {
        const actions = document.querySelector('.header-actions');
        if (actions && !document.getElementById('ui-mode')) {
          const t = document.createElement('div');
          t.className = 'ui-mode'; t.id = 'ui-mode';
          t.innerHTML = '<button data-ui="simple" data-tip="Simple — the everyday tools, with labels">Simple</button><button data-ui="advanced" data-tip="Advanced — every tool and option">Advanced</button>';
          actions.insertBefore(t, actions.firstChild);
          t.querySelectorAll('button').forEach(b => b.onclick = () => set(b.dataset.ui));
        }
        ADV_TOOLS_3D.forEach(tl => { const b = document.getElementById('tool-' + tl); if (b) b.classList.add('rail-adv'); });
        const style = document.createElement('style');
        style.textContent = ADV_TOOLS_2D.map(t => `body.ms-simple .rail-fly-btn[data-ptool="${t}"]`).join(',') + '{display:none!important}';
        document.head.appendChild(style);
        apply(mode());
        decorateAll();
        // Menus are (re)built by each workspace; re-decorate whenever they change.
        ['model-menubar', 'paint-menubar'].forEach(id => {
          const bar = document.getElementById(id);
          if (bar) new MutationObserver(() => { clearTimeout(bar._decT); bar._decT = setTimeout(() => decorate(id, id === 'model-menubar' ? 'model' : 'paint'), 30); })
            .observe(bar, { childList: true, subtree: true });
        });
        setTimeout(decorateAll, 400);
        setTimeout(welcome, 900);
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    })();
  
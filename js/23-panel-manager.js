
    // ── Panel manager ────────────────────────────────────────────────────────
    // Every command lives in the menus, and the sidebar panels are hidden by
    // default so they aren't a second copy of the same thing. Some people would
    // rather tap a visible button than open a menu — especially on a touch
    // screen — so this lets you switch panels back on one at a time, with an eye
    // icon showing which are on. Both routes drive the same controls, so nothing
    // is duplicated and they can never disagree.
    (function () {
      const KEY = 'modelsmith_panelitems_v1';
      // id, label, and which workspace it belongs to.
      const ITEMS = [
        { id: 'sec-primitives', label: 'Primitives',            where: 'Create', ws: '3d' },
        { id: 'sec-text3d',     label: '3D text',                where: 'Create', ws: '3d' },
        { id: 'sec-img3d',      label: 'Image \u2192 3D',            where: 'Create', ws: '3d' },
        { id: 'sec-thread',     label: 'Screw thread',           where: 'Create', ws: '3d' },
        { id: 'sec-qr3d',       label: 'QR / Barcode',           where: 'Create', ws: '3d' },
        { id: 'sec-booleans',   label: 'Booleans',              where: 'Edit', ws: '3d' },
        { id: 'bld-mirror-x',   label: 'Mirror buttons',        where: 'Edit', ws: '3d', also: ['bld-mirror-y','bld-mirror-z'] },
        { id: 'bld-group',      label: 'Group / ungroup / merge',where: 'Edit', ws: '3d', also: ['bld-ungroup','bld-merge'] },
        { id: 'bld-align-min',  label: 'Align & distribute',    where: 'Select', ws: '3d', also: ['bld-align-mid','bld-align-max','bld-distribute'] },
        { id: 'bld-smooth-run', label: 'Smooth button',         where: 'Edit', ws: '3d' },
        { id: 'bld-select-all', label: 'Select & frame buttons',where: 'Select', ws: '3d', also: ['bld-select-none','bld-frame-sel','bld-frame-all','bld-multiselect-toggle'] },
        { id: 'bld-export-stl', label: 'Export buttons',        where: 'Files', ws: '3d', also: ['bld-export-obj','bld-export-3mf','bld-repair-mesh'] },
        { id: 'bld-duplicate',  label: 'Centre / duplicate / delete / drop', where: 'Select', ws: '3d', also: ['bld-centre','bld-settle','bld-delete'] },
        { id: 'bld-session-save', label: 'Session buttons',     where: 'Files', ws: '3d', also: ['bld-session-clear'] },
        { id: 'lsub-new',       label: 'Create & arrange',      where: 'Layers', ws: '2d' },
        { id: 'lsub-qr2d',      label: 'QR / Barcode',          where: 'Layers', ws: '2d' },
        { id: 'lsub-mask',      label: 'Mask controls',         where: 'Layers', ws: '2d' },
        { id: 'pf-png',         label: 'Export buttons',        where: 'Files', ws: '2d', also: ['pf-png-layer','pf-clear'] },
        { id: 'pf-to3d',        label: 'Send to 3D buttons',    where: 'Files', ws: '2d', also: ['pf-to3d-tex','pf-to3d-plane'] }
      ];
      // Tabs that only exist when their panel is on.
      const TABS = [
        { id: 'tab-create', label: 'Create tab', where: 'tab', ws: '3d', sel: '#side-tabs button[data-tab="create"]' },
        { id: 'tab-ie',     label: 'Files tab',  where: 'tab', ws: '3d', sel: '#side-tabs button[data-tab="ie"]' },
        { id: 'tab-files2d',label: 'Files tab',  where: 'tab', ws: '2d', sel: '#paint-tabs button[data-ptab="files"]' }
      ];

      function get() {
        try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }
        catch (e) { return new Set(); }
      }
      function save(s) {
        try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch (e) {}
      }
      function applyOne(key, on) {
        const item = ITEMS.find(i => i.id === key);
        if (item) {
          [item.id, ...(item.also || [])].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('ms-show', on);
          });
          return;
        }
        const tab = TABS.find(t => t.id === key);
        if (tab) {
          const el = document.querySelector(tab.sel);
          if (el) el.classList.toggle('ms-show', on);
        }
      }
      function applyAll() {
        const s = get();
        ITEMS.forEach(i => applyOne(i.id, s.has(i.id)));
        TABS.forEach(t => applyOne(t.id, s.has(t.id)));
      }

      const EYE_ON = '<svg class="pn-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
      const EYE_OFF = '<svg class="pn-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.2-.95"/></svg>';

      // Which workspace is on screen? Listing 2D panels while you're modelling in
      // 3D is just noise — you can't see the effect of ticking them.
      function activeWs() {
        const p = document.getElementById('paint-app');
        return (p && p.style.display !== 'none') ? '2d' : '3d';
      }
      function render() {
        const host = document.getElementById('pn-list');
        if (!host) return;
        const s = get();
        const ws = activeWs();
        const t = document.getElementById('pn-title');
        if (t) t.textContent = ws === '2d' ? 'Panels — 2D studio' : 'Panels — 3D workspace';
        host.innerHTML = '';
        const all = [
          ...TABS.filter(t => t.ws === ws).map(t => ({ id: t.id, label: t.label, where: t.where })),
          ...ITEMS.filter(i => i.ws === ws).map(i => ({ id: i.id, label: i.label, where: i.where }))
        ];
        all.forEach(row => {
          const on = s.has(row.id);
          const b = document.createElement('button');
          b.className = 'pn-row' + (on ? ' on' : '');
          b.innerHTML = (on ? EYE_ON : EYE_OFF) +
            '<span class="pn-label">' + row.label + '</span>' +
            '<span class="pn-where">' + row.where + '</span>';
          b.onclick = () => {
            const cur = get();
            if (cur.has(row.id)) cur.delete(row.id); else cur.add(row.id);
            save(cur); applyOne(row.id, cur.has(row.id)); render();
          };
          host.appendChild(b);
        });
      }
      function open() {
        render();
        document.getElementById('pn-backdrop').classList.add('open');
        document.getElementById('pn-dialog').classList.add('open');
      }
      function close() {
        document.getElementById('pn-backdrop').classList.remove('open');
        document.getElementById('pn-dialog').classList.remove('open');
      }
      window.openPanelManager = open;

      function wire() {
        const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
        on('pn-close', close);
        on('pn-backdrop', close);
        // Show/Hide all act on the workspace you're looking at, leaving the other
        // one's choices alone.
        on('pn-all', () => {
          const ws = activeWs(), s = get();
          ITEMS.filter(i => i.ws === ws).forEach(i => s.add(i.id));
          TABS.filter(t => t.ws === ws).forEach(t => s.add(t.id));
          save(s); applyAll(); render();
        });
        on('pn-none', () => {
          const ws = activeWs(), s = get();
          ITEMS.filter(i => i.ws === ws).forEach(i => s.delete(i.id));
          TABS.filter(t => t.ws === ws).forEach(t => s.delete(t.id));
          save(s); applyAll(); render();
        });
        applyAll();
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
      else wire();
    })();
  

    // ── Command search (Ctrl+K) ───────────────────────────────────────────────
    // One box that finds any command in the current workspace — every menu item
    // plus the 2D tools — so nothing has to be hunted for. It reads the live
    // menu bar, so new menu items appear here automatically.
    (function () {
      let box = null, input = null, list = null, items = [], shown = [], cur = 0;
      const is2D = () => { const pa = document.getElementById('paint-app'); return pa && pa.style.display !== 'none'; };
      function collect() {
        const out = [];
        const root = is2D() ? document.getElementById('paint-app') : document.getElementById('model-app');
        const bars = root ? root.querySelectorAll('.menu-btn') : [];
        bars.forEach(mb => {
          const drop = mb.parentElement.querySelector('.menu-drop'); if (!drop) return;
          let section = '';
          [...drop.children].forEach(ch => {
            if (ch.classList.contains('menu-label')) { section = ch.textContent.trim(); return; }
            if (ch.classList.contains('menu-sep')) { section = ''; return; }
            if (!ch.classList.contains('menu-item')) return;
            const label = (ch.querySelector('span:not(.mi-ic):not(.mi-key)') || ch).textContent.trim();
            const key = ch.querySelector('.mi-key') ? ch.querySelector('.mi-key').textContent : '';
            out.push({ label, where: mb.textContent.trim() + (section ? ' › ' + section : ''), key, run: () => ch.click(),
                       adv: document.body.classList.contains('ms-simple') && ch.classList.contains('mi-adv') });
          });
        });
        if (is2D() && window.msPaintTools) msPaintTools.list().forEach(t => out.push({
          label: t.label.replace(/\s*\(.*?\)\s*$/, '').replace(/ — .*/, ''), where: 'Tool', key: (t.label.match(/\(([^)]+)\)\s*$/) || [])[1] || '',
          run: () => msPaintTools.set(t.t) }));
        return out;
      }
      function score(q, text) {
        if (!q) return 1;
        text = text.toLowerCase();
        const i = text.indexOf(q);
        if (i >= 0) return 100 - i + (i === 0 || text[i - 1] === ' ' ? 50 : 0);
        let ti = 0, s = 0;                 // subsequence match, rewarding adjacency
        for (const c of q) { const j = text.indexOf(c, ti); if (j < 0) return 0; s += j === ti ? 3 : 1; ti = j + 1; }
        return s;
      }
      function render() {
        const q = input.value.trim().toLowerCase();
        shown = items.map(it => ({ it, s: Math.max(score(q, it.label), score(q, it.where + ' ' + it.label) * 0.6) }))
          .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.it);
        cur = Math.min(cur, Math.max(0, shown.length - 1));
        list.innerHTML = shown.length ? '' : '<div class="cp-empty">No matching command</div>';
        shown.forEach((it, i) => {
          const row = document.createElement('button');
          row.className = 'cp-row' + (i === cur ? ' on' : '');
          row.innerHTML = '<span class="cp-label"></span>' + (it.adv ? '<em class="cp-adv">Advanced</em>' : '') + '<span class="cp-where"></span>' + (it.key ? '<kbd></kbd>' : '');
          row.querySelector('.cp-label').textContent = it.label;
          row.querySelector('.cp-where').textContent = it.where;
          if (it.key) row.querySelector('kbd').textContent = it.key;
          row.onmouseenter = () => { cur = i; mark(); };
          row.onclick = () => go(i);
          list.appendChild(row);
        });
      }
      function mark() { [...list.children].forEach((r, i) => r.classList.toggle('on', i === cur)); const r = list.children[cur]; if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
      function go(i) { const it = shown[i]; close(); if (it) setTimeout(() => { try { it.run(); } catch (e) { console.error(e); } }, 10); }
      function build() {
        box = document.createElement('div'); box.className = 'cp-wrap';
        box.innerHTML = '<div class="cp-backdrop"></div><div class="cp-panel" role="dialog" aria-label="Command search">' +
          '<div class="cp-input-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '<input type="text" placeholder="Search commands and tools…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><div class="cp-list"></div>' +
          '<div class="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span></div></div>';
        document.body.appendChild(box);
        input = box.querySelector('input'); list = box.querySelector('.cp-list');
        box.querySelector('.cp-backdrop').onclick = close;
        input.oninput = () => { cur = 0; render(); };
        input.onkeydown = (e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(shown.length - 1, cur + 1); mark(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); mark(); }
          else if (e.key === 'Enter') { e.preventDefault(); go(cur); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
          e.stopPropagation();
        };
      }
      function open() {
        if (!box) build();
        items = collect(); cur = 0; input.value = '';
        box.classList.add('open'); render();
        setTimeout(() => input.focus(), 20);
      }
      function close() { if (box) box.classList.remove('open'); }
      window.openCommandPalette = open;
      window.addEventListener('keydown', (e) => {
        const scope = is2D() ? 'paint' : 'model';
        const hit = window.Keys ? Keys.is(scope, 'palette', e) : ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');
        if (hit) { e.preventDefault(); e.stopPropagation(); (box && box.classList.contains('open')) ? close() : open(); }
      }, true);
      function wire() { const b = document.getElementById('cmd-open'); if (b) b.onclick = open; }
      if (document.readyState !== 'loading') wire(); else document.addEventListener('DOMContentLoaded', wire);
    })();
  
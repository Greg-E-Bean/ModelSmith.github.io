
    // ═══════════════════════════════════════════════════════════════════════════
    //   HISTORY PANEL
    //   One panel serving both workspaces. Each side registers a small adapter
    //   describing its timeline; the panel just renders whichever is on screen.
    // ═══════════════════════════════════════════════════════════════════════════
    (function () {
      const providers = {};   // mode -> { list, index, jump, limit }
      window.registerHistory = (mode, api) => { providers[mode] = api; };
      // Modules that loaded before this panel left their adapters in a queue.
      (window.__historyPending || []).forEach(([m, api]) => { providers[m] = api; });
      window.__historyPending = { push: ([m, api]) => { providers[m] = api; } };

      const inPaint = () => {
        const p = document.getElementById('paint-app');
        return p && p.style.display !== 'none';
      };
      const current = () => providers[inPaint() ? 'paint' : 'model'];

      const timeAgo = (t) => {
        if (!t) return '';
        const s = Math.round((Date.now() - t) / 1000);
        if (s < 5) return 'just now';
        if (s < 60) return s + 's ago';
        if (s < 3600) return Math.round(s / 60) + 'm ago';
        return Math.round(s / 3600) + 'h ago';
      };

      window.renderHistoryPanel = function () {
        const box = document.getElementById('hist-list');
        const foot = document.getElementById('hist-foot');
        if (!box) return;
        const p = current();
        if (!p) { box.innerHTML = '<div class="hist-empty">No history yet.</div>'; return; }
        const list = p.list() || [];
        const idx = p.index();
        box.innerHTML = '';
        if (!list.length) { box.innerHTML = '<div class="hist-empty">No history yet.</div>'; if (foot) foot.textContent = ''; return; }
        list.forEach((snap, i) => {
          const row = document.createElement('div');
          row.className = 'hist-row' + (i === idx ? ' current' : '') + (i > idx ? ' ahead' : '');
          const th = document.createElement('img');
          th.className = 'hist-thumb';
          th.alt = '';
          if (snap.thumb) th.src = snap.thumb;
          const meta = document.createElement('div');
          meta.className = 'hist-meta';
          const lab = document.createElement('div');
          lab.className = 'hist-label';
          lab.textContent = snap.label || 'Step ' + (i + 1);
          const sub = document.createElement('div');
          sub.className = 'hist-sub';
          sub.textContent = (i === idx ? 'current · ' : i > idx ? 'ahead · ' : '') + timeAgo(snap.at);
          meta.append(lab, sub);
          row.append(th, meta);
          row.onclick = () => { p.jump(i); renderHistoryPanel(); };
          row.title = i > idx ? 'Still available — jump forward to this step' : 'Jump back to this step';
          box.appendChild(row);
        });
        if (foot) foot.textContent = `${list.length} of ${p.limit || 60} steps · newest at top`;
      };

      // Place the panel just under the History button, kept inside the viewport.
      function placePop(btn, pop) {
        const r = btn.getBoundingClientRect();
        const w = pop.offsetWidth || 252;
        let left = r.right - w;                          // right-align with the button
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        pop.style.left = left + 'px';
        pop.style.top = (r.bottom + 6) + 'px';
        // if it would overflow the bottom, cap the list so it still fits
        const room = window.innerHeight - r.bottom - 20;
        const list = document.getElementById('hist-list');
        if (list) list.style.maxHeight = Math.max(120, Math.min(340, room - 70)) + 'px';
      }

      const attach = () => {
        const btn = document.getElementById('bld-history');
        const pop = document.getElementById('history-pop');
        if (!btn || !pop) return;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const opening = !pop.classList.contains('open');
          pop.classList.toggle('open');
          if (opening) { renderHistoryPanel(); placePop(btn, pop); }
        });
        window.addEventListener('resize', () => { if (pop.classList.contains('open')) placePop(btn, pop); });
        document.getElementById('hist-close').onclick = () => pop.classList.remove('open');
        document.addEventListener('pointerdown', (e) => {
          if (!pop.classList.contains('open')) return;
          if (pop.contains(e.target) || btn.contains(e.target)) return;
          pop.classList.remove('open');
        });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
      else attach();
    })();
  
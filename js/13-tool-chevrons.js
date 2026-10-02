
    // ── 3D tool chevrons + floating options (standalone) ─────────────────────
    // This is deliberately OUTSIDE the 3D engine's script block. That block bails
    // out early if WebGL/three.js isn't available, and when it did the tool rail
    // silently lost its mode chevrons and the floating options bar. None of this
    // needs the engine — it's DOM wiring that talks to the existing panel
    // controls — so it runs on its own.
    (function () {
      function build() {
        // Mode flyouts on tools that have modes.
        const MODES = {
          paint: { label: 'Paint modes', items: [
            { name: 'Brush',  hint: 'Paint freehand with a radius', apply: () => pick('paint-mode', 'brush') },
            { name: 'Face',   hint: 'Fill one flat face at a time', apply: () => pick('paint-mode', 'face') },
            { name: 'Object', hint: 'Recolour the whole object',    apply: () => pick('paint-mode', 'object') }
          ]},
          // Slice modes were also on the Slice panel and the floating bar, so a
          // third route to them was clutter rather than convenience.
          _slice_removed: { label: 'Slice options', items: [
            { name: 'Keep both halves', hint: 'Cut and keep each side', apply: () => clickId('slice-keep-both') },
            { name: 'Keep front half',  hint: 'Discard the back',       apply: () => clickId('slice-keep-pos') },
            { name: 'Keep back half',   hint: 'Discard the front',      apply: () => clickId('slice-keep-neg') }
          ]}
        };
        const clickId = (id) => { const e = document.getElementById(id); if (e) e.click(); };
        function pick(groupId, val) {
          const g = document.getElementById(groupId);
          if (!g) return;
          const b = g.querySelector('[data-pmode="' + val + '"]');
          if (b) b.click();
        }
        let fly = null;
        const closeFly = () => { if (fly) { fly.remove(); fly = null; } };
        function openFly(cfg, slot) {
          closeFly();
          const f = document.createElement('div');
          f.className = 't3-flyout';
          cfg.items.forEach(it => {
            const b = document.createElement('button');
            b.className = 't3-fly-btn';
            b.innerHTML = '<span class="t3-fly-txt"><b>' + it.name + '</b><small>' + it.hint + '</small></span>';
            b.onclick = () => { it.apply(); closeFly(); };
            f.appendChild(b);
          });
          document.body.appendChild(f);
          const r = slot.getBoundingClientRect();
          f.style.top = (r.bottom + 6) + 'px';
          const w = f.getBoundingClientRect().width;
          f.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - 4)) + 'px';
          fly = f;
          setTimeout(() => document.addEventListener('pointerdown', onDown, { once: true }), 0);
          function onDown(e) {
            if (f.contains(e.target)) { setTimeout(() => document.addEventListener('pointerdown', onDown, { once: true }), 0); return; }
            closeFly();
          }
        }
        Object.keys(MODES).forEach(id => {
          const btn = document.getElementById('tool-' + id);
          if (!btn || btn.parentElement.classList.contains('t3-slot')) return;
          const slot = document.createElement('div');
          slot.className = 't3-slot';
          btn.parentElement.insertBefore(slot, btn);
          slot.appendChild(btn);
          const chev = document.createElement('button');
          chev.className = 't3-chev';
          chev.title = MODES[id].label;
          chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m8 10 4 4 4-4"/></svg>';
          chev.onclick = (e) => { e.stopPropagation(); openFly(MODES[id], slot); };
          slot.appendChild(chev);
        });

        // Floating options — mirror the panel controls so each setting still has
        // one source of truth.
        function mirror(hudId, panelId, fmt, valId) {
          const h = document.getElementById(hudId), p = document.getElementById(panelId);
          if (!h) return;
          const out = valId ? document.getElementById(valId) : null;
          const show = () => { if (out) out.textContent = fmt ? fmt(h.value) : h.value; };
          // Adopt the panel's range but NOT its step: the 3D panel's brush size uses
          // a fine step that renders as "6.02" in a compact bar. Keep the whole
          // numbers the floating control declares.
          if (p) { h.value = p.value; if (p.min !== '') h.min = p.min; if (p.max !== '') h.max = p.max; }
          h.oninput = () => { if (p) { p.value = h.value; if (p.oninput) p.oninput({ target: p }); } show(); };
          if (p) { const prev = p.oninput; p.oninput = (e) => { if (prev) prev(e); h.value = p.value; show(); }; }
          show();
        }
        mirror('t3-paint-size', 'paint-brush-size', v => Math.round(+v), 't3-paint-size-val');
        mirror('t3-paint-opacity', 'paint-opacity', v => Math.round(+v) + '%', 't3-paint-opacity-val');
        mirror('t3-slice-off',  'slice-off',  v => (+v).toFixed(1) + ' mm', 't3-slice-off-val');
        mirror('t3-fillet-rad', 'bld-fillet-rad', v => (+v).toFixed(1) + ' mm', 't3-fillet-rad-val');
        const col = document.getElementById('t3-paint-color'), pcol = document.getElementById('paint-color');
        if (col && pcol) {
          col.value = pcol.value;
          col.oninput = () => { pcol.value = col.value; if (pcol.oninput) pcol.oninput({ target: pcol }); };
        }
        const relay = (a, bId) => { const h = document.getElementById(a); if (h) h.onclick = () => clickId(bId); };
        relay('t3-slice-run', 'bld-slice-run');
        relay('t3-fillet-run', 'bld-fillet-run');

        // Show the group matching the active tool. Watching the rail's own
        // highlight means this works no matter how the tool was chosen.
        function sync() {
          const active = document.querySelector('#tool-rail button[data-tool].active');
          const t = active ? active.dataset.tool : null;
          let any = false;
          document.querySelectorAll('.t3-hud-group').forEach(g => {
            const on = g.dataset.t3for === t;
            g.classList.toggle('show', on);
            if (on) any = true;
          });
          // The divider only makes sense when there are options after it.
          const sep = document.getElementById('t3-sep');
          if (sep) sep.classList.toggle('show', any);
          // The transform bar itself is shown/hidden by the selection logic; when
          // a tool has options but nothing is selected, show it anyway so the
          // options are reachable.
          const bar = document.getElementById('floating-hud');
          if (bar && any && bar.style.display === 'none') bar.style.display = 'flex';
        }
        const rail = document.getElementById('tool-rail');
        if (rail) {
          new MutationObserver(sync).observe(rail, { attributes: true, subtree: true, attributeFilter: ['class'] });
          rail.addEventListener('click', () => setTimeout(sync, 0));
        }
        sync();
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
      else build();
    })();
  
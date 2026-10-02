
    // ── Tooltips ──────────────────────────────────────────────────────────────
    // Native title tooltips are slow, small and unstyled. This shows the same
    // text in the app's own style after a short hover (mouse and pen only —
    // touch keeps its long-press behaviour).
    (function () {
      let tip = null, timer = null, target = null;
      function hide() { clearTimeout(timer); timer = null; if (tip) tip.classList.remove('show'); target = null; }
      function place(el) {
        const r = el.getBoundingClientRect();
        tip.style.left = '0px'; tip.style.top = '0px';
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
        if (y + th > innerHeight - 6) y = r.top - th - 8;
        x = Math.max(6, Math.min(innerWidth - tw - 6, x));
        tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
      }
      document.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch') return;
        const el = e.target.closest && e.target.closest('[title],[data-tip]');
        if (!el || el === target) return;
        if (el.hasAttribute('title')) {
          const t = el.getAttribute('title');
          if (!t) return;
          el.setAttribute('data-tip', t); el.removeAttribute('title');
          if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
        }
        hide(); target = el;
        timer = setTimeout(() => {
          if (!target || !document.body.contains(target)) return;
          if (!tip) { tip = document.createElement('div'); tip.className = 'ms-tip'; document.body.appendChild(tip); }
          const txt = target.getAttribute('data-tip') || '';
          const m = txt.match(/^(.*?)\s*\(([^()]{1,14})\)\s*$/);   // "Brush (B)" -> label + key
          tip.innerHTML = '';
          const span = document.createElement('span'); span.textContent = m ? m[1] : txt; tip.appendChild(span);
          if (m) { const k = document.createElement('kbd'); k.textContent = m[2]; tip.appendChild(k); }
          place(target); tip.classList.add('show');
        }, 420);
      }, true);
      document.addEventListener('pointerout', (e) => { if (target && (!e.relatedTarget || !target.contains(e.relatedTarget))) hide(); }, true);
      ['pointerdown', 'wheel', 'keydown', 'scroll'].forEach(ev => document.addEventListener(ev, hide, true));
    })();
  
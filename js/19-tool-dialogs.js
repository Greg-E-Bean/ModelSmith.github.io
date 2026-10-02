
    // ── Tool dialogs ─────────────────────────────────────────────────────────
    // Shell, array, revolve, loft and the rest only lived in sidebar panels,
    // which are hidden by default — so from the menus they were unreachable.
    // This opens the tool's own panel section in a small window (MOVED in and
    // put back on close, never copied), so every control keeps its wiring.
    (function () {
      let cur = null, home = null, next = null;
      const $ = id => document.getElementById(id);
      function open(sectionId, title, runId, applyLabel) {
        const sec = $(sectionId); if (!sec) return;
        if (cur) close();
        cur = { sectionId, runId };
        home = sec.parentElement; next = sec.nextSibling;
        const body = $('sd-body'); body.innerHTML = '';
        sec.classList.add('sd-hosted'); sec.style.display = '';
        body.appendChild(sec);
        // the dialog's Apply replaces the panel's own run button while hosted
        const rb = runId && $(runId);
        if (rb && sec.contains(rb)) { cur.hiddenRun = rb; cur.runDisp = rb.style.display; rb.style.display = 'none'; }
        $('sd-title').textContent = title;
        $('sd-apply').style.display = runId ? '' : 'none';
        $('sd-apply').textContent = applyLabel || 'Apply';
        $('sd-backdrop').classList.add('open'); $('sd-dialog').classList.add('open');
      }
      function close() {
        if (!cur) return;
        const sec = $(cur.sectionId);
        if (cur.hiddenRun) cur.hiddenRun.style.display = cur.runDisp || '';
        if (sec && home) { sec.classList.remove('sd-hosted'); home.insertBefore(sec, next); }
        $('sd-backdrop').classList.remove('open'); $('sd-dialog').classList.remove('open');
        cur = null; home = null; next = null;
      }
      function apply() {
        if (!cur) return;
        const run = cur.runId && $(cur.runId);
        close();
        if (run) run.click();
      }
      function wire() {
        ['sd-close', 'sd-cancel', 'sd-backdrop'].forEach(id => { const e = $(id); if (e) e.onclick = close; });
        const a = $('sd-apply'); if (a) a.onclick = apply;
      }
      if (document.readyState !== 'loading') wire(); else document.addEventListener('DOMContentLoaded', wire);
      window.openToolDialog = open;
      window.closeToolDialog = close;
    })();
  
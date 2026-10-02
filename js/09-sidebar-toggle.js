
    // ── Sidebar toggle: overlay drawer on mobile/tablet, in-layout collapse
    //    on desktop — same button, behavior adapts to available width.
    (function(){
      const sidebar = document.getElementById('app-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      const toggle = document.getElementById('sidebar-toggle');
      const MQ = window.matchMedia('(max-width: 900px)');

      // Both workspaces (3D and Paint) have their own sidebar, so these controls
      // act on whichever is currently on screen.
      const visibleContainer = () => {
        const cs = [...document.querySelectorAll('.app-container')];
        return cs.find(c => c.style.display !== 'none') || cs[0];
      };
      const visibleSidebar = () => {
        const c = visibleContainer();
        return c ? c.querySelector('.sidebar') : sidebar;
      };

      function openDrawer(){ const s = visibleSidebar(); if (s) s.classList.add('open'); backdrop.classList.add('show'); }
      function closeDrawer(){ document.querySelectorAll('.sidebar').forEach(s => s.classList.remove('open')); backdrop.classList.remove('show'); }

      function toggleSidebar(){
        const s = visibleSidebar(); if (!s) return;
        if (MQ.matches) {
          s.classList.contains('open') ? closeDrawer() : openDrawer();
        } else {
          s.classList.toggle('collapsed');
        }
      }

      toggle.addEventListener('click', toggleSidebar);
      backdrop.addEventListener('click', closeDrawer);

      // Flip the panel between the left and right sides of the screen — applied to
      // both workspaces so the layout stays consistent when switching modes.
      const flipBtn = document.getElementById('side-flip');
      if (flipBtn) {
        const applySide = (right) => {
          document.querySelectorAll('.app-container').forEach(c => c.classList.toggle('panel-right', right));
          flipBtn.title = right ? 'Move panel to the left' : 'Move panel to the right';
        };
        flipBtn.addEventListener('click', () => {
          const right = !visibleContainer().classList.contains('panel-right');
          applySide(right);
          try { localStorage.setItem('modelsmith_panel_side', right ? 'right' : 'left'); } catch(e){}
        });
        // Default the properties panel to the RIGHT. That's the convention in both
        // Photoshop and GIMP — tools down the left edge, canvas in the middle,
        // panels on the right — and it keeps the 2D tool column hard against the
        // left edge instead of being pushed inward by the sidebar. An explicit
        // saved preference still wins.
        try {
          const saved = localStorage.getItem('modelsmith_panel_side');
          applySide(saved ? saved === 'right' : true);
        } catch(e){ applySide(true); }
      }

      // Hints/tips toggle: add a body class that hides all .hint text, so panels
      // become compact once the user knows the tools. Remembered across sessions.
      const hintsBtn = document.getElementById('hints-toggle');
      if (hintsBtn) {
        const applyHints = (off) => {
          document.body.classList.toggle('hints-off', off);
          hintsBtn.classList.toggle('active', off);
          hintsBtn.title = off ? 'Show tips' : 'Hide tips';
        };
        hintsBtn.addEventListener('click', () => {
          const off = !document.body.classList.contains('hints-off');
          applyHints(off);
          try { localStorage.setItem('modelsmith_hints_off', off ? '1' : '0'); } catch(e){}
        });
        try { if (localStorage.getItem('modelsmith_hints_off') === '1') applyHints(true); } catch(e){}
      }

      // Picking a primitive/tool on a small screen should hand the view back
      // to the 3D viewport instead of leaving the drawer open over it.
      sidebar.addEventListener('click', (e) => {
        if (!MQ.matches) return;
        if (e.target.closest('.bld-prim, #tool-rail button')) closeDrawer();
      });

      // Crossing the breakpoint (e.g. rotating a tablet, resizing a window)
      // shouldn't leave stale state from the other mode behind.
      MQ.addEventListener('change', () => {
        closeDrawer();
        sidebar.classList.remove('collapsed');
      });
    })();

    // ── Editable value read-outs ──────────────────────────────────────────
    // Every slider shows its value in a ".val" span (e.g. "10 mm"). Tapping that
    // number turns it into a little text field you can type an exact value into —
    // so there's no separate "Exact" box, and the displayed number IS the input.
    // On commit we set the slider and fire its 'input' event so all existing
    // behaviour (previews, state vars, labels) updates exactly as if dragged.
    (function(){
      // Map a .val span to its slider. Convention: slider id === val id minus "-val".
      // A couple of spans don't follow it exactly, so they're listed here.
      const SPECIAL = { 'paint-brush-val': 'paint-brush-size' };
      function sliderFor(span){
        if (!span.id) return null;
        const sid = SPECIAL[span.id] || span.id.replace(/-val$/, '');
        const el = document.getElementById(sid);
        return (el && el.type === 'range') ? el : null;
      }
      // Split "12.5 mm" / "100%" / "0°" into number + trailing unit.
      function parseValue(text){
        const m = String(text).trim().match(/^(-?\d*\.?\d+)\s*(.*)$/);
        return m ? { num: parseFloat(m[1]), unit: m[2] || '' } : { num: NaN, unit: '' };
      }

      function beginEdit(span){
        const slider = sliderFor(span);
        if (!slider || span.dataset.editing) return;
        const { num } = parseValue(span.textContent);
        span.dataset.editing = '1';
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.className = 'val-edit';
        input.value = isNaN(num) ? slider.value : String(num);
        span.textContent = '';
        span.classList.add('editing');
        span.appendChild(input);
        input.focus(); input.select();

        const commit = (apply) => {
          if (span._committing) return; span._committing = true;
          const raw = parseFloat(input.value);
          if (apply && !isNaN(raw)) {
            // clamp to the slider's range, respect its step for cleanliness
            const min = parseFloat(slider.min), max = parseFloat(slider.max);
            let v = raw;
            if (!isNaN(min)) v = Math.max(min, v);
            if (!isNaN(max)) v = Math.min(max, v);
            slider.value = v;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
          }
          // the slider's own input handler rewrites span.textContent; if it didn't
          // (value unchanged), restore a sensible label ourselves.
          if (span.dataset.editing) {
            if (span.contains(input)) span.removeChild(input);
            delete span.dataset.editing;
            span.classList.remove('editing');
            if (!span.textContent) {
              const u = parseValue(span.dataset.lastText || '').unit;
              span.textContent = slider.value + (u ? ' ' + u : '');
            }
          }
          span._committing = false;
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commit(true); }
          else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        });
        input.addEventListener('blur', () => commit(true));
        input.addEventListener('click', (e) => e.stopPropagation());
      }

      // Delegate: any tap on a .val span that has a slider starts editing.
      document.addEventListener('click', (e) => {
        const span = e.target.closest && e.target.closest('.param-label .val');
        if (span && sliderFor(span) && !span.dataset.editing) { e.preventDefault(); e.stopPropagation(); beginEdit(span); }
      });
      // Remember the last rendered text (to recover the unit if needed).
      const obs = new MutationObserver((muts) => {
        muts.forEach(m => { const t = m.target; if (t.classList && t.classList.contains('val') && !t.dataset.editing) t.dataset.lastText = t.textContent; });
      });
      document.querySelectorAll('.param-label .val').forEach(s => {
        s.dataset.lastText = s.textContent;
        obs.observe(s, { childList: true, characterData: true, subtree: true });
      });
    })();
  

    // ── Shared inline rename ─────────────────────────────────────────────────
    // The 2D studio already had an inline rename for layers, but it lived inside
    // the Paint scope so the 3D object browser couldn't use it. This is the same
    // behaviour exposed once for both: the label turns into a text field in
    // place, Enter commits, Escape cancels, clicking away saves.
    (function () {
      window.msInlineRename = function (labelEl, current, commit, onCancel) {
        if (!labelEl || labelEl.dataset.renaming) return;
        const host = labelEl.parentElement;
        if (!host) return;
        labelEl.dataset.renaming = '1';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ms-rename';
        input.value = current || '';
        const prev = labelEl.style.display;
        labelEl.style.display = 'none';
        host.insertBefore(input, labelEl.nextSibling);
        let done = false;
        const finish = (save) => {
          if (done) return; done = true;
          const v = input.value.trim();
          input.remove();
          labelEl.style.display = prev;
          delete labelEl.dataset.renaming;
          if (save && v && v !== current) commit(v);
          else if (onCancel) onCancel();
        };
        // The 3D workspace binds single-key shortcuts (space among them), and they
        // listen on keyup/keypress as well as keydown. Without blocking all three
        // typing a space would trigger a shortcut instead of reaching the field —
        // "Heel wedge" came out as "Heel".
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        };
        input.onkeyup = (e) => e.stopPropagation();
        input.onkeypress = (e) => e.stopPropagation();
        input.onblur = () => finish(true);
        // Stop a click inside the field from re-triggering the row underneath.
        input.onclick = (e) => e.stopPropagation();
        input.onpointerdown = (e) => e.stopPropagation();
        input.focus();
        input.select();
      };
    })();
  
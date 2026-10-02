
    // ── Keybindings ──────────────────────────────────────────────────────────
    // A single registry shared by both workspaces. Each action has a stable id, a
    // human label, and a default key. User overrides live in localStorage, so the
    // handlers below ask this registry what a key means rather than hard-coding it.
    (function () {
      const KEY_STORE = 'modelsmith_keys_v1';
      const DEFAULTS = {
        model: [
          { id: 'undo',        label: 'Undo',                 key: 'ctrl+z' },
          { id: 'redo',        label: 'Redo',                 key: 'ctrl+shift+z' },
          { id: 'delete',      label: 'Delete selection',     key: 'delete' },
          { id: 'duplicate',   label: 'Duplicate',            key: 'ctrl+d' },
          { id: 'selectAll',   label: 'Select all',           key: 'ctrl+a' },
          { id: 'deselect',    label: 'Deselect',             key: 'escape' },
          { id: 'frameSel',    label: 'Frame selection',      key: 'f' },
          { id: 'toolSelect',  label: 'Select tool',          key: 'v' },
          { id: 'toolSketch',  label: 'Sketch tool',          key: 'k' },
          { id: 'toolSlice',   label: 'Slice tool',           key: 'l' },
          { id: 'toolMold',    label: 'Mold / Cast tool',     key: 'o' },
          { id: 'toolMeasure', label: 'Measure tool',         key: 'u' },
          { id: 'gizmoMove',   label: 'Move gizmo',           key: 'g' },
          { id: 'gizmoRotate', label: 'Rotate gizmo',         key: 'r' },
          { id: 'gizmoScale',  label: 'Scale gizmo',          key: 't' },
          { id: 'lockRatio',   label: 'Lock ratio (hold)',    key: 'shift' },
          { id: 'viewFront',   label: 'Front view',           key: '1' },
          { id: 'viewRight',   label: 'Right view',           key: '3' },
          { id: 'viewTop',     label: 'Top view',             key: '7' },
          { id: 'viewIso',     label: '3/4 view',             key: '0' },
          { id: 'sectionView', label: 'Section view on/off',  key: 'x' },
          { id: 'palette',     label: 'Command search',       key: 'ctrl+k' }
        ],
        paint: [
          { id: 'undo',       label: 'Undo',                key: 'ctrl+z' },
          { id: 'redo',       label: 'Redo',                key: 'ctrl+shift+z' },
          { id: 'deselect',   label: 'Deselect',            key: 'ctrl+d' },
          { id: 'selectAll',  label: 'Select all',          key: 'ctrl+a' },
          { id: 'brush',      label: 'Brush',               key: 'b' },
          { id: 'pencil',     label: 'Pencil',              key: 'n' },
          { id: 'marker',     label: 'Marker',              key: 'm' },
          { id: 'airbrush',   label: 'Airbrush',            key: 'a' },
          { id: 'eraser',     label: 'Eraser',              key: 'e' },
          { id: 'fill',       label: 'Fill',                key: 'g' },
          { id: 'picker',     label: 'Colour picker',       key: 'i' },
          { id: 'selectTool', label: 'Rectangle select',    key: 'v' },
          { id: 'moveTool',   label: 'Move / pan',          key: 'h' },
          { id: 'text',       label: 'Text',                key: 't' },
          { id: 'magic',      label: 'Magic wand',          key: 'w' },
          { id: 'swapColors', label: 'Swap fg / bg colour', key: 'x' },
          { id: 'clone',      label: 'Clone stamp',         key: 'c' },
          { id: 'invertSel',  label: 'Invert selection',    key: 'ctrl+shift+i' },
          { id: 'palette',    label: 'Command search',      key: 'ctrl+k' }
        ]
      };
      let overrides = {};
      try { overrides = JSON.parse(localStorage.getItem(KEY_STORE) || '{}'); } catch (e) { overrides = {}; }

      // Normalise a keyboard event into the same shape as a stored binding.
      function eventKey(e) {
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('ctrl');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');
        let k = (e.key || '').toLowerCase();
        if (k === ' ') k = 'space';
        if (!['control','meta','shift','alt'].includes(k)) parts.push(k);
        return parts.join('+');
      }
      function get(scope, id) {
        const o = overrides[scope] && overrides[scope][id];
        if (o !== undefined) return o;
        const d = (DEFAULTS[scope] || []).find(a => a.id === id);
        return d ? d.key : null;
      }
      // True when the event matches the binding for this action.
      function is(scope, id, e) {
        const want = get(scope, id);
        if (!want) return false;
        return eventKey(e) === want;
      }
      function setBinding(scope, id, key) {
        if (!overrides[scope]) overrides[scope] = {};
        overrides[scope][id] = key;
        try { localStorage.setItem(KEY_STORE, JSON.stringify(overrides)); } catch (e) {}
      }
      function resetAll() {
        overrides = {};
        try { localStorage.removeItem(KEY_STORE); } catch (e) {}
      }
      // Which action (if any) already uses this key in the same workspace.
      function conflict(scope, id, key) {
        return (DEFAULTS[scope] || []).find(a => a.id !== id && get(scope, a.id) === key) || null;
      }
      window.Keys = { DEFAULTS, get, is, setBinding, resetAll, conflict, eventKey,
                      list: (scope) => (DEFAULTS[scope] || []).map(a => ({ ...a, key: get(scope, a.id) })) };
    })();
  
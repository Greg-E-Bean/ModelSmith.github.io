
    // ── Storage (IndexedDB) ──────────────────────────────────────────────────
    // localStorage caps out around 5MB across the WHOLE app — 3D sessions, paint
    // layers, brushes, fonts and PSD imports all shared that budget, and a dense
    // model would silently fail to autosave. IndexedDB gives orders of magnitude
    // more room and stores real binary/structured data rather than strings.
    //
    // Same privacy position as before: this is a database inside the browser on
    // this device. Nothing is transmitted, and only pages from this exact origin
    // can read it. It is NOT separately encrypted — the device's own disk
    // encryption is what protects it at rest.
    (function () {
      const DB_NAME = 'modelsmith';
      const DB_VERSION = 1;
      const STORE = 'kv';          // autosaves + preferences
      const SAVES = 'saves';       // named save states
      let dbp = null;

      function open() {
        if (dbp) return dbp;
        dbp = new Promise((resolve, reject) => {
          let req;
          try { req = indexedDB.open(DB_NAME, DB_VERSION); }
          catch (e) { return reject(e); }
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            if (!db.objectStoreNames.contains(SAVES)) {
              const s = db.createObjectStore(SAVES, { keyPath: 'id' });
              s.createIndex('savedAt', 'savedAt');
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return dbp;
      }
      const tx = (store, mode, fn) => open().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }));

      const Store = {
        available: (() => { try { return !!window.indexedDB; } catch (e) { return false; } })(),
        get:  (k)    => tx(STORE, 'readonly',  s => s.get(k)),
        set:  (k, v) => tx(STORE, 'readwrite', s => s.put(v, k)),
        del:  (k)    => tx(STORE, 'readwrite', s => s.delete(k)),

        // ── Named save states ────────────────────────────────────────────────
        // Undo history answers "what did I just do"; these answer "what did we
        // agree on last Tuesday". Each is a full snapshot with a name you choose.
        listSaves: () => tx(SAVES, 'readonly', s => s.getAll()).then(a =>
          (a || []).sort((x, y) => y.savedAt - x.savedAt)),
        getSave:   (id) => tx(SAVES, 'readonly',  s => s.get(id)),
        putSave:   (rec) => tx(SAVES, 'readwrite', s => s.put(rec)),
        delSave:   (id) => tx(SAVES, 'readwrite', s => s.delete(id)),

        // How much room we're actually using, when the browser will say.
        usage: async () => {
          try {
            if (navigator.storage && navigator.storage.estimate) {
              const e = await navigator.storage.estimate();
              return { used: e.usage || 0, quota: e.quota || 0 };
            }
          } catch (e) {}
          return null;
        },

        // Move anything already in localStorage across, once. The old copy is
        // left in place as a fallback until the new one is proven to load.
        migrate: async (keys) => {
          let moved = 0;
          for (const k of keys) {
            try {
              const existing = await Store.get(k);
              if (existing !== undefined) continue;         // already migrated
              const raw = localStorage.getItem(k);
              if (raw == null) continue;
              await Store.set(k, raw);
              moved++;
            } catch (e) { /* skip this key, keep going */ }
          }
          return moved;
        }
      };
      window.Store = Store;
    })();
  
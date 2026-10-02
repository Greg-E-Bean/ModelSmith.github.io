      // ═══════════════════════════════════════════════════════════════════════════
      //   3D TEXT — type a string, pick a font, get an extruded solid.
      // ═══════════════════════════════════════════════════════════════════════════
      const FONT_URLS = {
        helvetiker:      'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/helvetiker_regular.typeface.json',
        helvetiker_bold: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/helvetiker_bold.typeface.json',
        optimer:         'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/optimer_regular.typeface.json',
        optimer_bold:    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/optimer_bold.typeface.json',
        gentilis:        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/gentilis_regular.typeface.json',
        gentilis_bold:   'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/gentilis_bold.typeface.json'
      };
      const fontCache = {};
      const uploadedFonts = {};   // key → parsed THREE font from an uploaded TTF/OTF
      function loadFont3D(key) {
        return new Promise((resolve, reject) => {
          if (uploadedFonts[key]) return resolve(uploadedFonts[key]);
          if (fontCache[key]) return resolve(fontCache[key]);
          if (!window.THREE) return reject(new Error('3D not ready'));
          // Built-ins live in the page, so they work offline and on first load.
          if (window.MODELSMITH_FONTS && window.MODELSMITH_FONTS[key]) {
            const f = new THREE.Font(window.MODELSMITH_FONTS[key].data);
            fontCache[key] = f;
            return resolve(f);
          }
          // Anything else may still be a CDN font from an older session.
          if (!THREE.FontLoader || !FONT_URLS[key]) return reject(new Error('Unknown font'));
          new THREE.FontLoader().load(FONT_URLS[key], font => { fontCache[key] = font; resolve(font); },
            undefined, () => reject(new Error('Could not download that font')));
        });
      }

      // Convert an uploaded TTF/OTF (parsed by opentype.js) into a THREE.Font.
      //
      // We build the glyph table by asking the font's own cmap for each character we
      // care about (charToGlyph), rather than walking raw glyph indices and trusting
      // glyph.unicode — many fonts (especially OTF/CFF families like Avenir) don't
      // populate .unicode on every glyph, or order glyphs unexpectedly, which left
      // the table half-empty or mis-keyed.
      //
      // Two coordinate subtleties, both of which broke uploaded fonts before:
      //  1. opentype gives y-DOWN coordinates; three.js glyph space is y-UP, so we
      //     negate y.
      //  2. Negating y REVERSES each contour's winding — and three.js decides
      //     "solid outline vs hole" purely from winding (Font.toShapes() runs with
      //     isCCW undefined, so clockwise == solid). With winding inverted, outlines
      //     were read as holes and vice-versa, shredding every letter with a counter
      //     (e, s, o, a) while simple ones like T looked fine. Reversing each
      //     contour's point order after the flip restores the original winding.
      function opentypeToThreeFont(otFont, familyName) {
        const upm = otFont.unitsPerEm || 1000;
        const glyphs = {};

        // The characters worth converting: printable ASCII plus common Latin-1.
        const chars = [];
        for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
        for (let c = 160; c <= 255; c++) chars.push(String.fromCharCode(c));
        // plus a few typographic extras people paste in
        '‘’“”–—…•°±×÷€£'.split('').forEach(c => chars.push(c));

        const emitGlyph = (ch, g) => {
          if (!g) return;
          const path = g.getPath(0, 0, upm);   // size = upm keeps native font units

          // Split the command stream into contours so each can be reversed on its own.
          const contours = [];
          let cur = null;
          path.commands.forEach(cmd => {
            if (cmd.type === 'M') { if (cur && cur.length) contours.push(cur); cur = [cmd]; }
            else if (cmd.type === 'Z') { if (cur) { cur.push(cmd); contours.push(cur); cur = null; } }
            else if (cur) cur.push(cmd);
          });
          if (cur && cur.length) contours.push(cur);

          let o = '';
          contours.forEach(cmds => {
            const segs = [];
            let startX = 0, startY = 0;
            cmds.forEach(c => {
              if (c.type === 'M') { startX = c.x; startY = -c.y; }
              else if (c.type === 'L') segs.push({ t: 'l', x: c.x, y: -c.y });
              else if (c.type === 'Q') segs.push({ t: 'q', x1: c.x1, y1: -c.y1, x: c.x, y: -c.y });
              else if (c.type === 'C') segs.push({ t: 'b', x1: c.x1, y1: -c.y1, x2: c.x2, y2: -c.y2, x: c.x, y: -c.y });
            });
            if (!segs.length) return;

            // Reverse the contour: walk segments backwards so the last point becomes
            // the start and each curve's control points swap ends. This undoes the
            // winding flip caused by negating y.
            //
            // IMPORTANT — three.js's font path parser (Font.js) reads curve commands
            // ENDPOINT FIRST, then the control points:
            //   'q' → q <endX> <endY> <ctrlX> <ctrlY>
            //   'b' → b <endX> <endY> <ctrl1X> <ctrl1Y> <ctrl2X> <ctrl2Y>
            // (it parses cpx,cpy first then calls quadraticCurveTo(cp1, cp) /
            //  bezierCurveTo(cp1, cp2, cp)). Emitting controls first — the natural
            // reading order — silently corrupted every curve, which is why round
            // letters (e, o, s, c, a) shattered while straight ones (T, l, i) were
            // fine.
            const last = segs[segs.length - 1];
            o += `m ${last.x} ${last.y} `;
            for (let s = segs.length - 1; s >= 0; s--) {
              const seg = segs[s];
              // where this segment starts from, i.e. where the REVERSED curve ends
              const prev = s > 0 ? segs[s - 1] : { x: startX, y: startY };
              if (seg.t === 'l') {
                o += `l ${prev.x} ${prev.y} `;
              } else if (seg.t === 'q') {
                // reversed quad: end at prev, single control unchanged
                o += `q ${prev.x} ${prev.y} ${seg.x1} ${seg.y1} `;
              } else if (seg.t === 'b') {
                // reversed cubic: end at prev, controls swapped (x2 becomes first)
                o += `b ${prev.x} ${prev.y} ${seg.x2} ${seg.y2} ${seg.x1} ${seg.y1} `;
              }
            }
            o += 'z ';
          });

          const ha = (g.advanceWidth != null) ? g.advanceWidth : upm * 0.5;
          glyphs[ch] = { ha, x_min: 0, x_max: ha, o: o.trim() };
        };

        chars.forEach(ch => {
          let g = null;
          try { g = otFont.charToGlyph(ch); } catch (e) { g = null; }
          // charToGlyph returns .notdef (index 0) for unmapped chars — skip those,
          // except for space which legitimately has no outline.
          if (!g) return;
          if (g.index === 0 && ch !== ' ') return;
          emitGlyph(ch, g);
        });

        // Space often has no contours; make sure it still advances the cursor.
        if (!glyphs[' ']) {
          const sp = (() => { try { return otFont.charToGlyph(' '); } catch(e) { return null; } })();
          const ha = (sp && sp.advanceWidth) ? sp.advanceWidth : upm * 0.3;
          glyphs[' '] = { ha, x_min: 0, x_max: ha, o: '' };
        }

        const data = {
          glyphs,
          familyName,
          ascender: (otFont.ascender ?? upm * 0.8),
          descender: (otFont.descender ?? -upm * 0.2),
          underlinePosition: -100,
          underlineThickness: 50,
          boundingBox: { yMin: -upm*0.2, xMin: -upm*0.1, yMax: upm*0.8, xMax: upm },
          resolution: upm,
          original_font_information: { font_family_name: familyName }
        };
        return new THREE.Font(data);
      }

      // Identify a font file from its first four bytes rather than its extension —
      // extensions are often wrong or missing, and the real reason an upload fails
      // is almost always the container format, which we can name precisely.
      function sniffFontFormat(buf) {
        const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
        const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
        const n = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
        if (tag === 'wOFF') return 'woff';
        if (tag === 'wOF2') return 'woff2';
        if (tag === 'ttcf') return 'ttc';
        if (tag === 'OTTO') return 'otf';
        if (tag === 'true' || tag === 'typ1') return 'ttf';
        if (n === 0x00010000) return 'ttf';
        return 'unknown';
      }

      function handleFontUpload(file) {
        if (!window.opentype) { banner("⚠️ The font parser isn't available — reload the app and try again."); return; }
        banner("Reading font…");
        const reader = new FileReader();
        reader.onload = () => {
          try {
            // Check the container first so we can give a useful message instead of
            // a generic parse failure.
            const fmt = sniffFontFormat(reader.result);
            if (fmt === 'woff' || fmt === 'woff2') {
              banner("⚠️ That's a " + fmt.toUpperCase() + " web font, which can't be read directly. Convert it to .ttf or .otf and try again.");
              return;
            }
            if (fmt === 'ttc') {
              banner("⚠️ That's a font collection (.ttc) holding several fonts. Extract the one you want as a .ttf and try again.");
              return;
            }
            const otFont = opentype.parse(reader.result);
            const family = (otFont.names && otFont.names.fontFamily && (otFont.names.fontFamily.en || Object.values(otFont.names.fontFamily)[0])) || file.name.replace(/\.[^.]+$/i, '');
            const key = 'user_' + family.replace(/\s+/g, '_') + '_' + Date.now();
            const threeFont = opentypeToThreeFont(otFont, family);
            uploadedFonts[key] = threeFont;

            // Sanity check: if the font produced no usable glyphs, say so plainly
            // instead of silently generating broken text later.
            const glyphCount = Object.keys(threeFont.data.glyphs || {}).length;
            if (glyphCount < 10) {
              banner("⚠️ Only " + glyphCount + " letters could be read from that font — it may be an icon font or use an unusual encoding. Try a standard .ttf.");
              return;
            }

            // Remember it so it's still here next time the app opens.
            saveUploadedFont(key, family, threeFont);

            addFontOption(key, family, true);
            // Offer it in the 2D studio too — the store is shared, so a font
            // uploaded on either side should be usable on both.
            try {
              const psel = document.getElementById('ps-font');
              if (psel && !psel.querySelector('option[value="' + key + '"]')) {
                const o2 = document.createElement('option');
                o2.value = key; o2.textContent = family + ' (uploaded)';
                psel.appendChild(o2);
              }
            } catch (e) { /* 2D not ready yet; it reads the store on init anyway */ }
            banner(`Font "${family}" ready — available in both 3D and 2D.`);
          } catch (err) {
            console.error('Font upload failed:', err);
            banner("⚠️ Couldn't read that font: " + ((err && err.message) || 'unrecognised format') + ". A standard .ttf usually works best.");
          }
        };
        reader.onerror = () => banner("⚠️ Couldn't read that font file.");
        reader.readAsArrayBuffer(file);
      }


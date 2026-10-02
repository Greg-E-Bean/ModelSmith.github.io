      // ── Uploaded font persistence ────────────────────────────────────────────
      // We store the CONVERTED three.js font data (not the raw file) — it's compact
      // JSON and skips re-parsing on load. Kept in localStorage so uploads survive
      // closing the app.
      // Bumped to v2. Fonts uploaded before the glyph-conversion fixes were cached
      // in their broken form, so they stayed shattered forever even after the code
      // was corrected — re-uploading was the only cure, and nothing said so. A new
      // key retires those stale conversions; the old entry is cleaned up and the
      // user is told to re-add the font once.
      const FONT_STORE_KEY = 'modelsmith_fonts_v2';


      function addFontOption(key, family, select) {
        const sel = document.getElementById('text3d-font');
        if (!sel || sel.querySelector(`option[value="${key}"]`)) return;
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = family + ' (uploaded)';
        sel.appendChild(opt);
        if (select) sel.value = key;
      }

      function loadFontStore() {
        try { const raw = localStorage.getItem(FONT_STORE_KEY); return raw ? JSON.parse(raw) : {}; }
        catch (e) { return {}; }
      }

      function saveUploadedFont(key, family, threeFont) {
        try {
          const store = loadFontStore();
          store[key] = { family, data: threeFont.data };
          const json = JSON.stringify(store);
          // localStorage is ~5MB; a big font can be over 1MB of JSON. If we'd blow
          // the budget, drop the oldest entries until it fits.
          if (json.length > 4.5 * 1024 * 1024) {
            const keys = Object.keys(store);
            while (keys.length > 1 && JSON.stringify(store).length > 4.5 * 1024 * 1024) {
              delete store[keys.shift()];
            }
          }
          localStorage.setItem(FONT_STORE_KEY, JSON.stringify(store));
        } catch (e) {
          banner("Font loaded for this session (too large to remember permanently).");
        }
      }

      // Rebuild previously uploaded fonts on startup.
      function restoreUploadedFonts() {
        const store = loadFontStore();
        Object.keys(store).forEach(key => {
          try {
            const rec = store[key];
            if (!rec || !rec.data) return;
            uploadedFonts[key] = new THREE.Font(rec.data);
            addFontOption(key, rec.family, false);
          } catch (e) { /* skip a corrupt entry */ }
        });
      }

      // ═══════════════════════════════════════════════════════════════════════════
      //   SCREW THREAD — build a helical thread as a solid. The outer surface radius
      //   varies as a triangular (ISO-style) wave along the helix, wrapped around a
      //   core. Generated directly as a vertex grid so it stays watertight and
      //   CSG-ready (e.g. to cut an internal thread into a part).
      // ═══════════════════════════════════════════════════════════════════════════
      // ── Preview generators for the builder dialogs ─────────────────────────
      // Each returns geometry built from the CURRENT panel settings using the same
      // code path the Add button uses, so the preview cannot drift from the real
      // result. Kept deliberately cheap: previews use coarser detail than the
      // final build, since they re-run on every slider move.
      window.MS_PREVIEW = {
        thread: () => {
          const g = (id, d) => { const e = document.getElementById(id); return e ? parseFloat(e.value) : d; };
          const t = document.getElementById('thread-type');
          const internal = t ? t.value === 'internal' : false;
          const hand = document.getElementById('thread-hand');
          const handedness = hand ? (hand.querySelector('.active') ? hand.querySelector('.active').dataset.hand : 'right') : 'right';
          const pitch = g('thread-pitch', 1.5), length = g('thread-len', 20);
          if (pitch <= 0 || pitch >= length) return null;
          return buildThreadGeometry({ diameter: g('thread-dia', 10), pitch, length, internal, handedness });
        },
        text3d: () => {
          const txt = (document.getElementById('text3d-input') || {}).value || '';
          if (!txt.trim()) return null;
          const fontKey = (document.getElementById('text3d-font') || {}).value;
          const font = fontCache && fontCache[fontKey];
          // Fonts load asynchronously. Kick the load off and ask the dialog to
          // re-preview once it lands, otherwise the first preview is always empty
          // and never recovers.
          if (!font) {
            loadFont3D(fontKey).then(() => {
              if (window.MS_PREVIEW_REFRESH) window.MS_PREVIEW_REFRESH();
            }).catch(() => {});
            return null;
          }
          const size = parseFloat((document.getElementById('text3d-size') || {}).value) || 10;
          const depth = parseFloat((document.getElementById('text3d-depth') || {}).value) || 4;
          const warpEl = document.getElementById('text3d-warp');
          const amtEl = document.getElementById('text3d-warp-amt');
          const warp = warpEl ? warpEl.value : 'none';
          const amount = (parseFloat(amtEl ? amtEl.value : 40) || 40) / 100;
          let geo = (warp && warp !== 'none')
            ? buildWarpedTextGeometry(font, txt, size, depth, warp, amount) : null;
          if (!geo) {
            const segs = Math.max(6, Math.min(12, Math.round(size * 0.6)));   // coarser for preview
            geo = new THREE.ExtrudeGeometry(textShapes(font, txt, size, segs), {
              depth, bevelEnabled: false, curveSegments: segs, steps: 1 });
            geo.rotateX(Math.PI / 2);
          }
          geo.center();
          return geo;
        },
        img3d: () => {
          // Only meaningful once an image has been dropped in.
          if (!window._img3dLastImage) return null;
          const el = (id, d) => { const e = document.getElementById(id); return e ? parseFloat(e.value) : d; };
          const mode = document.querySelector('#img3d-mode .toggle-btn.active');
          if (!mode || mode.dataset.mode !== 'relief') return null;
          return buildReliefGeometry(window._img3dLastImage, {
            footprint: el('img3d-size', 60), relief: el('img3d-relief', 6),
            base: el('img3d-base', 2),
            res: Math.min(80, parseInt(el('img3d-res', 160), 10)),   // coarse preview
            smooth: parseInt(el('img3d-rsmooth', 1), 10) || 0,
            flatten: parseInt(el('img3d-flatten', 0), 10) || 0,
            invert: (document.getElementById('img3d-invert') || {}).checked || false
          });
        }
      };

      function buildThreadGeometry(opts) {
        const {
          diameter = 10,     // outer (major) diameter
          pitch = 1.5,       // distance between adjacent crests
          length = 20,       // axial length
          internal = false,  // internal (nut) vs external (bolt)
          handedness = 'right'
        } = opts;

        // Internal threads are only ever used as a CSG cutting tool (Booleans →
        // Cut). The boolean engine here is a simple BSP-tree CSG, which gets
        // unreliable — producing a torn, self-intersecting mess instead of a
        // clean hole — when one operand is a fine, high-poly helix. External
        // threads never go through a boolean (used standalone as a rod), so
        // they can stay at full smoothness; internal ones are deliberately
        // coarser to give the boolean engine a fighting chance.
        const radialSegments = opts.radialSegments || (internal ? 18 : 32);
        const stepsPerPitch = internal ? 6 : 12;

        const majorR = diameter / 2;
        const threadDepth = Math.min(pitch * 0.6134, majorR * 0.6); // ISO metric-ish depth
        const minorR = Math.max(0.4, majorR - threadDepth);
        const dir = handedness === 'left' ? -1 : 1;
        const totalSteps = Math.max(6, Math.round((length / pitch) * stepsPerPitch));

        const positions = [];
        const V = (x,y,z) => new THREE.Vector3(x,y,z);
        const addTri = (a, b, c) => { positions.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z); };

        // radius as a triangular wave within one pitch (crest at middle, root at ends)
        const profileRadius = (phaseFrac) => {
          const tri = 1 - Math.abs(((phaseFrac % 1) + 1) % 1 * 2 - 1);
          return minorR + tri * (majorR - minorR);
        };

        // A solid, watertight thread: just the outer threaded wall plus a flat
        // disc cap at each end running straight to the axis. (An earlier version
        // also built a separate full cylindrical "core" entirely inside this
        // shell for extra safety — but a second, fully-enclosed surface nested
        // inside the first is exactly what breaks inside/outside solid
        // classification in the boolean engine: a ray through the centre crosses
        // two separate closed boundaries instead of one, so the very middle of
        // the thread was coming back classified as NOT solid. One shell, wound
        // consistently outward, is both simpler and correct.
        const grid = [];
        for (let i = 0; i <= totalSteps; i++) {
          const z = (i / totalSteps) * length;
          const row = [];
          for (let j = 0; j <= radialSegments; j++) {
            const a = (j / radialSegments) * Math.PI * 2;
            const localPhase = (z / pitch) + dir * (j / radialSegments);
            const r = profileRadius(localPhase);
            row.push(V(Math.cos(a) * r, Math.sin(a) * r, z));
          }
          grid.push(row);
        }

        // outer threaded surface (normals point outward)
        for (let i = 0; i < totalSteps; i++) {
          for (let j = 0; j < radialSegments; j++) {
            const a = grid[i][j], b = grid[i][j+1], c = grid[i+1][j+1], d = grid[i+1][j];
            addTri(a, b, c); addTri(a, c, d);
          }
        }

        // Flat disc caps, fanned straight from the axis out to the thread's own
        // profile ring at each end — this alone closes the solid.
        const discAt = (i, z, faceUp) => {
          const centre = V(0, 0, z);
          for (let j = 0; j < radialSegments; j++) {
            const p = grid[i][j], q = grid[i][j+1];
            if (faceUp) addTri(centre, p, q); else addTri(centre, q, p);
          }
        };
        discAt(totalSteps, length, true);
        discAt(0, 0, false);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.computeVertexNormals();
        geo.center();
        return geo;
      }

      function createScrewThread() {
        const diameter = parseFloat(document.getElementById('thread-dia').value) || 10;
        const pitch = parseFloat(document.getElementById('thread-pitch').value) || 1.5;
        const length = parseFloat(document.getElementById('thread-len').value) || 20;
        const internal = (document.querySelector('#thread-type .toggle-btn.active') || {}).dataset?.tt === 'internal';
        const handedness = (document.querySelector('#thread-hand .toggle-btn.active') || {}).dataset?.th || 'right';

        if (pitch >= length) return banner("⚠️ Pitch must be smaller than the length.");
        if (internal && (length / pitch) > 40) {
          banner("⚠️ That's a lot of turns for one cut — a shorter length or coarser pitch cuts more reliably. Building anyway…");
        } else {
          banner("Building thread…");
        }
        setTimeout(() => {
          try {
            const geo = buildThreadGeometry({ diameter, pitch, length, internal, handedness });
            const clean = makeGeometryCSGReady(geo);
            const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }));
            mesh.geometry.computeBoundingBox();
            const h = (mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z) / 2;
            mesh.position.z = h + 0.01;
            mesh.castShadow = true; mesh.receiveShadow = true;
            scene.add(mesh); objects.push(mesh);
            selected.forEach(o => setEmissive(o, 0x000000));
            selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
            saveHistory(); updateStatus(); updateFloatingHUD();
            banner(`Created ${internal ? 'internal' : 'external'} thread — ⌀${diameter}mm, ${pitch}mm pitch, ${length}mm long.`);
          } catch (err) {
            console.error(err); banner("⚠️ Couldn't build that thread — try different settings.");
          }
        }, 30);
      }

      // ── Glyph hole detection ────────────────────────────────────────────────
      // three.js decides which contours of a glyph are holes purely from their
      // winding direction. Fonts do not agree on that convention, and several of
      // the built-in ones wind a counter the same way as its outer ring — so the
      // hole in e, d, a, o, etc. came back as a SEPARATE SOLID sitting inside the
      // letter, which is the shattered, filled-in look those glyphs had.
      //
      // Winding is unreliable, so this ignores it and works out nesting
      // geometrically: a contour enclosed by an odd number of other contours is a
      // hole, by the standard even-odd rule. That holds no matter how the font was
      // authored, which is why this fixes every font rather than one at a time.
      function pointInContour(pt, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
          if (((yi > pt.y) !== (yj > pt.y)) &&
              (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
        }
        return inside;
      }
      function renestGlyphShapes(shapes, divisions) {
        // Flatten every contour the font gave us, however it chose to group them.
        // `divisions` sets how finely curved segments are sampled — this is what
        // actually controls how smooth round letters look.
        const d = Math.max(4, divisions || 12);
        const contours = [];
        shapes.forEach(s => {
          try { contours.push(s.extractPoints(d).shape); } catch (e) { return; }
          (s.holes || []).forEach(h => { try { contours.push(h.getPoints(d)); } catch (e) {} });
        });
        const items = contours
          .filter(p => p && p.length > 2)
          .map(p => ({ pts: p, area: Math.abs(THREE.ShapeUtils.area(p)) }))
          .filter(c => c.area > 1e-9)
          .sort((a, b) => b.area - a.area);      // biggest first, so parents precede children
        if (!items.length) return shapes;

        // Depth = how many other contours enclose this one.
        items.forEach((c, i) => {
          c.depth = 0; c.parent = null;
          const probe = c.pts[0];
          for (let j = 0; j < items.length; j++) {
            if (j === i) continue;
            if (items[j].area <= c.area) continue;          // only larger can contain
            if (pointInContour(probe, items[j].pts)) {
              c.depth++;
              // nearest (smallest) enclosing contour is the real parent
              if (!c.parent || items[j].area < c.parent.area) c.parent = items[j];
            }
          }
        });

        // Normalise winding before building the shapes.
        //
        // Detecting holes geometrically (above) says WHICH contours are holes, but
        // ExtrudeGeometry still relies on winding direction to build the side walls
        // facing the right way: an outer ring must run counter-clockwise and a hole
        // clockwise. Fonts don't guarantee that, and after re-nesting we were
        // handing it holes wound the same way as their outer. The extrusion then
        // came out with inverted faces around every counter, so the mesh was not a
        // closed solid — which is why cutting text into an object engraved only the
        // outlines instead of removing the letter bodies.
        const wind = (pts, wantCCW) => {
          const ccw = THREE.ShapeUtils.area(pts) > 0;
          return ccw === wantCCW ? pts : pts.slice().reverse();
        };
        const out = [];
        items.forEach(c => {
          if (c.depth % 2 === 0) {                          // even → a solid outline
            c.shape = new THREE.Shape(wind(c.pts, true));   // outer: counter-clockwise
            out.push(c.shape);
          }
        });
        items.forEach(c => {
          if (c.depth % 2 === 1 && c.parent && c.parent.shape) {   // odd → a hole
            c.parent.shape.holes.push(new THREE.Path(wind(c.pts, false)));  // hole: clockwise
          }
        });
        return out.length ? out : shapes;
      }
      // Build glyph shapes with holes resolved properly.
      function textShapes(font, text, size, divisions) {
        const raw = font.generateShapes(text, size);
        try { return renestGlyphShapes(raw, divisions); } catch (e) { return raw; }
      }

      // Warp a 3D glyph the same way the 2D studio warps its text. `t` is how far
      // along the string this glyph sits (0..1). The transform is applied to the
      // whole glyph rather than its individual points, so outlines stay crisp and
      // the extrusion never self-intersects.
      function warp3DGlyph(geo, mode, t, amount, size, runWidth) {
        if (!mode || mode === 'none' || !amount) return;
        const c = (t - 0.5) * 2;            // -1 at the left, +1 at the right
        const m = new THREE.Matrix4();
        switch (mode) {
          case 'arch': case 'arc': {
            const depth = size * 1.6 * amount;
            const dir = mode === 'arch' ? 1 : -1;
            geo.translate(0, 0, dir * depth * (1 - c * c));
            // Lean each glyph into the curve so it follows the tangent.
            geo.rotateY(dir * c * amount * 0.9);
            break;
          }
          // Same centring fix as the 2D side: scale about the glyph's middle so the
          // letters swell (or pinch) evenly top and bottom, rather than only rising.
          case 'bulge': {
            const s = 1 + (1 - c * c) * amount;
            const mid = size * 0.35;
            geo.translate(0, 0, -mid);
            m.makeScale(1, 1, s); geo.applyMatrix4(m);
            geo.translate(0, 0, mid);
            break;
          }
          case 'waist': {
            const s = Math.max(0.15, 1 - (1 - c * c) * amount * 0.75);
            const mid = size * 0.35;
            geo.translate(0, 0, -mid);
            m.makeScale(1, 1, s); geo.applyMatrix4(m);
            geo.translate(0, 0, mid);
            break;
          }
          case 'skew':
            // Shear the height axis along the run direction.
            m.set(1, 0, 0, 0,  0, 1, 0, 0,  amount * 0.9, 0, 1, 0,  0, 0, 0, 1);
            geo.applyMatrix4(m);
            break;
          case 'rise':
            geo.translate(0, 0, c * size * amount);
            break;
          case 'wave':
            geo.translate(0, 0, Math.sin(t * Math.PI * 2) * size * 0.55 * amount);
            geo.rotateY(-Math.cos(t * Math.PI * 2) * amount * 0.5);
            break;
          case 'fan':
            // Splay the run outward like a rainbow — each glyph rotates about the
            // run's centre rather than its own.
            geo.rotateZ(-c * amount * 0.8);
            break;
        }
      }

      // Build the text as ONE geometry per glyph so each can be warped
      // independently, then merge. Without this a warp would have to deform the
      // whole string as a single mesh, which distorts the letterforms themselves.
      function buildWarpedTextGeometry(font, text, size, depth, warp, amount) {
        const shapes = [];
        const scale = size / (font.data.resolution || 1000);
        // Measure the run first so each glyph knows how far along it sits.
        let total = 0;
        for (const ch of text) {
          const g = font.data.glyphs[ch];
          total += (g && g.ha ? g.ha : (font.data.resolution || 1000) * 0.5) * scale;
        }
        if (total <= 0) total = 1;

        const parts = [];
        let cursor = 0;
        for (const ch of text) {
          const g = font.data.glyphs[ch];
          const adv = (g && g.ha ? g.ha : (font.data.resolution || 1000) * 0.5) * scale;
          if (g && g.o && ch.trim()) {
            const segs = Math.max(8, Math.min(24, Math.round(size * 0.9)));
            const geo = new THREE.ExtrudeGeometry(textShapes(font, ch, size, segs), {
              depth, bevelEnabled: false, curveSegments: segs, steps: 1
            });
            geo.rotateX(Math.PI / 2);
            geo.translate(cursor, 0, 0);
            warp3DGlyph(geo, warp, (cursor + adv / 2) / total, amount, size, total);
            parts.push(geo);
          }
          cursor += adv;
        }
        if (!parts.length) return null;
        // Merge into a single buffer geometry, carrying the NORMALS across as well.
        // The warp transforms are applied with applyMatrix4/translate/rotate, all of
        // which update normals correctly — so the per-glyph normals are still right
        // and keep curved letters smoothly shaded. Previously only positions were
        // merged and the normals were recomputed flat, which faceted every curve.
        let totalVerts = 0;
        parts.forEach(p => { totalVerts += p.attributes.position.count; });
        const pos = new Float32Array(totalVerts * 3);
        const nrm = new Float32Array(totalVerts * 3);
        let off = 0, hasNormals = true;
        parts.forEach(p => {
          const src = p.index ? p.toNonIndexed() : p;
          const a = src.attributes.position;
          const n = src.attributes.normal;
          if (!n) hasNormals = false;
          for (let i = 0; i < a.count; i++) {
            pos[off] = a.getX(i); pos[off+1] = a.getY(i); pos[off+2] = a.getZ(i);
            if (n) { nrm[off] = n.getX(i); nrm[off+1] = n.getY(i); nrm[off+2] = n.getZ(i); }
            off += 3;
          }
        });
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, off), 3));
        if (hasNormals) out.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, off), 3));
        else out.computeVertexNormals();
        parts.forEach(p => p.dispose());
        return out;
      }

      async function generate3DText() {
        const text = (document.getElementById('text3d-input').value || '').trim();
        if (!text) return banner("⚠️ Type some text first.");
        const fontKey = document.getElementById('text3d-font').value;
        const size = parseFloat(document.getElementById('text3d-size').value) || 10;
        const depth = parseFloat(document.getElementById('text3d-depth').value) || 4;
        const warpEl = document.getElementById('text3d-warp');
        const amtEl = document.getElementById('text3d-warp-amt');
        const warp = warpEl ? warpEl.value : 'none';
        const amount = (parseFloat(amtEl ? amtEl.value : 40) || 40) / 100;

        banner("Building 3D text…");
        try {
          const font = await loadFont3D(fontKey);
          let geo = (warp && warp !== 'none')
            ? buildWarpedTextGeometry(font, text, size, depth, warp, amount)
            : null;
          if (!geo) {
            // curveSegments controls how finely each curved part of a glyph is
            // approximated. It was 6, which is very coarse — the bowls of letters
            // like e, a, c and d came out visibly polygonal, and the flat facets
            // caught the light unevenly. Scale it with the text size so small text
            // stays cheap and large text prints smooth.
            const segs = Math.max(8, Math.min(24, Math.round(size * 0.9)));
            // Extrude our own hole-corrected shapes rather than using TextGeometry,
            // which would re-derive the holes from winding and reintroduce the bug.
            geo = new THREE.ExtrudeGeometry(textShapes(font, text, size, segs), {
              depth, bevelEnabled: false, curveSegments: segs, steps: 1
            });
            geo.rotateX(Math.PI / 2);
          }
          // TextGeometry's native letter-height axis is Y; the builders above have
          // already stood it up so letter height runs along Z, the app's vertical.
          geo.computeBoundingBox();
          const center = new THREE.Vector3();
          geo.boundingBox.getCenter(center);
          geo.translate(-center.x, -center.y, -center.z);

          // Deliberately NOT makeGeometryCSGReady() here. That helper recomputes
          // vertex normals, and on a non-indexed soup that forces flat shading —
          // which turns every curve segment of a glyph into a visible facet and is
          // why 3D text looked chunky and unevenly lit. TextGeometry already
          // supplies correct normals (smooth around curves, hard at the extrusion
          // edges), so they're kept. Degenerate triangles are dropped instead,
          // which is the part that actually matters for later booleans.
          const clean = dropDegenerateTriangles(geo);
          const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.3 }));
          mesh.position.z = 12; mesh.castShadow = true; mesh.receiveShadow = true;
          scene.add(mesh); objects.push(mesh);
          selected.forEach(o => setEmissive(o, 0x000000));
          selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
          saveHistory(); updateStatus(); updateFloatingHUD();
          banner(`Added 3D text "${text}".`);
        } catch (err) {
          console.error(err);
          banner("⚠️ Couldn't load that font (needs an internet connection) — try again or pick another font.");
        }
      }


      // ══ Moulds ══════════════════════════════════════════════════════════════
      // Two ways to turn a model into something you can cast copies from. Both work
      // in the app's Z-up world (Z is height, the build plate is the XY plane). The
      // builders these replace assumed Y was up, so their "pour funnel on top" came
      // out of the model's side and the casting box's "floor" was a side wall.
      //
      //  • Print-and-pour mould (buildPourMould): a printed block with the model's
      //    shape left as a HOLLOW inside it, a pour funnel and an air vent running
      //    from the top of the block down into the hollow, split in two with
      //    alignment pegs. Clamp the halves together and pour resin, plaster, wax…
      //    straight into the printed plastic.
      //
      //  • Silicone mould box (buildSiliconeBox): an open-top box, plus a lid that
      //    holds the model suspended inside the box by its pour funnel, leaving an
      //    even gap all round — underneath too — to fill with silicone through the
      //    lid's pour hole. Once cured, lift the lid away (the funnel leaves a pour
      //    channel in the rubber), take the block out, cut it open to free the model,
      //    and cast copies in the rubber.
      //
      // Both lay their parts out ready to print: on the plate, in the orientation
      // that needs no supports for the mould itself.

      // A solid box spanning the given world-space bounds.
      const _mBox = (minX, minY, minZ, maxX, maxY, maxZ) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ), new THREE.MeshStandardMaterial());
        m.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        m.updateMatrixWorld(true);
        return m;
      };
      // A vertical (Z) cone or cylinder from z0 at radius r0 up to z1 at radius r1.
      const _mCone = (x, y, z0, z1, r0, r1, seg) => {
        const g = new THREE.CylinderGeometry(r1, r0, Math.max(0.1, z1 - z0), seg || 32);
        g.rotateX(Math.PI / 2);                         // its axis was Y; make it Z (top stays on top)
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
        m.position.set(x, y, (z0 + z1) / 2);
        m.updateMatrixWorld(true);
        return m;
      };
      // An alignment peg: wide end on the parting plane at p, tapering along +axis
      // into the other half. Truncated rather than pointed — a true apex is a
      // degenerate vertex that collapses the BSP solver (and prints as a needle).
      const _mPeg = (axis, p, r, len) => {
        const g = new THREE.CylinderGeometry(r * 0.55, r, len, 20);
        if (axis === 'x') g.rotateZ(-Math.PI / 2);      // +Y -> +X
        else if (axis === 'z') g.rotateX(Math.PI / 2);  // +Y -> +Z
        g.translate(axis === 'x' ? len / 2 : 0, axis === 'y' ? len / 2 : 0, axis === 'z' ? len / 2 : 0);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
        m.position.copy(p);
        m.updateMatrixWorld(true);
        return m;
      };
      const _mWorldGeo = (mesh) => {
        mesh.updateMatrixWorld(true);
        const g = mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        g.computeBoundingBox();
        return g;
      };
      // Where the pour funnel should meet the model: its highest point, preferring
      // the one nearest the middle when the top is flat or level — so the funnel
      // lands on material rather than dropping through a hole (a ring, a handle).
      function _mTopPoint(geo, near) {
        const p = geo.attributes.position, bb = geo.boundingBox;
        const tol = Math.max(0.3, (bb.max.z - bb.min.z) * 0.02);
        let best = null, bestD = Infinity;
        for (let i = 0; i < p.count; i++) {
          const z = p.getZ(i);
          if (z < bb.max.z - tol) continue;
          const x = p.getX(i), y = p.getY(i);
          const d = Math.hypot(x - near.x, y - near.y);
          if (d < bestD) { bestD = d; best = { x, y, z }; }
        }
        return best;
      }
      // Highest point of the model at least `r` away (in plan) from (x, y) — where
      // air collects that the pour funnel can't release, so that's where the vent goes.
      function _mHighestAway(geo, x, y, r) {
        const p = geo.attributes.position;
        let best = null;
        for (let i = 0; i < p.count; i++) {
          const px = p.getX(i), py = p.getY(i);
          if (Math.hypot(px - x, py - y) < r) continue;
          const z = p.getZ(i);
          if (!best || z > best.z) best = { x: px, y: py, z };
        }
        return best;
      }
      // How deep the funnel's foot must sink below the top point, and how wide it
      // can be there. On a pointed or domed top the model is only a pin-prick wide
      // just under its highest point, so a shallow funnel meets it through a pin-hole:
      // the casting can't fill, and a pattern hung from the funnel snaps off. Sink
      // until the model (near the top point) is wide enough for the foot, and never
      // make the foot wider than the model there, so the sprue stub stays small.
      function _mFunnelFoot(geo, top, rWant, maxDepth) {
        const p = geo.attributes.position;
        const reach = rWant * 3;
        const need = Math.min(rWant, 2.5);
        const widthTo = (d) => {
          let w = 0;
          for (let i = 0; i < p.count; i++) {
            const z = p.getZ(i);
            if (z < top.z - d) continue;
            const h = Math.hypot(p.getX(i) - top.x, p.getY(i) - top.y);
            if (h <= reach && h > w) w = h;
          }
          return w;
        };
        let d = Math.min(1.5, maxDepth), w = widthTo(d);
        for (const step of [2.5, 4, 6, 8, 11, 15, 20, 26]) {
          if (w >= need || step > maxDepth) break;
          d = step; w = widthTo(d);
        }
        if (w < need && maxDepth > d) { d = maxDepth; w = widthTo(d); }
        return { depth: d, r: Math.max(1, Math.min(rWant, w * 0.9)) };
      }

      const _mVolume = (csg) => {
        const p = window.CSGEngine.toGeometry(csg).attributes.position;
        if (!p || p.count < 12) return 0;
        let v = 0;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < p.count; i += 3) {
          a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
          v += a.dot(b.cross(c)) / 6;
        }
        return Math.abs(v);
      };
      const _mTris = (csg) => window.CSGEngine.toGeometry(csg).attributes.position.count / 3;
      // Try a CSG step; keep the result only if it didn't collapse.
      const _mTry = (base, fn) => {
        try { const r = fn(base); return (r && r.polygons.length > 12) ? r : base; } catch (e) { return base; }
      };

      // The BSP boolean engine is numerically fragile: whether it survives depends
      // on exact coplanar coincidences between the block, the cavity and the funnel.
      // Nudging dimensions by a fraction of a millimetre breaks the coincidence
      // without meaningfully changing the mould, so a retry almost always succeeds.
      function _mRetry(build) {
        const jitters = [0, 0.37, -0.29, 0.63, -0.51, 0.91];
        let lastErr = null;
        for (const j of jitters) {
          try { return build(j); } catch (err) { lastErr = err; }
        }
        throw lastErr || new Error('the mould could not be built.');
      }

      // ── Print-and-pour mould ──────────────────────────────────────────────
      // o: { wall, sprue, vent, split: 'x' | 'y' | 'z', pegR, pegLenMul, pegClear }
      function buildPourMould(mesh, o) {
        const CSG = window.CSGEngine;
        const geo = _mWorldGeo(mesh);
        const bb = geo.boundingBox;
        const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
        if (!(size.x > 0 && size.y > 0 && size.z > 0)) throw new Error('that object has no volume to cast.');

        const w = o.wall;
        const B = { min: [bb.min.x - w, bb.min.y - w, bb.min.z - w], max: [bb.max.x + w, bb.max.y + w, bb.max.z + w] };
        // Everything that has to be hollowed out — the model, the pour funnel and the
        // air vent — is merged into ONE cutter first, and the halves are built from
        // plain boxes (with their pegs and sockets) before the cutter is subtracted.
        // That is two heavy booleans against a dense model instead of a dozen, which
        // is the difference between a couple of seconds and most of a minute.
        let cutter = CSG.fromMesh(mesh);

        // Pour funnel: from the model's top point straight up through the block's
        // top face, narrow at the model and flaring at the opening. Its foot sinks a
        // little below the top point so it is guaranteed to break into the hollow.
        const top = _mTopPoint(geo, ctr) || { x: ctr.x, y: ctr.y, z: bb.max.z };
        const foot = Math.min(size.x, size.y);
        const ff = _mFunnelFoot(geo, top, Math.max(0.8, Math.min(o.sprue, foot * 0.4)), size.z * 0.4);
        const rBot = ff.r;
        const roomTop = Math.min(B.max[0] - top.x, top.x - B.min[0], B.max[1] - top.y, top.y - B.min[1]) - 1.5;
        const rTop = Math.max(rBot * 1.2, Math.min(Math.max(rBot, o.sprue) * 1.7, roomTop));
        const funnel = CSG.fromMesh(_mCone(top.x, top.y, top.z - ff.depth, B.max[2] + 1, rBot, rTop));
        const withFunnel = _mTry(cutter, c => c.union(funnel));
        if (withFunnel === cutter) throw new Error('the pour funnel could not be joined to the model.');
        cutter = withFunnel;

        // Air vent: a thin riser from the highest point away from the funnel, so air
        // trapped there escapes instead of leaving a bubble in the casting.
        let vented = false;
        if (o.vent) {
          const vr = Math.max(0.8, Math.min(1.5, rBot * 0.35));
          const v = _mHighestAway(geo, top.x, top.y, rTop + vr + 2);
          if (v && v.z > bb.min.z + size.z * 0.25) {
            const before = cutter;
            cutter = _mTry(cutter, c => c.union(CSG.fromMesh(_mCone(v.x, v.y, v.z - Math.min(1, size.z * 0.2), B.max[2] + 1, vr, vr, 12))));
            vented = cutter !== before;
          }
        }

        // The two half-blocks, split through the middle of the model.
        const ax = o.split, ai = 'xyz'.indexOf(ax);
        const plane = [ctr.x, ctr.y, ctr.z][ai];
        const halfBox = (side) => {
          const mn = B.min.slice(), mx = B.max.slice();
          if (side < 0) mx[ai] = plane; else mn[ai] = plane;
          return CSG.fromMesh(_mBox(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]));
        };
        let halfA = halfBox(-1);   // negative side — carries the pegs
        let halfB = halfBox(+1);   // positive side — carries the sockets

        // Alignment pegs at the four corners of the wall ring on the parting plane —
        // outside the model's bounds on both of the other axes, so they always sit in
        // solid wall and never break into the hollow, the funnel or the vent. Each
        // starts half a millimetre inside half A so it fuses with it rather than
        // merely touching its face.
        const others = [0, 1, 2].filter(i => i !== ai);
        const bmin = [bb.min.x, bb.min.y, bb.min.z], bmax = [bb.max.x, bb.max.y, bb.max.z];
        const pegR = Math.min(o.pegR, (w / 2) / 1.3);
        let pegsAdded = 0, pegNote = '';
        if (pegR < 0.8) {
          pegNote = 'the wall is too thin for alignment pegs — raise Wall thickness';
        } else {
          const pegLen = Math.min(pegR * o.pegLenMul, size.getComponent(ai) / 2 + w - 1);
          [-1, 1].forEach(su => [-1, 1].forEach(sv => {
            const p = [0, 0, 0];
            p[ai] = plane - 0.5;
            p[others[0]] = su < 0 ? bmin[others[0]] - w / 2 : bmax[others[0]] + w / 2;
            p[others[1]] = sv < 0 ? bmin[others[1]] - w / 2 : bmax[others[1]] + w / 2;
            const at = new THREE.Vector3(p[0], p[1], p[2]);
            try {
              const grown = halfA.union(CSG.fromMesh(_mPeg(ax, at, pegR, pegLen + 0.5)));
              const cut = halfB.subtract(CSG.fromMesh(_mPeg(ax, at, pegR + o.pegClear, pegLen + 0.5 + o.pegClear)));
              // Only accept a peg together with its socket, so one never jams the other.
              if (grown.polygons.length > 6 && cut.polygons.length > 6) { halfA = grown; halfB = cut; pegsAdded++; }
            } catch (e) { /* skip this peg */ }
          }));
          if (!pegsAdded) pegNote = 'the alignment pegs could not be added';
        }

        halfA = halfA.subtract(cutter);
        halfB = halfB.subtract(cutter);

        // Sanity: both halves must be real and the hollow must actually be there.
        const blockVol = (B.max[0] - B.min[0]) * (B.max[1] - B.min[1]) * (B.max[2] - B.min[2]);
        const vA = _mVolume(halfA), vB = _mVolume(halfB);
        if (vA < blockVol * 0.05 || vB < blockVol * 0.05 || _mTris(halfA) < 24 || _mTris(halfB) < 24) {
          throw new Error('this shape defeated the boolean solver — try nudging Wall thickness by a millimetre or two, or another split direction.');
        }
        if (vA + vB > blockVol * 0.995) throw new Error('the hollow did not form — try a slightly different wall thickness or funnel size.');
        geo.dispose();
        return { csgA: halfA, csgB: halfB, axis: ax, pegs: pegsAdded, pegNote, vented };
      }

      // ── Silicone mould box ────────────────────────────────────────────────
      // o: { gap, wall, floor, lid, sprue, clear }
      function buildSiliconeBox(mesh, o) {
        const CSG = window.CSGEngine;
        const geo = _mWorldGeo(mesh);
        const bb = geo.boundingBox;
        const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
        if (!(size.x > 0 && size.y > 0 && size.z > 0)) throw new Error('that object has no volume to cast.');

        // Inside of the box = the block of silicone: the model plus the gap on
        // every side, including underneath (the model hangs, it doesn't stand).
        const g = o.gap, t = o.wall;
        const I = { x0: bb.min.x - g, y0: bb.min.y - g, z0: bb.min.z - g, x1: bb.max.x + g, y1: bb.max.y + g, z1: bb.max.z + g };

        // Box: floor and walls, open top.
        let box = CSG.fromMesh(_mBox(I.x0 - t, I.y0 - t, I.z0 - o.floor, I.x1 + t, I.y1 + t, I.z1))
          .subtract(CSG.fromMesh(_mBox(I.x0, I.y0, I.z0, I.x1, I.y1, I.z1 + 5)));

        // Lid: a plate resting on the walls, with a locating rim underneath that
        // drops just inside the walls so the lid — and the model hanging from it —
        // always sits centred.
        const c = o.clear;
        const rimW = Math.max(1, Math.min(2, g - c - 1)), rimD = Math.min(3, g * 0.5);
        let lid = CSG.fromMesh(_mBox(I.x0 - t, I.y0 - t, I.z1, I.x1 + t, I.y1 + t, I.z1 + o.lid));
        const rim = CSG.fromMesh(_mBox(I.x0 + c, I.y0 + c, I.z1 - rimD, I.x1 - c, I.y1 - c, I.z1 + 0.5))
          .subtract(CSG.fromMesh(_mBox(I.x0 + c + rimW, I.y0 + c + rimW, I.z1 - rimD - 1, I.x1 - c - rimW, I.y1 - c - rimW, I.z1 + 1)));
        lid = _mTry(lid, l => l.union(rim));

        // Pour funnel: from the model's top point up into the lid. This is what holds
        // the model up, and once the silicone cures it leaves the channel you pour
        // the final casting through.
        const top = _mTopPoint(geo, ctr) || { x: ctr.x, y: ctr.y, z: bb.max.z };
        const foot = Math.min(size.x, size.y);
        const ff = _mFunnelFoot(geo, top, Math.max(1.2, Math.min(o.sprue, foot * 0.4)), size.z * 0.4);
        const rBot = Math.max(1.2, ff.r);
        const roomTop = Math.min(I.x1 - top.x, top.x - I.x0, I.y1 - top.y, top.y - I.y0) - c - rimW - 1;
        const rTop = Math.max(rBot, Math.min(Math.max(rBot, o.sprue) * 1.7, roomTop));
        const bite = ff.depth;

        // Pour and vent holes through the lid, in the corners furthest from the
        // funnel so silicone runs down the gap beside the model rather than onto it.
        const inset = c + rimW + 1;
        const rPour = Math.max(3, Math.min(8, Math.min(I.x1 - I.x0, I.y1 - I.y0) * 0.12));
        const rVent = Math.max(1.5, rPour * 0.4);
        const corners = [[I.x0, I.y0, 1, 1], [I.x1, I.y0, -1, 1], [I.x0, I.y1, 1, -1], [I.x1, I.y1, -1, -1]]
          .sort((a, b) => Math.hypot(b[0] - top.x, b[1] - top.y) - Math.hypot(a[0] - top.x, a[1] - top.y));
        const hole = (cn, r) => {
          const hx = cn[0] + cn[2] * (inset + r), hy = cn[1] + cn[3] * (inset + r);
          if (Math.hypot(hx - top.x, hy - top.y) < rTop + r + 1) return null;   // would cut into the funnel
          return _mCone(hx, hy, I.z1 - rimD - 1, I.z1 + o.lid + 1, r, r, 24);
        };
        const pourHole = hole(corners[0], rPour), ventHole = hole(corners[1], rVent);
        if (pourHole) lid = _mTry(lid, l => l.subtract(CSG.fromMesh(pourHole)));
        if (ventHole) lid = _mTry(lid, l => l.subtract(CSG.fromMesh(ventHole)));

        const funnel = _mCone(top.x, top.y, top.z - bite, I.z1 + Math.min(1, o.lid * 0.5), rBot, rTop);
        let assembly = _mTry(lid, l => l.union(CSG.fromMesh(funnel)));
        const withFunnel = assembly !== lid;
        const withModel = _mTry(assembly, a => a.union(CSG.fromMesh(mesh)));
        if (!withFunnel || withModel === assembly) {
          throw new Error('the model could not be joined to its pour funnel — try a slightly different funnel size.');
        }
        assembly = withModel;
        if (_mTris(box) < 24) throw new Error('the box did not form — try a slightly different wall thickness.');
        geo.dispose();
        return { box, lid: assembly, holes: !!pourHole };
      }

      // Lay parts out ready to print: rotate each so `up` (its outward face normal,
      // in world space) points +Z, then stand them on the plate in a row along X,
      // centred where the original model was.
      function _mLayout(parts, anchor) {
        const Z = new THREE.Vector3(0, 0, 1);
        parts.forEach(({ mesh, up }) => {
          mesh.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(up.clone().normalize(), Z));
          mesh.updateMatrixWorld(true);
        });
        const boxes = parts.map(({ mesh }) => new THREE.Box3().setFromObject(mesh));
        const gapX = 10;
        const total = boxes.reduce((s, b) => s + (b.max.x - b.min.x), 0) + gapX * (parts.length - 1);
        let x = anchor.x - total / 2;
        parts.forEach(({ mesh }, i) => {
          const b = boxes[i];
          mesh.position.x += x - b.min.x;
          mesh.position.y += anchor.y - (b.min.y + b.max.y) / 2;
          mesh.position.z += -b.min.z;
          mesh.updateMatrixWorld(true);
          x += (b.max.x - b.min.x) + gapX;
        });
      }

      // Build the selected kind of mould from the selected solid and drop its parts
      // into the scene, print-ready.
      function generateMold() {
        if (selected.length !== 1) return banner('⚠️ Select exactly one solid to make a mould of.');
        const src = selected[0];
        if (src.userData.isSketch) return banner('⚠️ Moulds need a solid — extrude the sketch first.');
        const meshes = collectSolidMeshes(src);
        if (!meshes.length) return banner('⚠️ That selection has no solid geometry.');
        if (meshes.length > 1) return banner('⚠️ Combine the group into one solid first (Modify → Merge).');
        const mesh = meshes[0];
        const tris = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3;
        if (tris > 16000) banner('Working — that is a dense mesh, so this may take a moment…');

        // NOTE: document.getElementById directly — the `$` shorthand lives in the
        // Paint module, not this one.
        const el = (id) => document.getElementById(id);
        const num = (id, d) => { const e = el(id); const v = e ? parseFloat(e.value) : NaN; return isFinite(v) ? v : d; };
        const kind = window.currentMoldKind ? window.currentMoldKind() : 'block';
        const sprue = num('mold-sprue', 6);

        let res;
        try {
          if (kind === 'cast') {
            const gap = num('cast-gap', 10);
            res = _mRetry(j => buildSiliconeBox(mesh, {
              gap: gap + j * 0.4, wall: num('cast-wall', 3), floor: num('cast-base', 3), lid: num('cast-lid', 3),
              sprue: Math.max(1.2, sprue + j * 0.3), clear: num('cast-clear', 0.4)
            }));
          } else {
            const wall = num('mold-wall', 8);
            const split = (el('mold-axis') && el('mold-axis').value) || 'x';
            res = _mRetry(j => buildPourMould(mesh, {
              wall: wall + j * 0.5, sprue: Math.max(0.8, sprue + j * 0.4),
              vent: el('mold-vent') ? el('mold-vent').checked : true,
              split: /^[xyz]$/.test(split) ? split : 'x',
              pegR: num('mold-peg', 3), pegLenMul: num('mold-peglen', 2.4), pegClear: num('mold-clear', 0.15)
            }));
          }
        } catch (err) {
          console.error('Mould build failed:', err);
          return banner('⚠️ Couldn\'t build that ' + (kind === 'cast' ? 'silicone mould box' : 'mould') + ': ' + (err.message || err));
        }

        const baseName = src.userData.name || src.name || 'Object';
        const mk = (csg, label) => {
          const m = csgToRecenteredMesh(csg, mesh.material);
          m.userData.name = baseName + ' ' + label;
          m.userData.isMoldHalf = true;
          m.castShadow = true; m.receiveShadow = true;
          scene.add(m); objects.push(m);
          return m;
        };
        const anchor = new THREE.Box3().setFromObject(src).getCenter(new THREE.Vector3());
        let made, msg;
        if (kind === 'cast') {
          const boxM = mk(res.box, 'mould box');
          const lidM = mk(res.lid, 'lid + pattern');
          // Box prints as it stands; the lid prints upside down — lid flat on the
          // plate, funnel and model pointing up.
          _mLayout([{ mesh: boxM, up: new THREE.Vector3(0, 0, 1) }, { mesh: lidM, up: new THREE.Vector3(0, 0, -1) }], anchor);
          made = [boxM, lidM];
          msg = 'Silicone mould box created — print the box, and the lid upside down as laid out (the model may need supports). ' +
                'Turn the lid over and drop it onto the box: the model hangs inside with an even gap all round. ' +
                (res.holes ? 'Pour silicone through the larger hole in the lid; the small one lets air out. '
                           : 'The box is too small for pour holes in the lid — pour before fitting it, or raise Silicone thickness. ') +
                'Once cured, lift the lid away, take the block out and cut it open to free the model. The funnel leaves the channel you pour castings through.';
        } else {
          const a = mk(res.csgA, 'mould A');
          const b = mk(res.csgB, 'mould B');
          // Each half prints with its parting face up, so the hollow is an open pit
          // (no supports) and the face that has to seal is the cleanest one.
          const n = new THREE.Vector3(); n.setComponent('xyz'.indexOf(res.axis), 1);
          _mLayout([{ mesh: a, up: n.clone() }, { mesh: b, up: n.clone().negate() }], anchor);
          made = [a, b];
          const pegs = res.pegs ? res.pegs + ' alignment pegs' : 'no alignment pegs (' + (res.pegNote || 'no room for them') + ')';
          msg = `Mould created — two halves laid out parting-face up, with ${pegs}, a pour funnel${res.vented ? ' and an air vent' : ''}. ` +
                'Print both, put them face to face, clamp them, and pour through the funnel.';
        }

        // Keep the original around but out of the way — you may want to re-make the
        // mould with different settings. Unhide it from the object list.
        src.visible = false;
        selected = made;
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(msg + ' The original is hidden.');
      }

      function performSlice() {
        if (selected.length !== 1) return banner("⚠️ Select exactly one solid (or group) to slice.");
        if (selected[0].userData.isSketch) return banner("⚠️ Slicing works on solids — extrude the sketch first.");
        const root = selected[0];
        // A group has no geometry of its own — slice each solid inside it.
        const meshes = collectSolidMeshes(root);
        if (!meshes.length) return banner("⚠️ That selection has no solid geometry to slice.");
        const { point, normal } = computeSlicePoint();

        const created = [];
        let crossedAny = false;

        meshes.forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const geo = mesh.geometry.toNonIndexed().clone();
          geo.applyMatrix4(mesh.matrixWorld);
          const pos = geo.attributes.position;
          const colAttr = geo.attributes.color;
          const posT=[], negT=[], cutSeg=[];
          const readV = (i) => ({
            p: new THREE.Vector3().fromBufferAttribute(pos, i),
            c: colAttr ? new THREE.Vector3(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i)) : null
          });
          for (let i=0;i<pos.count;i+=3){
            const a = readV(i), b = readV(i+1), c = readV(i+2);
            // Skip zero-area triangles for the same reason the boolean engine does:
            // a cone's apex is a fan of ~24 collapsed slivers, and feeding those to
            // the clipper produced meaningless cut segments that left the cap loop
            // full of holes. This is why slicing a cone was unreliable.
            const e1 = b.p.clone().sub(a.p), e2 = c.p.clone().sub(a.p);
            if (e1.cross(e2).lengthSq() < 1e-16) continue;
            clipTri(a, b, c, normal, point, posT, negT, cutSeg);
          }
          // This body may sit entirely on one side — that's fine when slicing a group;
          // keep it whole rather than aborting the whole operation.
          if (posT.length === 0 || negT.length === 0) {
            const keepIt = (posT.length && sliceState.keep !== 'negative') || (negT.length && sliceState.keep !== 'positive');
            if (keepIt) {
              const whole = mesh.clone();
              whole.geometry = mesh.geometry.clone();
              whole.material = Array.isArray(mesh.material) ? mesh.material.map(m=>m.clone()) : mesh.material.clone();
              created.push(whole);
            }
            return;
          }
          crossedAny = true;
          let capColor = null;
          const mat0 = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (colAttr && mat0 && mat0.color) { const bc = mat0.color; capColor = new THREE.Vector3(bc.r, bc.g, bc.b); }
          addSliceCaps(cutSeg, normal, point, posT, negT, capColor);

          const baseMat = mat0;
          const pieces = [];
          if (sliceState.keep !== 'negative') pieces.push(trisToWorldMesh(posT, baseMat.clone()));
          if (sliceState.keep !== 'positive') pieces.push(trisToWorldMesh(negT, baseMat.clone()));
          // A single cut can leave loose bodies (e.g. slicing a tube inside a block) —
          // hand each disconnected shell back as its own object.
          pieces.forEach(p => {
            const parts = splitDisconnectedShells(p);
            if (parts) parts.forEach(x => created.push(x)); else created.push(p);
          });
        });

        if (!crossedAny) return banner("⚠️ Plane doesn't cross the object — adjust offset or tilt.");
        if (!created.length) return banner("⚠️ Nothing left after the slice — check which side you're keeping.");

        transformControl.detach();
        scene.remove(root); objects = objects.filter(o => o !== root);
        created.forEach(m => { setEmissive(m, 0x000000); m.castShadow = true; m.receiveShadow = true; scene.add(m); objects.push(m); });

        // Leave the user in a clean, movable state: disarm the slicer, switch back to
        // the Select tool (there is no 'move' tool — Select is the mode where the gizmo
        // drags objects), force the gizmo into translate mode, and attach it to the
        // first new piece so it can be dragged straight away.
        sliceState.armed = false; sliceState.planeHelper.visible = false;
        document.getElementById('bld-slice-arm').classList.remove('active');
        selected = [created[0]];
        refreshSelectionVisual();
        setActiveTool('select');
        if (transformControl.setMode) transformControl.setMode('translate');
        ['gizmo-translate','gizmo-rotate','gizmo-scale'].forEach(id => {
          const el = document.getElementById(id); if (el) el.classList.toggle('active', id === 'gizmo-translate');
        });
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Slice complete — ${created.length} piece(s) created.`);
      }


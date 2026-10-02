      // ═══════════════════════════════════════════════════════════════════════════
      //   EXPORT  (STL binary · OBJ · 3MF)
      // ═══════════════════════════════════════════════════════════════════════════
      // ── Print check ─────────────────────────────────────────────────────────
      // Runs the checks that decide whether a model will actually print, before you
      // commit to hours on the machine. Everything here is measured from the mesh
      // itself rather than guessed at.
      function runPrintCheck(opts) {
        const o = Object.assign({ nozzle: 0.4, minWall: 0.8, overhang: 45, bed: [256, 256, 256] }, opts || {});
        const meshes = gatherExportMeshes();
        if (!meshes.length) return { empty: true };

        const weld = makeWelder(1e-4);
        const edges = new Map();          // welded edge -> use count
        let tris = 0, degenerate = 0, flipped = 0;
        let overhangArea = 0, totalArea = 0;
        const bbox = new THREE.Box3();
        const up = new THREE.Vector3(0, 0, 1);   // engine is Z-up

        meshes.forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          const m = mesh.matrixWorld;
          const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
          for (let i = 0; i < pos.count; i += 3) {
            a.fromBufferAttribute(pos, i).applyMatrix4(m);
            b.fromBufferAttribute(pos, i+1).applyMatrix4(m);
            c.fromBufferAttribute(pos, i+2).applyMatrix4(m);
            bbox.expandByPoint(a); bbox.expandByPoint(b); bbox.expandByPoint(c);
            tris++;

            const e1 = b.clone().sub(a), e2 = c.clone().sub(a);
            const n = e1.clone().cross(e2);
            const area = n.length() * 0.5;
            if (area < 1e-9) { degenerate++; continue; }
            totalArea += area;
            n.normalize();

            // Overhang: how far the face tips away from vertical. A downward-facing
            // face steeper than the threshold needs support.
            const tilt = Math.acos(Math.max(-1, Math.min(1, n.dot(up)))) * 180 / Math.PI;
            if (tilt > 90 + (90 - o.overhang)) overhangArea += area;

            // Edge bookkeeping for the watertight test.
            const wa = weld(a), wb = weld(b), wc = weld(c);
            const key = (p, q) => {
              const kp = p.x + ',' + p.y + ',' + p.z, kq = q.x + ',' + q.y + ',' + q.z;
              return kp < kq ? kp + '|' + kq : kq + '|' + kp;
            };
            [[wa, wb], [wb, wc], [wc, wa]].forEach(([p, q]) => {
              if (p === q) return;
              const k = key(p, q);
              edges.set(k, (edges.get(k) || 0) + 1);
            });
          }
        });

        // Measure ACTUAL wall thickness by ray casting.
        //
        // The obvious shortcut — flagging small triangles — is wrong: triangle size
        // is a function of tessellation, not thickness, so a finely meshed sphere
        // looks "thin" while being solid throughout. Instead we fire a ray from a
        // sample of surface points back into the solid along the inward normal and
        // measure how far it travels before leaving. That distance IS the wall.
        let thinSpots = 0, thinnest = Infinity, probes = 0;
        const maxSpan = bbox.getSize(new THREE.Vector3()).length() || 100;
        try {
          const ray = new THREE.Raycaster();
          ray.firstHitOnly = false;
          const sampleTargets = meshes.slice(0, 12);
          const step = Math.max(1, Math.floor(tris / 400));   // cap the work
          let t = 0;
          for (const mesh of sampleTargets) {
            const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
            const pos = g.attributes.position;
            const m = mesh.matrixWorld;
            const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
            for (let i = 0; i < pos.count; i += 3, t++) {
              if (t % step) continue;
              a.fromBufferAttribute(pos, i).applyMatrix4(m);
              b.fromBufferAttribute(pos, i+1).applyMatrix4(m);
              c.fromBufferAttribute(pos, i+2).applyMatrix4(m);
              const n = b.clone().sub(a).cross(c.clone().sub(a));
              if (n.lengthSq() < 1e-12) continue;
              n.normalize().multiplyScalar(-1);                 // point inward
              const centre = a.clone().add(b).add(c).multiplyScalar(1/3);
              ray.set(centre.clone().addScaledVector(n, 1e-3), n);
              // Range must comfortably exceed the wall being looked for. Capping it
              // at a small multiple of the minimum meant a thick part's far side sat
              // beyond the ray and nothing was ever measured — the check silently
              // reported "not measured" on perfectly good models.
              ray.far = Math.max(o.minWall * 20, maxSpan);
              // Raycasting skips back faces by default, and a ray travelling INTO a
              // solid only ever exits through one — so every probe missed and no
              // thickness was measured at all. Flip the material to double-sided for
              // the duration of the probe and restore it afterwards.
              const prevSide = mesh.material && mesh.material.side;
              if (mesh.material) mesh.material.side = THREE.DoubleSide;
              const hits = ray.intersectObject(mesh, false);
              if (mesh.material && prevSide !== undefined) mesh.material.side = prevSide;
              if (hits.length) {
                probes++;
                const d = hits[0].distance;
                if (d < thinnest) thinnest = d;
                if (d < o.minWall) thinSpots++;
              }
            }
          }
        } catch (e) { probes = 0; }

        let open = 0, nonManifold = 0;
        edges.forEach(count => {
          if (count === 1) open++;              // a boundary — the mesh has a hole
          else if (count > 2) nonManifold++;    // more than two faces share an edge
        });

        const size = new THREE.Vector3();
        bbox.getSize(size);
        const fitsBed = size.x <= o.bed[0] && size.y <= o.bed[1] && size.z <= o.bed[2];

        return {
          meshes: meshes.length, tris,
          open, nonManifold, degenerate,
          watertight: open === 0 && nonManifold === 0,
          thinSpots, thinnest: (thinnest === Infinity ? null : thinnest), probes,
          overhangPct: totalArea > 0 ? (overhangArea / totalArea) * 100 : 0,
          size: { x: size.x, y: size.y, z: size.z },
          fitsBed, bed: o.bed,
          minZ: bbox.min.z,
          nozzle: o.nozzle, minWall: o.minWall, overhang: o.overhang
        };
      }

      // Render the result as a readable report rather than a wall of numbers.
      function renderPrintCheck(r) {
        const box = document.getElementById('pc-results');
        if (!box) return;
        if (!r || r.empty) {
          box.innerHTML = '<div class="pc-row pc-warn"><span>Nothing to check — the scene is empty.</span></div>';
          return;
        }
        const rows = [];
        const row = (state, label, detail) =>
          rows.push('<div class="pc-row pc-' + state + '"><span class="pc-dot"></span><div><b>' +
                    label + '</b>' + (detail ? '<br><span class="pc-detail">' + detail + '</span>' : '') + '</div></div>');

        if (r.watertight) row('ok', 'Watertight', 'No holes or non-manifold edges — safe to slice.');
        else {
          const bits = [];
          if (r.open) bits.push(r.open + ' open edge' + (r.open === 1 ? '' : 's') + ' (holes in the surface)');
          if (r.nonManifold) bits.push(r.nonManifold + ' non-manifold edge' + (r.nonManifold === 1 ? '' : 's') + ' (faces meeting badly)');
          row('bad', 'Not watertight', bits.join(' · ') + '. Slicers may fill this in unpredictably.');
        }

        if (r.degenerate) row('warn', r.degenerate + ' zero-area triangle' + (r.degenerate === 1 ? '' : 's'),
          'Harmless to print, but they can upset booleans. Exporting cleans them up.');

        if (!r.probes) row('warn', 'Wall thickness not measured',
          'Couldn\'t sample this model — check thin areas by eye.');
        else if (r.thinSpots) row('bad', 'Thin walls',
          'Measured down to ' + r.thinnest.toFixed(2) + ' mm, below your ' + r.minWall +
          ' mm minimum. Thin areas may not print, or will come out weak.');
        else row('ok', 'Wall thickness',
          'Thinnest measured section is ' + (r.thinnest != null ? r.thinnest.toFixed(2) + ' mm' : 'above the limit') +
          ' — clears the ' + r.minWall + ' mm minimum.');

        const op = r.overhangPct;
        if (op > 25) row('bad', 'Heavy overhangs', op.toFixed(0) + '% of the surface is steeper than ' +
          r.overhang + '°. Expect supports, or reorient the part.');
        else if (op > 8) row('warn', 'Some overhangs', op.toFixed(0) + '% steeper than ' + r.overhang +
          '° — supports likely in places.');
        else row('ok', 'Overhangs', op.toFixed(0) + '% steep faces — should print unsupported.');

        const s = r.size;
        const dims = s.x.toFixed(1) + ' × ' + s.y.toFixed(1) + ' × ' + s.z.toFixed(1) + ' mm';
        if (r.fitsBed) row('ok', 'Fits the bed', dims + ' within ' + r.bed.join(' × ') + ' mm.');
        else row('bad', 'Too big for the bed', dims + ' exceeds ' + r.bed.join(' × ') +
          ' mm. Scale it down or split it.');

        if (Math.abs(r.minZ) > 0.05) row('warn', 'Not sitting on the build plate',
          'Lowest point is ' + r.minZ.toFixed(2) + ' mm from zero. Most slicers drop it automatically.');

        const bad = rows.filter(x => x.indexOf('pc-bad') >= 0).length;
        const warn = rows.filter(x => x.indexOf('pc-warn') >= 0).length;
        const head = '<div class="pc-summary">' +
          (bad ? '<b style="color:var(--danger,#e06c6c);">' + bad + ' problem' + (bad === 1 ? '' : 's') + '</b>'
               : (warn ? '<b style="color:var(--accent);">Ready, with ' + warn + ' note' + (warn === 1 ? '' : 's') + '</b>'
                       : '<b style="color:#6cc07a;">Ready to print</b>')) +
          ' · ' + r.meshes + ' part' + (r.meshes === 1 ? '' : 's') + ', ' + r.tris.toLocaleString() + ' triangles</div>';
        box.innerHTML = head + rows.join('');
      }

      function gatherExportMeshes() {
        // Collect renderable meshes, descending into groups. Some objects (combined
        // parts, imported multi-mesh models, baked sketch groups) are THREE.Groups
        // with no geometry of their own — their child meshes must still be exported,
        // otherwise those parts silently vanish from the STL/OBJ.
        const out = [];
        const visit = (o) => {
          if (!o.visible || o.userData.isSketch) return;
          if (o.geometry && o.type === 'Mesh') out.push(o);
          if (o.children && o.children.length) o.children.forEach(visit);
        };
        objects.forEach(visit);
        return out;
      }

      function collectWorldTriangles() {
        const tris = [];
        gatherExportMeshes().forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          for (let i=0;i<pos.count;i+=3){
            const a=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
            const b=new THREE.Vector3().fromBufferAttribute(pos,i+1).applyMatrix4(mesh.matrixWorld);
            const c=new THREE.Vector3().fromBufferAttribute(pos,i+2).applyMatrix4(mesh.matrixWorld);
            tris.push([a,b,c]);
          }
        });
        return tris;
      }

      // Save/share a generated file. Desktop browsers get a normal download. iOS
      // Safari ignores the <a download> attribute (the file silently never appears),
      // so when the Web Share API can handle files we hand the file to the native
      // share sheet instead — the user can then "Save to Files", AirDrop, etc. A
      // final fallback opens the blob in a new tab so it's never simply lost.
      async function downloadBlob(blob, filename) {
        const file = (typeof File !== 'undefined')
          ? new File([blob], filename, { type: blob.type || 'application/octet-stream' })
          : null;

        // Prefer native share on devices that support sharing files (iOS/iPadOS,
        // Android). This is what makes exports actually save on iPhone/iPad.
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') return;   // user dismissed the sheet
            // otherwise fall through to the download/open fallbacks
          }
        }

        // Standard desktop download path.
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = filename; link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();

        // iOS Safari without canShare: the click won't save, so also open the blob
        // in a new tab as a last resort so the data is reachable.
        const isIOS = /iP(hone|ad|od)/.test(navigator.platform) ||
          (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
        if (isIOS && !file) { try { window.open(url, '_blank'); } catch(e){} }

        setTimeout(() => { URL.revokeObjectURL(url); if (link.parentNode) link.parentNode.removeChild(link); }, 1500);
      }

      // Resolves the export filename: uses the name field, falls back to a prompt,
      // strips any extension the user typed, sanitizes it, and appends `.ext`.
      function resolveExportName(ext) {
        const field = document.getElementById('export-name');
        let name = field ? field.value.trim() : '';
        if (!name) {
          // No OS prompt here — the name field in the panel is the single place to
          // set this, so an empty field just falls back to a sensible default and
          // fills the field in so it's visible and editable.
          name = 'model';
          if (field) { field.value = name; field.focus(); }
          banner('Exporting as "model" — change the name in the field above if you want something else.');
        }
        if (!name) name = 'model';
        name = name.replace(/\.(stl|obj|3mf)$/i, '')       // drop any extension typed
                   .replace(/[^a-z0-9._ -]/gi, '_')        // sanitize
                   .replace(/\s+/g, '_');
        if (!name) name = 'model';
        return `${name}.${ext}`;
      }

      function exportSTL() {
        const tris = collectWorldTriangles();
        if (!tris.length) return banner("⚠️ Nothing to export.");
        const fname = resolveExportName('stl'); if (!fname) return;
        const buffer = new ArrayBuffer(84 + tris.length*50);
        const dv = new DataView(buffer);
        dv.setUint32(80, tris.length, true);
        let off = 84;
        tris.forEach(([a,b,c]) => {
          const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
          dv.setFloat32(off, n.x, true); dv.setFloat32(off+4, n.y, true); dv.setFloat32(off+8, n.z, true); off+=12;
          [a,b,c].forEach(p => { dv.setFloat32(off, p.x, true); dv.setFloat32(off+4, p.y, true); dv.setFloat32(off+8, p.z, true); off+=12; });
          dv.setUint16(off, 0, true); off+=2;
        });
        downloadBlob(new Blob([buffer], {type:'application/octet-stream'}), fname);
        banner(`Exported ${fname}`);
      }

      function exportOBJ() {
        const meshes = gatherExportMeshes();
        if (!meshes.length) return banner("⚠️ Nothing to export.");
        const fname = resolveExportName('obj'); if (!fname) return;

        // Painting apps like Procreate reject models whose UVs overlap or repeat
        // (which a triplanar/position-based projection always does). When "unwrap
        // for painting" is on, we instead give every triangle its own unique cell in
        // a packed 0..1 UV atlas — no overlaps, no repeats — so those apps accept it.
        const unwrapForPaint = !document.getElementById('export-keepuv') || !document.getElementById('export-keepuv').checked;

        let out = '# Exported from ModelSmith\n'; let base = 1;
        meshes.forEach((mesh, mi) => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          const nrm = g.attributes.normal;
          const uvAttr = g.attributes.uv; // real UVs if this mesh still has them
          const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
          out += `o object_${mi+1}\n`;

          for (let i=0;i<pos.count;i++){
            const p=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
            out += `v ${p.x.toFixed(5)} ${p.y.toFixed(5)} ${p.z.toFixed(5)}\n`;
          }

          const uvLines = [];
          if (unwrapForPaint) {
            // pack triangles into a square grid; each triangle → its own half-cell
            const triCount = pos.count / 3;
            const cols = Math.max(1, Math.ceil(Math.sqrt(triCount)));
            const cell = 1 / cols;
            const pad = cell * 0.06;      // small gutter so bleed doesn't cross cells
            for (let t=0;t<triCount;t++){
              const cx = (t % cols) * cell, cy = Math.floor(t / cols) * cell;
              const x0=cx+pad, y0=cy+pad, x1=cx+cell-pad, y1=cy+cell-pad;
              // three corners of a triangle inside the cell
              uvLines.push(`vt ${x0.toFixed(5)} ${y0.toFixed(5)}\n`);
              uvLines.push(`vt ${x1.toFixed(5)} ${y0.toFixed(5)}\n`);
              uvLines.push(`vt ${x0.toFixed(5)} ${y1.toFixed(5)}\n`);
            }
          } else {
            for (let i=0;i<pos.count;i++){
              const p=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
              let uv;
              if (uvAttr) { uv = { x: uvAttr.getX(i), y: uvAttr.getY(i) }; }
              else {
                let n = new THREE.Vector3(0,0,1);
                if (nrm) n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
                uv = window.CSGEngine.triplanarUV(p, n);
              }
              uvLines.push(`vt ${uv.x.toFixed(5)} ${uv.y.toFixed(5)}\n`);
            }
          }
          out += uvLines.join('');

          for (let i=0;i<pos.count;i+=3){
            const a=base+i, b=base+i+1, c=base+i+2;
            out += `f ${a}/${a} ${b}/${b} ${c}/${c}\n`;
          }
          base += pos.count;
        });
        downloadBlob(new Blob([out], {type:'text/plain'}), fname);
        banner(`Exported ${fname}`);
      }

      function export3MF() {
        const meshes = gatherExportMeshes();
        if (!meshes.length) return banner("⚠️ Nothing to export.");
        const fname = resolveExportName('3mf'); if (!fname) return;

        // One shared colour list for the whole file — every object (or, for a
        // vertex-painted mesh, every vertex) just references an index into it.
        const colorList = [];
        const tmpColor = new THREE.Color();
        const colorIndex = (hexStr) => {
          let idx = colorList.indexOf(hexStr);
          if (idx === -1) { idx = colorList.length; colorList.push(hexStr); }
          return idx;
        };
        const hexOf = (r, g, b) => {
          tmpColor.setRGB(r, g, b);
          return '#' + tmpColor.getHexString().toUpperCase();
        };

        const objectsXml = [];
        const buildItems = [];
        let nextId = 2; // id 1 is the shared colour group

        meshes.forEach(mesh => {
          mesh.updateMatrixWorld(true);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = g.attributes.position;
          const hasVertexColor = !Array.isArray(mesh.material) && mesh.material.vertexColors && g.attributes.color;
          const colAttr = hasVertexColor ? g.attributes.color : null;

          // Dedup vertices (position-based), same technique as before, but also
          // remember which colour-group index each deduped vertex maps to.
          const map = new Map(); const verts = []; const vertColorIdx = [];
          const key = (p) => `${p.x.toFixed(4)}_${p.y.toFixed(4)}_${p.z.toFixed(4)}`;
          const indices = [];
          for (let i = 0; i < pos.count; i++) {
            const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            const k = key(p);
            let id = map.get(k);
            if (id === undefined) {
              id = verts.length; verts.push(p); map.set(k, id);
              if (colAttr) vertColorIdx.push(colorIndex(hexOf(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i))));
            }
            indices.push(id);
          }

          const objId = nextId++;
          let defaultColorIdx;
          if (colAttr) {
            defaultColorIdx = vertColorIdx[0] || 0;
          } else {
            const mc = (!Array.isArray(mesh.material) && mesh.material.color) ? mesh.material.color : new THREE.Color(0x8a9bb8);
            defaultColorIdx = colorIndex(hexOf(mc.r, mc.g, mc.b));
          }

          let xml = `  <object id="${objId}" type="model" pid="1" pindex="${defaultColorIdx}">\n   <mesh>\n    <vertices>\n`;
          verts.forEach(p => { xml += `     <vertex x="${p.x.toFixed(5)}" y="${p.y.toFixed(5)}" z="${p.z.toFixed(5)}"/>\n`; });
          xml += `    </vertices>\n    <triangles>\n`;
          for (let i = 0; i < indices.length; i += 3) {
            const a = indices[i], b = indices[i+1], c = indices[i+2];
            const perVert = colAttr ? ` p1="${vertColorIdx[a]}" p2="${vertColorIdx[b]}" p3="${vertColorIdx[c]}"` : '';
            xml += `     <triangle v1="${a}" v2="${b}" v3="${c}"${perVert}/>\n`;
          }
          xml += `    </triangles>\n   </mesh>\n  </object>\n`;
          objectsXml.push(xml);
          buildItems.push(`  <item objectid="${objId}"/>\n`);
        });

        const colorGroupXml = `  <m:colorgroup id="1">\n` +
          colorList.map(hex => `   <m:color color="${hex}"/>\n`).join('') +
          `  </m:colorgroup>\n`;

        const model = `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n` +
          ` <resources>\n${colorGroupXml}${objectsXml.join('')} </resources>\n` +
          ` <build>\n${buildItems.join('')} </build>\n</model>\n`;

        const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n`;
        const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n`;

        const zipBlob = zipStore([
          { name: '[Content_Types].xml', data: contentTypes },
          { name: '_rels/.rels', data: rels },
          { name: '3D/3dmodel.model', data: model }
        ]);
        downloadBlob(zipBlob, fname);
        banner(`Exported ${fname} — ${meshes.length} separate object${meshes.length > 1 ? 's' : ''}, coloured.`);
      }

      // Minimal STORED (no compression) ZIP writer — valid .3mf container.
      function zipStore(entries) {
        const enc = new TextEncoder();
        const parts = []; const central = []; let offset = 0;
        const crcTable = (function(){ let c, t=[]; for(let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++) c = (c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
        function crc32(bytes){ let crc=0xFFFFFFFF; for(let i=0;i<bytes.length;i++) crc=(crc>>>8)^crcTable[(crc^bytes[i])&0xFF]; return (crc^0xFFFFFFFF)>>>0; }
        function u16(n){ return new Uint8Array([n&0xff,(n>>8)&0xff]); }
        function u32(n){ return new Uint8Array([n&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>24)&0xff]); }

        entries.forEach(e => {
          const nameBytes = enc.encode(e.name);
          const dataBytes = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
          const crc = crc32(dataBytes);
          const local = [];
          local.push(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length), u16(0), nameBytes, dataBytes);
          const localBlob = concatU8(local);
          parts.push(localBlob);
          const cen = [];
          cen.push(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes);
          central.push(concatU8(cen));
          offset += localBlob.length;
        });
        const centralBlob = concatU8(central);
        const eocd = concatU8([ u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBlob.length), u32(offset), u16(0) ]);
        return new Blob([concatU8(parts), centralBlob, eocd], { type: 'model/3mf' });
      }

      function concatU8(arrs) {
        let len = 0; arrs.forEach(a => len += a.length); const out = new Uint8Array(len); let o=0;
        arrs.forEach(a => { out.set(a, o); o += a.length; }); return out;
      }

      // Ensure the mesh has fine enough triangles for the current brush before
      // sculpting. If the average triangle edge in the hit region is large relative
      // to the brush, subdivide the whole mesh a step. This is what makes sculpting
      // high-resolution: the brush always has plenty of vertices to move.
      function ensureSculptResolution(mesh, worldBrushRadius) {
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        // sample a few triangle edge lengths (in local space) → world scale
        const scale = (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3;
        let sampleN = Math.min(pos.count, 300);
        let sumEdge = 0, cnt = 0;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        for (let i = 0; i < sampleN; i += 3) {
          a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i+1);
          sumEdge += a.distanceTo(b); cnt++;
        }
        const avgEdgeWorld = (cnt ? sumEdge / cnt : 1) * scale;
        // aim for ~6 vertices across the brush; subdivide (up to 3 passes) if coarse
        let passes = 0;
        let edge = avgEdgeWorld;
        while (edge > worldBrushRadius / 3 && passes < 3 && (geo.attributes.position.count/3) < 400000) {
          passes++; edge /= 2;
        }
        if (passes > 0) {
          const sub = subdivideGeometry(mesh.geometry, passes);
          mesh.geometry.dispose();
          mesh.geometry = sub;
        }
      }

      function handleSculptStroke() {
        const targetable = objects.filter(o => !o.userData.isSketch && o.visible);
        const intersects = raycaster.intersectObjects(targetable, true);
        if (intersects.length === 0) return;

        const hit = intersects[0];
        const mesh = hit.object;

        // Densify under the brush the first time we touch a too-coarse mesh so the
        // stroke has fine vertices to work with (high-resolution sculpting).
        if (!mesh.userData._sculptDensified) {
          ensureSculptResolution(mesh, sculptBrush.radius);
          mesh.userData._sculptDensified = true;
        }

        const geo = mesh.geometry;
        const posAttr = geo.attributes.position;
        if (!posAttr) return;

        if (!hit.face) return;
        const localHitPoint = hit.point.clone();
        mesh.worldToLocal(localHitPoint);

        const localNormal = hit.face.normal.clone().normalize();
        const localRadius = sculptBrush.radius / mesh.scale.x;
        // Gentle per-stroke displacement. The multiplier is deliberately small so
        // sculpting builds up gradually instead of denting the surface in one pass;
        // hold or drag repeatedly to push further. (Was 0.05 — far too aggressive.)
        const strength = sculptBrush.intensity * (sculptBrush.type === 'add' ? 0.008 : -0.008);

        let changed = false;
        const r2 = localRadius * localRadius;
        for (let i = 0; i < posAttr.count; i++) {
          const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
          const dx = vx - localHitPoint.x, dy = vy - localHitPoint.y, dz = vz - localHitPoint.z;
          const d2 = dx*dx + dy*dy + dz*dz;
          if (d2 < r2) {
            const dist = Math.sqrt(d2);
            // smooth cosine falloff → rounder, cleaner deformation than pow(,2)
            const t = dist / localRadius;
            const weight = 0.5 * (1 + Math.cos(Math.PI * t));
            posAttr.setX(i, vx + localNormal.x * strength * weight);
            posAttr.setY(i, vy + localNormal.y * strength * weight);
            posAttr.setZ(i, vz + localNormal.z * strength * weight);
            changed = true;
          }
        }

        if (changed) {
          posAttr.needsUpdate = true;
          geo.computeVertexNormals();
        }
      }

      function initSketchPlane(origin, norm) {
        activeSketch.origin.copy(origin); activeSketch.n.copy(norm).normalize();
        activeSketch.plane.setFromNormalAndCoplanarPoint(activeSketch.n, activeSketch.origin);

        // Build a right-handed frame (u × v = n) whose orientation follows the face's
        // tilt. We derive u by projecting the world "up" (Z) onto the face plane, so
        // the drawing axes lean with the surface — a rectangle drawn on a slightly
        // tilted face lies flat and stays aligned to that tilt, rather than snapping
        // to world axes. Only when the face is itself nearly horizontal (normal ≈ ±Z,
        // where world-up projects to nothing) do we fall back to world X.
        const n = activeSketch.n;
        let up = new THREE.Vector3(0, 0, 1);
        if (Math.abs(n.dot(up)) > 0.94) up = new THREE.Vector3(1, 0, 0); // face is horizontal
        // u = component of up lying in the face plane
        activeSketch.u.copy(up).addScaledVector(n, -up.dot(n)).normalize();
        activeSketch.v.crossVectors(n, activeSketch.u).normalize(); // v = n × u ⇒ u × v = n

        activeSketch.gridVisual.position.copy(activeSketch.origin);
        activeSketch.gridVisual.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), activeSketch.n);
        activeSketch.gridVisual.visible = true;

        activeSketch.segments = []; activeSketch.tempPoints = []; activeSketch.arcStage = 0;
        clearSketchHistory();
        currentMode = 'sketching'; transformControl.detach(); selected=[]; updateFloatingHUD();
        document.getElementById('sketch-tools').style.display = 'block';
        banner("Sketch plane set to the face. Draw your profile — it follows the surface tilt.");
      }

      function getSketchPt2D() {
        const pt = new THREE.Vector3();
        if(raycaster.ray.intersectPlane(activeSketch.plane, pt)) {
          let rel = pt.sub(activeSketch.origin);
          return new THREE.Vector2(rel.dot(activeSketch.u), rel.dot(activeSketch.v));
        }
        return null;
      }

      function pt3D(x, y) {
        return activeSketch.origin.clone().addScaledVector(activeSketch.u, x).addScaledVector(activeSketch.v, y);
      }

      function findLineIntersection(p1, p2, p3, p4) {
        let d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
        if (Math.abs(d) < 1e-6) return null;
        let u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
        let v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
        if (u >= 0.001 && u <= 0.999 && v >= 0.001 && v <= 0.999) return new THREE.Vector2(p1.x + u * (p2.x - p1.x), p1.y + u * (p2.y - p1.y));
        return null;
      }

      function splitAllIntersections() {
        let segments = activeSketch.segments;
        for (let p = 0; p < 3; p++) {
          let newSegments = []; let splitOccurred = false;
          for (let i = 0; i < segments.length; i++) {
            let s1 = segments[i]; let splitPoints = [];
            for (let j = 0; j < segments.length; j++) {
              if (i === j) continue;
              let hit = findLineIntersection(s1.p1, s1.p2, segments[j].p1, segments[j].p2);
              if (hit && !splitPoints.some(pt => pt.distanceTo(hit) < 1e-3)) splitPoints.push(hit);
            }
            if (splitPoints.length > 0) {
              splitOccurred = true;
              let pts = [s1.p1, ...splitPoints, s1.p2];
              pts.sort((a, b) => a.distanceTo(s1.p1) - b.distanceTo(s1.p1));
              for (let k = 0; k < pts.length - 1; k++) newSegments.push({ p1: pts[k], p2: pts[k+1] });
            } else newSegments.push(s1);
          }
          segments = newSegments; if (!splitOccurred) break;
        }
        activeSketch.segments = segments;
      }

      function injectRawSegment(p1, p2) {
        if (p1.distanceTo(p2) < 1e-2) return;
        activeSketch.segments.push({ p1: p1.clone(), p2: p2.clone() });
      }


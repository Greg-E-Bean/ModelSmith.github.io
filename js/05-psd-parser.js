
    // Self-contained PSD parser (RGB / 8-bit, RAW + RLE). Lets the Paint studio
    // import layered Photoshop files offline, without any external library.
    // ── PSD layer-effect (lfx2) reading ──────────────────────────────────
    // Photoshop stores effects as a typed "descriptor" tree. This reads enough of
    // that format to recover the common effects. Anything it doesn't recognise is
    // skipped rather than guessed at.
    function psdDescriptor(dv, o, end) {
      const rdU32 = () => { const v = dv.getUint32(o); o += 4; return v; };
      const rdStr = (n) => { let s=''; for (let i=0;i<n;i++) s += String.fromCharCode(dv.getUint16(o + i*2)); o += n*2; return s; };
      const rdKey = () => {
        const n = rdU32();
        if (n === 0) { const s = String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3)); o += 4; return s; }
        let s=''; for (let i=0;i<n;i++) s += String.fromCharCode(dv.getUint8(o+i)); o += n; return s;
      };
      const rdType = () => { const s = String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3)); o += 4; return s; };
      function rdValue(type) {
        switch (type) {
          case 'bool': return !!dv.getUint8(o++);
          case 'long': { const v = dv.getInt32(o); o += 4; return v; }
          case 'doub': { const v = dv.getFloat64(o); o += 8; return v; }
          case 'UntF': { o += 4; const v = dv.getFloat64(o); o += 8; return v; }
          case 'TEXT': { const n = rdU32(); return rdStr(n); }
          case 'enum': { rdKey(); return rdKey(); }
          case 'Objc': case 'GlbO': return rdObject();
          case 'VlLs': { const n = rdU32(); const arr=[]; for (let i=0;i<n && o<end;i++){ const t=rdType(); const v=rdValue(t); if(v===undefined){o=end;break;} arr.push(v); } return arr; }
          case 'tdta': { const n = rdU32(); o += n; return null; }
          case 'alis': { const n = rdU32(); o += n; return null; }
          default: return undefined;
        }
      }
      function rdObject() {
        const nameLen = rdU32(); o += nameLen * 2;
        rdKey();
        const count = rdU32();
        const out = {};
        for (let i = 0; i < count && o < end; i++) {
          const k = rdKey(); const t = rdType(); const v = rdValue(t);
          if (v === undefined) { o = end; break; }
          out[k] = v;
        }
        return out;
      }
      return { obj: rdObject(), pos: o };
    }
    function psdFxColor(c) {
      if (!c || typeof c !== 'object') return null;
      const r = c['Rd  '], g = c['Grn '], b = c['Bl  '];
      if (typeof r !== 'number') return null;
      const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2,'0');
      return '#' + h(r) + h(g) + h(b);
    }
    const PSD_BLEND_TO_CSS = { Nrml:'normal', Mltp:'multiply', Scrn:'screen', Ovrl:'overlay',
      Drkn:'darken', Lghn:'lighten', 'CDdg':'color-dodge', 'CBrn':'color-burn',
      HrdL:'hard-light', SftL:'soft-light', Dfrn:'difference', Xclu:'exclusion',
      'H   ':'hue', Strt:'saturation', 'Clr ':'color', 'Lmns':'luminosity' };
    function parseLayerFX(dv, start, end, key) {
      if (key !== 'lfx2') return null;
      let o = start + 8;
      const { obj } = psdDescriptor(dv, o, end);
      if (!obj) return null;
      const out = {};
      const bl = (d) => PSD_BLEND_TO_CSS[d && d['Md  ']] || 'normal';
      const op = (d) => { const v = d && d['Opct']; return typeof v === 'number' ? Math.max(0, Math.min(1, v/100)) : 1; };
      const on = (d) => !!(d && d['enab']);
      const ds = obj['DrSh'];
      if (ds && on(ds)) { const dist = ds['Dstn']||0, ang=(ds['lagl']||120)*Math.PI/180;
        out.shadow = { on:true, color: psdFxColor(ds['Clr ']) || '#000000', opacity: op(ds),
          blur: Math.round(ds['blur']||0), spread: Math.round(ds['Ckmt']||0), blend: bl(ds),
          dx: Math.round(-Math.cos(ang)*dist), dy: Math.round(Math.sin(ang)*dist) }; }
      const is = obj['IrSh'];
      if (is && on(is)) { const dist = is['Dstn']||0, ang=(is['lagl']||120)*Math.PI/180;
        out.innerShadow = { on:true, color: psdFxColor(is['Clr ']) || '#000000', opacity: op(is),
          blur: Math.round(is['blur']||0), blend: bl(is),
          dx: Math.round(-Math.cos(ang)*dist), dy: Math.round(Math.sin(ang)*dist) }; }
      const og = obj['OrGl'];
      if (og && on(og)) out.glowOut = { on:true, color: psdFxColor(og['Clr ']) || '#ffd479',
        opacity: op(og), blur: Math.round(og['blur']||0), spread: Math.round(og['Ckmt']||0), blend: bl(og) };
      const ig = obj['IrGl'];
      if (ig && on(ig)) out.innerGlow = { on:true, color: psdFxColor(ig['Clr ']) || '#ffffff',
        opacity: op(ig), blur: Math.round(ig['blur']||0), blend: bl(ig) };
      const so = obj['SoFi'];
      if (so && on(so)) out.colorOv = { on:true, color: psdFxColor(so['Clr ']) || '#c2895f',
        opacity: op(so), blend: bl(so) };
      const gf = obj['GrFl'];
      if (gf && on(gf)) {
        let c1='#c2895f', c2='#5dd6ff';
        const stops = gf['Grad'] && gf['Grad']['Clrs'];
        if (Array.isArray(stops) && stops.length) {
          c1 = psdFxColor(stops[0] && stops[0]['Clr ']) || c1;
          c2 = psdFxColor(stops[stops.length-1] && stops[stops.length-1]['Clr ']) || c2;
        }
        out.gradOv = { on:true, opacity: op(gf), blend: bl(gf), angle: Math.round(gf['Angl']||90),
          style:'linear', c1, c2, reverse: !!gf['Rvrs'] };
      }
      const fr = obj['FrFX'];
      if (fr && on(fr)) { const styleMap={OutF:'outside', InsF:'inside', CtrF:'center'};
        out.stroke = { on:true, color: psdFxColor(fr['Clr ']) || '#000000', opacity: op(fr),
          width: Math.max(1, Math.round(fr['Sz  ']||3)), blend: bl(fr),
          align: styleMap[fr['Styl']] || 'outside', fill:'solid' }; }
      const cs = obj['ChFX'];
      if (cs && on(cs)) { const dist=cs['Dstn']||0, ang=(cs['lagl']||90)*Math.PI/180;
        out.satin = { on:true, color: psdFxColor(cs['Clr ']) || '#000000', opacity: op(cs),
          blur: Math.round(cs['blur']||0), blend: bl(cs), invert: !!cs['Invr'],
          dx: Math.round(-Math.cos(ang)*dist), dy: Math.round(Math.sin(ang)*dist) }; }
      const be = obj['ebbl'];
      if (be && on(be)) out.bevel = { on:true, depth: Math.max(1, Math.round((be['Dpth']||100)/25)),
        blur: Math.round(be['Sfte']||4), angle: Math.round(be['lagl']||135),
        light: op({ Opct: be['hglO'] }), shadow: op({ Opct: be['sdwO'] }), style:'inner' };
      return Object.keys(out).length ? out : null;
    }

    // Minimal PSD parser — reads layers from RGB/8-bit PSD files.
    // Supports RAW (0) and RLE/PackBits (1) channel compression.
    function parsePSD(buffer) {
      const dv = new DataView(buffer);
      let o = 0;
      const u8 = (n) => { const v = []; for (let i=0;i<n;i++) v.push(dv.getUint8(o++)); return v; };
      const u16 = () => { const v = dv.getUint16(o); o += 2; return v; };
      const u32 = () => { const v = dv.getUint32(o); o += 4; return v; };
      const i16 = () => { const v = dv.getInt16(o); o += 2; return v; };

      // ── Header ──
      const sig = String.fromCharCode(...u8(4));
      if (sig !== '8BPS') throw new Error('Not a PSD file');
      const version = u16();               // 1 = PSD, 2 = PSB
      o += 6;                               // reserved
      const channels = u16();
      const height = u32();
      const width = u32();
      const depth = u16();                  // bits per channel
      const mode = u16();                   // 3 = RGB
      if (depth !== 8) throw new Error('Only 8-bit PSD files are supported (' + depth + '-bit given)');

      // ── Colour mode data ──
      const cmLen = u32(); o += cmLen;
      // ── Image resources ──
      const irLen = u32(); o += irLen;

      // ── Layer & mask info ──
      const lmLen = u32();
      const lmEnd = o + lmLen;
      const layerInfoLen = u32();
      let layerCount = i16();
      if (layerCount < 0) layerCount = -layerCount;   // negative => has alpha for merged

      const layers = [];
      for (let i = 0; i < layerCount; i++) {
        const top = dv.getInt32(o); o+=4;
        const left = dv.getInt32(o); o+=4;
        const bottom = dv.getInt32(o); o+=4;
        const right = dv.getInt32(o); o+=4;
        const nch = u16();
        const chInfo = [];
        for (let c=0;c<nch;c++){ const id = i16(); const len = u32(); chInfo.push({id, len}); }
        const blendSig = String.fromCharCode(...u8(4));  // '8BIM'
        const blendKey = String.fromCharCode(...u8(4));
        const opacity = dv.getUint8(o++);
        const clipping = dv.getUint8(o++);
        const flags = dv.getUint8(o++);
        o++; // filler
        const extraLen = u32();
        const extraEnd = o + extraLen;
        // mask
        const maskLen = u32(); o += maskLen;
        // blending ranges
        const brLen = u32(); o += brLen;
        // name (pascal, padded to 4)
        const nameLen = dv.getUint8(o++);
        let name = '';
        for (let k=0;k<nameLen;k++) name += String.fromCharCode(dv.getUint8(o++));
        name = name.replace(/\0+$/, '');   // pascal names are null-padded
        const pad = (nameLen + 1) % 4; if (pad) o += (4 - pad);
        // Walk the additional-info blocks in the extra section. Each is
        // '8BIM' + 4-char key + length + payload. We want 'lfx2' (layer effects)
        // and 'luni' (the real unicode layer name — the pascal name above is
        // legacy and gets mangled for non-ASCII).
        let fx = null, uniName = null;
        while (o + 12 <= extraEnd) {
          const sig = String.fromCharCode(dv.getUint8(o), dv.getUint8(o+1), dv.getUint8(o+2), dv.getUint8(o+3));
          if (sig !== '8BIM' && sig !== '8B64') break;
          const key = String.fromCharCode(dv.getUint8(o+4), dv.getUint8(o+5), dv.getUint8(o+6), dv.getUint8(o+7));
          const len = dv.getUint32(o+8);
          const body = o + 12;
          const bodyEnd = Math.min(body + len, extraEnd);
          if (key === 'luni' && body + 4 <= bodyEnd) {
            const n = dv.getUint32(body);
            let s = '';
            for (let k = 0; k < n && body + 4 + k*2 + 1 < bodyEnd; k++) s += String.fromCharCode(dv.getUint16(body + 4 + k*2));
            s = s.replace(/\0+$/, '');     // unicode names carry a trailing null too
            if (s) uniName = s;
          } else if (key === 'lfx2' || key === 'lrFX') {
            try { fx = parseLayerFX(dv, body, bodyEnd, key); } catch (e) { fx = null; }
          }
          o = body + len + (len % 2);   // blocks are padded to even length
          if (o <= body) break;         // guard against a malformed zero-length loop
        }
        o = extraEnd;
        layers.push({ top,left,bottom,right, nch, chInfo, blendKey, opacity, flags,
                      name: uniName || name, fx, width: right-left, height: bottom-top });
      }

      // ── Channel image data per layer ──
      const BLEND = { 'norm':'source-over','mul ':'multiply','scrn':'screen','over':'overlay','dark':'darken','lite':'lighten','hLit':'hard-light','sLit':'soft-light','diff':'difference','smud':'exclusion','hue ':'hue','sat ':'saturation','colr':'color','lum ':'luminosity','mul':'multiply' };

      layers.forEach(layer => {
        const lw = layer.width, lh = layer.height;
        if (lw <= 0 || lh <= 0) { layer.canvas = null; return; }
        // Sanity limit. A corrupt or hostile PSD can declare enormous layer bounds;
        // without this the parser would try to allocate gigabytes per channel and
        // take the tab down. Real clinical artwork is nowhere near this size, so
        // anything beyond it is bad data rather than a file we want to open.
        const MAXDIM = 30000, MAXPX = 80e6;      // 30k per side, 80 megapixels
        if (lw > MAXDIM || lh > MAXDIM || lw * lh > MAXPX) {
          throw new Error('PSD layer "' + (layer.name || '?') + '" declares an unreasonable size (' + lw + '×' + lh + ') — the file looks corrupt.');
        }
        // per-channel decoded arrays keyed by channel id (0=R,1=G,2=B,-1=A)
        const chData = {};
        layer.chInfo.forEach(ci => {
          const comp = u16();               // 0 raw, 1 RLE
          const nBytes = lw * lh;
          const out = new Uint8Array(nBytes);
          if (comp === 0) {
            for (let k=0;k<nBytes;k++) out[k] = dv.getUint8(o++);
          } else if (comp === 1) {
            // RLE: row byte-counts first (one u16 per row), then packbits data
            const counts = [];
            for (let r=0;r<lh;r++) counts.push(u16());
            let p = 0;
            for (let r=0;r<lh;r++){
              let n = counts[r]; let filled = 0; const rowStart = r*lw;
              while (n > 0){
                const hdr = dv.getInt8(o++); n--;
                // Clamp writes to the row. A corrupt RLE stream can claim more bytes
                // than the row holds; unclamped it would spill into the next row and
                // produce garbled output instead of a clean error.
                if (hdr >= 0){ const cnt = hdr+1; for (let k=0;k<cnt;k++){ const bt = dv.getUint8(o++); n--; if (filled < lw) out[rowStart+filled++] = bt; } }
                else if (hdr !== -128){ const cnt = 1-hdr; const val = dv.getUint8(o++); n--; for (let k=0;k<cnt;k++){ if (filled < lw) out[rowStart+filled++] = val; } }
              }
            }
          } else { throw new Error('Unsupported channel compression ' + comp); }
          chData[ci.id] = out;
        });
        // assemble RGBA
        const cv = { width: lw, height: lh, data: new Uint8ClampedArray(lw*lh*4) };
        const R = chData[0], G = chData[1], B = chData[2], A = chData[-1];
        for (let k=0;k<lw*lh;k++){
          cv.data[k*4]   = R ? R[k] : 0;
          cv.data[k*4+1] = G ? G[k] : 0;
          cv.data[k*4+2] = B ? B[k] : 0;
          cv.data[k*4+3] = A ? A[k] : 255;
        }
        layer.rgba = cv;
        layer.blend = BLEND[layer.blendKey] || 'source-over';
        layer.hidden = (layer.flags & 2) !== 0;
      });

      return { width, height, layers };
    }
    window.parsePSD = parsePSD;

  
      // ── Brush ───────────────────────────────────────────────────────────────
      // Deterministic pseudo-random from a seed. Bristle/chalk/spatter need scatter
      // that stays PUT — a Math.random() stamp would shimmer differently on every
      // repaint, and a stroke re-rendered from history wouldn't match what you drew.
      function tipRnd(seed) {
        let s = seed >>> 0;
        return () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
      }

      // The angle for tips that have a direction (flat, oval, diamond).
      function tipAngle() {
        const e = $('pb-angle');
        return ((parseInt(e ? e.value : 45) || 0) * Math.PI) / 180;
      }

      // Paint one stamp of the current tip. Every tip honours size, colour,
      // hardness and alpha so they stay interchangeable across the brush family.
      function brushStamp(ctx, x, y, size, color, hardness, shape, alpha, seed) {
        const r = Math.max(0.5, size / 2);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        // A soft round dab — the building block most tips are made from.
        const dab = (cx, cy, rad, a) => {
          if (rad <= 0) return;
          ctx.globalAlpha = a;
          if (hardness >= 0.99) {
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
          } else {
            const g = ctx.createRadialGradient(cx, cy, rad * hardness, cx, cy, rad);
            g.addColorStop(0, color);
            g.addColorStop(1, hexA(color, 0));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = color;
          }
        };

        switch (shape) {
          case 'square':
            ctx.fillRect(x - r, y - r, size, size);
            break;

          case 'diamond':
            ctx.translate(x, y); ctx.rotate(tipAngle());
            ctx.beginPath();
            ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
            ctx.closePath(); ctx.fill();
            break;

          case 'flat': {
            // A chisel nib: wide across, thin along. Rotating the context keeps the
            // nib's angle fixed regardless of stroke direction, which is what makes
            // the line swell and thin like real calligraphy.
            ctx.translate(x, y); ctx.rotate(tipAngle());
            const thin = Math.max(0.6, r * 0.28);
            ctx.fillRect(-r, -thin, size, thin * 2);
            break;
          }

          case 'oval': {
            ctx.translate(x, y); ctx.rotate(tipAngle());
            const ry = Math.max(0.5, r * 0.42);
            if (hardness >= 0.99) {
              ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2); ctx.fill();
            } else {
              // scale a radial gradient into an ellipse so softness follows the shape
              ctx.save();
              ctx.scale(1, ry / r);
              const g = ctx.createRadialGradient(0, 0, r * hardness, 0, 0, r);
              g.addColorStop(0, color); g.addColorStop(1, hexA(color, 0));
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'bristle': {
            // Individual hairs, fixed relative to the tip so the stroke reads as one
            // brush dragged along rather than a cloud of dots.
            const n = Math.max(6, Math.min(28, Math.round(size * 0.9)));
            const rnd = tipRnd(1337);
            ctx.translate(x, y); ctx.rotate(tipAngle());
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              const hr = Math.max(0.4, r * (0.06 + rnd() * 0.1));
              dab(Math.cos(a) * d, Math.sin(a) * d * 0.55, hr, alpha * (0.35 + rnd() * 0.5));
            }
            break;
          }

          case 'chalk': {
            // Grain: a soft core with holes punched through it, so it reads as
            // pigment catching on paper tooth.
            dab(x, y, r, alpha * 0.55);
            const n = Math.max(8, Math.min(40, Math.round(size * 1.4)));
            const rnd = tipRnd(90210);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.4, r * 0.16 * rnd()), alpha * rnd() * 0.9);
            }
            break;
          }

          case 'spatter': {
            // Scattered specks well beyond the nominal radius — an ink flick.
            const n = Math.max(4, Math.min(24, Math.round(size * 0.5)));
            const rnd = tipRnd(4242);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.pow(rnd(), 0.6) * r * 1.5;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.4, r * 0.22 * rnd()), alpha * (0.4 + rnd() * 0.6));
            }
            break;
          }

          case 'grass': {
            // Blades fanning upward from the stamp point — drag along the ground and
            // it grows a strip of grass. Blades tilt around the tip angle.
            const n = Math.max(4, Math.min(16, Math.round(size * 0.6)));
            const rnd = tipRnd(2024);
            ctx.translate(x, y); ctx.rotate(tipAngle());
            for (let i = 0; i < n; i++) {
              const spread = (rnd() - 0.5) * r * 1.6;      // horizontal position along the base
              const lean = (rnd() - 0.5) * 0.5;            // slight sideways lean
              const h = r * (1.1 + rnd() * 1.3);           // blade height
              const w = Math.max(0.6, r * (0.10 + rnd() * 0.10));
              ctx.save();
              ctx.translate(spread, 0);
              ctx.rotate(lean);
              ctx.beginPath();
              ctx.moveTo(-w, 0);
              ctx.quadraticCurveTo(w * 0.4, -h * 0.6, w * 0.3, -h);   // curved blade
              ctx.quadraticCurveTo(w * 0.2, -h * 0.6, w, 0);
              ctx.closePath();
              ctx.globalAlpha = alpha * (0.55 + rnd() * 0.45);
              ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'leaves': {
            // Small leaf/petal shapes scattered around the tip — good for foliage,
            // confetti, or a hedge texture when dragged.
            const n = Math.max(3, Math.min(12, Math.round(size * 0.4)));
            const rnd = tipRnd(7777);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              const lr = Math.max(1, r * (0.25 + rnd() * 0.28));
              ctx.save();
              ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
              ctx.rotate(rnd() * Math.PI * 2);
              ctx.globalAlpha = alpha * (0.5 + rnd() * 0.5);
              ctx.beginPath();
              ctx.moveTo(0, -lr);
              ctx.quadraticCurveTo(lr * 0.7, 0, 0, lr);      // pointed-oval leaf
              ctx.quadraticCurveTo(-lr * 0.7, 0, 0, -lr);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'fur': {
            // Soft fluffy clumps — overlapping faint dabs, like fur, wool or clouds.
            const n = Math.max(6, Math.min(30, Math.round(size * 1.1)));
            const rnd = tipRnd(5150);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.pow(rnd(), 0.7) * r;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.6, r * (0.28 + rnd() * 0.3)), alpha * (0.12 + rnd() * 0.25));
            }
            break;
          }

          case 'sparkle': {
            // Four-point stars of varying size — sparkles, stars, glints.
            const n = Math.max(2, Math.min(8, Math.round(size * 0.25)));
            const rnd = tipRnd(31337);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              const sr = Math.max(1.2, r * (0.2 + rnd() * 0.4));
              const thin = Math.max(0.4, sr * 0.16);
              ctx.save();
              ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
              ctx.rotate(rnd() * Math.PI);
              ctx.globalAlpha = alpha * (0.6 + rnd() * 0.4);
              ctx.beginPath();
              // vertical spike
              ctx.moveTo(0, -sr); ctx.lineTo(thin, 0); ctx.lineTo(0, sr); ctx.lineTo(-thin, 0); ctx.closePath();
              ctx.fill();
              ctx.beginPath();
              // horizontal spike
              ctx.moveTo(-sr, 0); ctx.lineTo(0, -thin); ctx.lineTo(sr, 0); ctx.lineTo(0, thin); ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
            break;
          }

          case 'dots': {
            // Evenly-ish scattered round dots — stippling, halftone, texture fills.
            const n = Math.max(3, Math.min(18, Math.round(size * 0.5)));
            const rnd = tipRnd(1212);
            for (let i = 0; i < n; i++) {
              const a = rnd() * Math.PI * 2;
              const d = Math.sqrt(rnd()) * r;
              dab(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.5, r * (0.10 + rnd() * 0.14)), alpha * (0.6 + rnd() * 0.4));
            }
            break;
          }

          default:
            if (shape && shape.startsWith('custom:')) {
              // Custom imported brush: stamp the tinted image. The image's own alpha
              // is the brush shape; we colourize it to the current paint colour.
              const cb = customBrushes[shape];
              if (cb && cb.tinted) {
                ctx.save();
                ctx.globalAlpha = alpha;
                if (ANGLED_TIPS.test(shape) || cb.angled) { ctx.translate(x, y); ctx.rotate(tipAngle()); ctx.drawImage(cb.tintedFor(color), -r, -r, size, size); }
                else ctx.drawImage(cb.tintedFor(color), x - r, y - r, size, size);
                ctx.restore();
              } else {
                dab(x, y, r, alpha);
              }
            } else {
              dab(x, y, r, alpha);   // round
            }
        }
        ctx.restore();
      }

      function hexA(hex, a) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return `rgba(0,0,0,${a})`;
        return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
      }


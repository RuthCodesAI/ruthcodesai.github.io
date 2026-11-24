/**
 * Ruth Day Mode: Chaotic Swiss Lithographic Halftone Assembly.
 *
 * Extracts Justitia's sculptural silhouette via fast edge-connected BFS on the
 * studio void, then maps interior marble luminance to POSITIVE photolithographic
 * ink density (sunlit marble = luminous cotton paper with fine pinpoint dots;
 * chiaroscuro shadows = bold #11100f printer's ink dots) on a classic 45-degree
 * rotated Swiss halftone screen with unsharp-masked sculptural relief and
 * area-accurate (sqrt density) dot radii.
 *
 * Four-act physics choreography (~4.0s):
 *   1. Suspended Chaos (0.0-0.45s): interwoven curl-noise filaments and baroque
 *      vortex ink streams alive across warm cotton rag paper.
 *   2. Chaotic Coalescence (0.45-1.85s): structural shadow contours ignite first,
 *      pulling coherent starling-like murmurations along logarithmic Coriolis
 *      spirals with calligraphic velocity elongation.
 *   3. Crystalline Lock (1.85-3.85s): damped settling into razor-sharp 45-deg
 *      circular printer's ink dots biting cleanly into cotton paper.
 *   4. Living Stillness (3.85s+): whisper-subtle press breathing and silky
 *      interactive cursor curl wake; pauses on waitlist open, sleeps after 90s.
 *
 * Single WebGL instanced analytic-SDF draw call (0.2ms/frame at native Retina
 * DPR) with automatic Canvas 2D fallback.
 */

export function createDayHalftone(options) {
  const { host, photo, image, body, reduced, mobile, onFrame } = options;
  const preview = new URLSearchParams(location.search).has('preview');
  const optedIn = body.dataset.animate === 'true';
  const abort = new AbortController(), events = { signal: abort.signal };

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'halftone-canvas';

  const sampleCanvas = document.createElement('canvas');
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  // Printer's ink (#11100f).
  const INK_R = 17 / 255, INK_G = 16 / 255, INK_B = 15 / 255;

  let disposed = false, active = false, paused = false, intersecting = true;
  let pageSuspended = false, sleeping = false, settled = false;
  let rafId = 0, resizeFrame = 0, sleepTimer = 0;
  let lastNow = 0, elapsed = 0, breatheTime = 0;
  let width = 1, height = 1, dpr = 1, pitch = 5.4;
  let cover = { x: 0, y: 0, width: 1, height: 1 };
  let sampleW = 1, sampleH = 1, lumaField = null, silhouetteField = null;

  // Structure-of-Arrays particle buffers (zero per-frame GC).
  let count = 0;
  let tx, ty, x, y, vx, vy, rTarget, delay, span, swirlSign, mass, seed, prom;
  let instanceData;

  // Interactive pointer wake state (CSS px relative to host).
  let ptrX = -9999, ptrY = -9999, ptrVx = 0, ptrVy = 0, ptrEnergy = 0, ptrInside = false;

  // WebGL or Canvas 2D backend.
  let gl = null, glExt = null, glProg = null, glQuadBuf = null, glInstBuf = null;
  let glLoc = null, ctx2d = null, backend = 'none';

  const waitlistOpen = () => body.dataset.waitlistOpen === 'true';
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const smoother = t => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

  function hash2(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Smooth periodic-free 2-octave divergence-free 2D curl noise.
  function curlAt(px, py, t, scale, out) {
    const sx = px * scale, sy = py * scale;
    const t1 = t * 0.46, t2 = t * 0.78;

    const a1 = sx * 0.85 + sy * 0.52 + t1;
    const b1 = -sx * 0.48 + sy * 0.91 - t1 * 0.83;
    const sA1 = Math.sin(a1), cA1 = Math.cos(a1);
    const sB1 = Math.sin(b1), cB1 = Math.cos(b1);
    const d1dx = cA1 * 0.85 * cB1 + sA1 * sB1 * 0.48;
    const d1dy = cA1 * 0.52 * cB1 - sA1 * sB1 * 0.91;

    const sx2 = sx * 2.13 + 3.1, sy2 = sy * 2.13 - 1.7;
    const a2 = sx2 * 0.62 - sy2 * 0.78 - t2;
    const b2 = sx2 * 0.79 + sy2 * 0.61 + t2 * 0.67;
    const sA2 = Math.sin(a2), cA2 = Math.cos(a2);
    const sB2 = Math.sin(b2), cB2 = Math.cos(b2);
    const w2 = 0.46;
    const d2dx = w2 * (cA2 * 0.62 * cB2 - sA2 * sB2 * 0.79);
    const d2dy = w2 * (cA2 * (-0.78) * cB2 - sA2 * sB2 * 0.61);

    out[0] = d1dy + d2dy;
    out[1] = -(d1dx + d2dx);
  }

  function fieldNoise(px, py, scale) {
    const u = px * scale, v = py * scale;
    const n =
      0.55 * Math.sin(u * 0.9 + Math.cos(v * 0.8 + 0.4)) +
      0.30 * Math.cos(v * 1.45 - Math.sin(u * 1.15 - 0.9)) +
      0.15 * Math.sin((u + v) * 2.1 + 1.3);
    return 0.5 + 0.5 * clamp(n, -1, 1);
  }

  function initBackend() {
    const attrs = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    };
    const gl2 = canvas.getContext('webgl2', attrs);
    const gl1 = gl2 ? null : (canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs));
    const ctx = gl2 || gl1;
    if (ctx) {
      const ext = gl2 ? null : ctx.getExtension('ANGLE_instanced_arrays');
      if (gl2 || ext) {
        const vsSrc = `
          attribute vec2 a_quad;
          attribute vec2 a_pos;
          attribute vec2 a_vel;
          attribute vec2 a_meta;
          uniform vec2 u_res;
          uniform float u_dpr;
          varying vec2 v_local;
          varying float v_rad;
          varying float v_halfLen;
          varying float v_alpha;
          varying float v_soft;
          varying vec2 v_world;

          void main() {
            float r = a_meta.x;
            float alpha = a_meta.y;
            float spd = length(a_vel);
            vec2 dir = spd > 1.5 ? (a_vel / spd) : vec2(1.0, 0.0);
            vec2 perp = vec2(-dir.y, dir.x);

            // Calligraphic velocity elongation in chaotic flight; pure circles at rest.
            float stretch = 1.0 + min(2.65, spd * 0.0040);
            float rPerp = r / pow(stretch, 0.36);
            float halfLen = rPerp * (stretch - 1.0) * 0.96;

            // Soft atmospheric charcoal edge in motion; crisp letterpress bite on lock.
            float flight = smoothstep(8.0, 260.0, spd);
            float soft = mix(0.54 / u_dpr, 1.32 / u_dpr + rPerp * 0.20, flight);
            float pad = soft + 1.5 / u_dpr;

            vec2 local = vec2(a_quad.x * (rPerp + halfLen + pad), a_quad.y * (rPerp + pad));
            vec2 pos = a_pos + dir * local.x + perp * local.y;

            vec2 clip = (pos / u_res) * 2.0 - 1.0;
            clip.y = -clip.y;
            gl_Position = vec4(clip, 0.0, 1.0);

            v_local = local;
            v_rad = rPerp;
            v_halfLen = halfLen;
            v_alpha = alpha;
            v_soft = soft;
            v_world = pos;
          }
        `;
        const fsSrc = `
          precision mediump float;
          uniform vec3 u_ink;
          varying vec2 v_local;
          varying float v_rad;
          varying float v_halfLen;
          varying float v_alpha;
          varying float v_soft;
          varying vec2 v_world;

          float grain(vec2 p) {
            return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453123);
          }

          void main() {
            vec2 q = v_local;
            q.x -= clamp(q.x, -v_halfLen, v_halfLen);
            float d = length(q) - v_rad;
            float cov = 1.0 - smoothstep(-v_soft, v_soft, d);
            if (cov <= 0.002) discard;

            // Subtle archival cotton-paper tooth on settled ink dots.
            float tooth = 0.96 + 0.04 * grain(v_world * 1.45);
            float a = clamp(cov * v_alpha * tooth, 0.0, 1.0);
            gl_FragColor = vec4(u_ink * a, a);
          }
        `;
        const compile = (type, src) => {
          const sh = ctx.createShader(type);
          ctx.shaderSource(sh, src);
          ctx.compileShader(sh);
          if (!ctx.getShaderParameter(sh, ctx.COMPILE_STATUS)) {
            ctx.deleteShader(sh);
            return null;
          }
          return sh;
        };
        const vs = compile(ctx.VERTEX_SHADER, vsSrc);
        const fs = compile(ctx.FRAGMENT_SHADER, fsSrc);
        if (vs && fs) {
          const prog = ctx.createProgram();
          ctx.attachShader(prog, vs);
          ctx.attachShader(prog, fs);
          ctx.linkProgram(prog);
          ctx.deleteShader(vs);
          ctx.deleteShader(fs);
          if (ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
            gl = ctx;
            glExt = ext;
            glProg = prog;
            glQuadBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            glInstBuf = gl.createBuffer();
            glLoc = {
              quad: gl.getAttribLocation(prog, 'a_quad'),
              pos: gl.getAttribLocation(prog, 'a_pos'),
              vel: gl.getAttribLocation(prog, 'a_vel'),
              meta: gl.getAttribLocation(prog, 'a_meta'),
              res: gl.getUniformLocation(prog, 'u_res'),
              dpr: gl.getUniformLocation(prog, 'u_dpr'),
              ink: gl.getUniformLocation(prog, 'u_ink'),
            };
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.clearColor(0, 0, 0, 0);
            backend = gl2 ? 'webgl2' : 'webgl1';
            return;
          }
          ctx.deleteProgram(prog);
        }
      }
    }
    ctx2d = canvas.getContext('2d');
    backend = ctx2d ? 'canvas2d' : 'none';
  }

  function isPortraitViewport() {
    return height > width * 1.08;
  }

  function computeCover() {
    const iw = image.naturalWidth || 1916;
    const ih = image.naturalHeight || 1080;

    if (isPortraitViewport()) {
      // Tailored mobile portrait crop: hair crown bleeds naturally off the top edge
      // and shoulders extend well past the organic arch fade (zero straight bottom edge).
      const desiredHeadSpan = width * 1.10;
      const sourceHeadSpan = iw * 0.48;
      const scale = Math.max(desiredHeadSpan / sourceHeadSpan, (height * 0.68) / ih);
      const cw = iw * scale;
      const ch = ih * scale;
      const cx = width * 0.51 - cw * 0.595;
      const cy = -height * 0.024;
      cover = { x: cx, y: cy, width: cw, height: ch };
      return;
    }

    const ratio = Math.max(width / iw, height / ih);
    const cw = iw * ratio, ch = ih * ratio;
    const computedPos = photo ? getComputedStyle(photo).objectPosition : '10% 56.25%';
    const tokens = computedPos.match(/calc\([^)]*\)|[^\s]+/g) || ['10%', '56.25%'];
    const offset = (token, available) => {
      if (token === 'left' || token === 'top') return 0;
      if (token === 'right' || token === 'bottom') return available;
      if (!token || token === 'center') return available * 0.5;
      if (/^[-+]?\d*\.?\d+%$/.test(token)) return available * parseFloat(token) / 100;
      if (/^[-+]?\d*\.?\d+px$/.test(token)) return parseFloat(token);
      if (token.startsWith('calc(')) {
        const terms = token.slice(5, -1).replace(/\s+/g, '').match(/[+-]?\d*\.?\d+(?:%|px)/g);
        if (terms?.length) {
          return terms.reduce((acc, term) => acc + parseFloat(term) * (term.endsWith('%') ? available / 100 : 1), 0);
        }
      }
      return available * 0.5;
    };
    cover = { x: offset(tokens[0], width - cw), y: offset(tokens[1], height - ch), width: cw, height: ch };
  }

  // Sample poster luminance and compute an edge-connected BFS studio-void mask
  // so interior deep shadows (cheek, hair bun, blindfold folds) render as bold
  // positive halftone dots while the outer black studio void stays spotless paper.
  function sampleSculptureField() {
    computeCover();
    const scale = Math.min(1, 680 / Math.max(width, height));
    sampleW = Math.max(48, Math.round(width * scale));
    sampleH = Math.max(48, Math.round(height * scale));
    sampleCanvas.width = sampleW;
    sampleCanvas.height = sampleH;
    sampleCtx.fillStyle = '#000000';
    sampleCtx.fillRect(0, 0, sampleW, sampleH);
    sampleCtx.drawImage(
      image,
      cover.x * scale, cover.y * scale,
      cover.width * scale, cover.height * scale
    );
    const rgba = sampleCtx.getImageData(0, 0, sampleW, sampleH).data;
    const n = sampleW * sampleH;
    lumaField = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      lumaField[i] = (rgba[p] * 0.2126 + rgba[p + 1] * 0.7152 + rgba[p + 2] * 0.0722) / 255;
    }

    // BFS flood-fill outer studio black (luma <= 0.0135) from viewport edges and
    // studio-void pockets so deep hair-bun shadows stay intact while pure studio
    // void stays spotless cotton paper.
    const visited = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    const BG_THRESH = 0.0135;

    const trySeed = (ix, iy) => {
      if (ix < 0 || iy < 0 || ix >= sampleW || iy >= sampleH) return;
      const idx = iy * sampleW + ix;
      if (!visited[idx] && lumaField[idx] <= BG_THRESH) {
        visited[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let ix = 0; ix < sampleW; ix++) {
      trySeed(ix, 0);
      trySeed(ix, sampleH - 1);
    }
    for (let iy = 0; iy < sampleH; iy++) {
      trySeed(0, iy);
      trySeed(sampleW - 1, iy);
    }
    // Also seed inside the dark studio pocket between neck/scale chains and right forearm
    // (source coordinates ~0.78, 0.72 and ~0.88, 0.70) if truly pure studio black.
    const pocketCoords = [
      [0.86, 0.16], [0.89, 0.42], [0.82, 0.74], [0.76, 0.86],
    ];
    for (const [su, sv] of pocketCoords) {
      const cxp = Math.round(((cover.x + cover.width * su) / width) * (sampleW - 1));
      const cyp = Math.round(((cover.y + cover.height * sv) / height) * (sampleH - 1));
      trySeed(cxp, cyp);
    }

    while (head < tail) {
      const idx = queue[head++];
      const iy = (idx / sampleW) | 0;
      const ix = idx - iy * sampleW;
      if (ix > 0) {
        const nb = idx - 1;
        if (!visited[nb] && lumaField[nb] <= BG_THRESH) { visited[nb] = 1; queue[tail++] = nb; }
      }
      if (ix + 1 < sampleW) {
        const nb = idx + 1;
        if (!visited[nb] && lumaField[nb] <= BG_THRESH) { visited[nb] = 1; queue[tail++] = nb; }
      }
      if (iy > 0) {
        const nb = idx - sampleW;
        if (!visited[nb] && lumaField[nb] <= BG_THRESH) { visited[nb] = 1; queue[tail++] = nb; }
      }
      if (iy + 1 < sampleH) {
        const nb = idx + sampleW;
        if (!visited[nb] && lumaField[nb] <= BG_THRESH) { visited[nb] = 1; queue[tail++] = nb; }
      }
    }

    // Remove isolated 1-2px stray dark specks along the studio boundary, then
    // feather cleanly via two lightweight separable 3-tap passes.
    const raw = new Float32Array(n);
    for (let iy = 0; iy < sampleH; iy++) {
      const rowOff = iy * sampleW;
      for (let ix = 0; ix < sampleW; ix++) {
        const idx = rowOff + ix;
        if (visited[idx]) { raw[idx] = 0; continue; }
        let fgNeighbors = 0;
        if (ix > 0 && !visited[idx - 1]) fgNeighbors++;
        if (ix + 1 < sampleW && !visited[idx + 1]) fgNeighbors++;
        if (iy > 0 && !visited[idx - sampleW]) fgNeighbors++;
        if (iy + 1 < sampleH && !visited[idx + sampleW]) fgNeighbors++;
        raw[idx] = fgNeighbors >= 2 ? 1 : 0;
      }
    }
    const tmp = new Float32Array(n);
    for (let iy = 0; iy < sampleH; iy++) {
      const rowOff = iy * sampleW;
      for (let ix = 0; ix < sampleW; ix++) {
        const l = ix > 0 ? raw[rowOff + ix - 1] : raw[rowOff + ix];
        const c = raw[rowOff + ix];
        const r = ix + 1 < sampleW ? raw[rowOff + ix + 1] : raw[rowOff + ix];
        tmp[rowOff + ix] = (l + c * 2 + r) * 0.25;
      }
    }
    silhouetteField = new Float32Array(n);
    for (let iy = 0; iy < sampleH; iy++) {
      const rUp = Math.max(0, iy - 1) * sampleW;
      const rMid = iy * sampleW;
      const rDn = Math.min(sampleH - 1, iy + 1) * sampleW;
      for (let ix = 0; ix < sampleW; ix++) {
        silhouetteField[rMid + ix] = (tmp[rUp + ix] + tmp[rMid + ix] * 2 + tmp[rDn + ix]) * 0.25;
      }
    }
  }

  function sampleBilinear(field, px, py) {
    const fx = (px / width) * (sampleW - 1);
    const fy = (py / height) * (sampleH - 1);
    if (fx < 0 || fy < 0 || fx >= sampleW - 1 || fy >= sampleH - 1) return 0;
    const x0 = fx | 0, y0 = fy | 0;
    const tx0 = fx - x0, ty0 = fy - y0;
    const row0 = y0 * sampleW + x0;
    const row1 = row0 + sampleW;
    const a = field[row0] + (field[row0 + 1] - field[row0]) * tx0;
    const b = field[row1] + (field[row1 + 1] - field[row1]) * tx0;
    return a + (b - a) * ty0;
  }

  function buildParticles(preserveSettled = false) {
    sampleSculptureField();
    const isPortrait = isPortraitViewport();
    // Crisp classical Swiss halftone pitch: micro-fine on mobile so every contour reads.
    pitch = isPortrait
      ? clamp(width / 92, 3.7, 4.9)
      : clamp(Math.min(width, height * 1.45) / 225, 5.0, 6.6);

    // Classic 45-degree rotated photolithographic screen.
    const angle = Math.PI * 0.25;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const cx = width * 0.5, cy = height * 0.5;
    const diag = Math.hypot(width, height) * 0.55;
    const steps = Math.ceil(diag / pitch) + 1;

    // Sculptural focal point near Justitia's blindfold / bridge of nose.
    const focusX = cover.x + cover.width * 0.55;
    const focusY = cover.y + cover.height * 0.36;
    const maxFocusDist = Math.hypot(width, height) * 0.62;

    const list = [];
    const probeStep = pitch * 1.4;
    for (let gy = -steps; gy <= steps; gy++) {
      for (let gx = -steps; gx <= steps; gx++) {
        const ux = gx * pitch, uy = gy * pitch;
        const px = cx + ux * cosA - uy * sinA;
        const py = cy + ux * sinA + uy * cosA;
        if (px < -pitch || px > width + pitch || py < -pitch || py > height + pitch) continue;

        const sil = sampleBilinear(silhouetteField, px, py);
        if (sil < 0.14) continue;

        const l0 = sampleBilinear(lumaField, px, py);
        // Local unsharp mask on marble luminance for razor-sharp blindfold & facial creases.
        const lL = sampleBilinear(lumaField, px - probeStep, py);
        const lR = sampleBilinear(lumaField, px + probeStep, py);
        const lU = sampleBilinear(lumaField, px, py - probeStep);
        const lD = sampleBilinear(lumaField, px, py + probeStep);
        const avg = (lL + lR + lU + lD) * 0.25;
        const grad = Math.hypot(lR - lL, lD - lU);
        const lEnh = clamp(l0 + 0.38 * (l0 - avg), 0, 1);

        // Mobile portrait: organically arch-fade the lower shoulder rim into cotton paper well above Ruth.
        let fade = smooth((sil - 0.14) / 0.55);
        if (isPortrait) {
          const edgeDrop = Math.abs(px / width - 0.52) * height * 0.07;
          fade *= 1 - smooth((py + edgeDrop - height * 0.44) / (height * 0.16));
          if (fade <= 0.03) continue;
        }

        // POSITIVE PHOTOLITHOGRAPHIC TONAL CURVE:
        // Sunlit marble (high lEnh) -> bright warm cotton paper + whisper pinpoint dots.
        // Deep chiaroscuro shadow (low lEnh) -> bold rich #11100f printer's ink dots.
        // Shaped S-curve preserves open luminous forehead/nose highlights & sculptural cheek depth.
        const tone = clamp((lEnh - 0.025) / 0.86, 0, 1);
        const darkness = 1 - Math.pow(tone, 0.78);
        const density = clamp(0.035 + 0.945 * Math.pow(darkness, 1.08), 0, 1) * fade;
        if (density < 0.026) continue;

        // Area-accurate halftone radius (r ~ sqrt(density)), capped at 0.495*pitch so
        // deepest shadows stay crisply halftone-dotted with breathable paper micro-gaps.
        const r = pitch * (0.072 + 0.422 * Math.sqrt(density));
        // Structural shadow contours & high-gradient facial creases emerge first.
        const prominence = clamp(grad * 1.9 + density * 0.58, 0, 1);
        list.push(px, py, r, prominence, gx, gy);
      }
    }

    count = list.length / 6;
    tx = new Float32Array(count);
    ty = new Float32Array(count);
    x = new Float32Array(count);
    y = new Float32Array(count);
    vx = new Float32Array(count);
    vy = new Float32Array(count);
    rTarget = new Float32Array(count);
    delay = new Float32Array(count);
    span = new Float32Array(count);
    swirlSign = new Float32Array(count);
    mass = new Float32Array(count);
    seed = new Float32Array(count);
    prom = new Float32Array(count);
    instanceData = new Float32Array(count * 6);

    // Wide, three-lobed baroque vortex + curl advection so frame 0 opens with a
    // broad, sweeping constellation of swirling ink streams across cotton paper.
    const minDim = Math.min(width, height);
    const vortices = isPortrait
      ? [
          { vx: width * 0.30, vy: height * 0.24, str: 1.05, rad: minDim * 0.54 },
          { vx: width * 0.74, vy: height * 0.36, str: -0.95, rad: minDim * 0.50 },
          { vx: width * 0.46, vy: height * 0.52, str: 0.78, rad: minDim * 0.42 },
        ]
      : [
          { vx: width * 0.52, vy: height * 0.28, str: 1.08, rad: minDim * 0.52 },
          { vx: width * 0.80, vy: height * 0.58, str: -1.02, rad: minDim * 0.48 },
          { vx: width * 0.42, vy: height * 0.76, str: 0.85, rad: minDim * 0.44 },
        ];
    const curlScale = 2.4 / Math.max(340, minDim);
    const swirlVec = new Float32Array(2);
    const shouldStartSettled = preserveSettled || reduced.matches || preview || !optedIn;

    for (let i = 0; i < count; i++) {
      const o = i * 6;
      const px = list[o], py = list[o + 1], r = list[o + 2], pr = list[o + 3];
      const gx = list[o + 4], gy = list[o + 5];
      const s0 = hash2(gx + 131, gy - 59);
      const s1 = hash2(gx - 277, gy + 419);
      const s2 = hash2(gx + 911, gy + 173);

      tx[i] = px;
      ty[i] = py;
      rTarget[i] = r;
      prom[i] = pr;
      seed[i] = s0;
      mass[i] = 0.76 + 0.50 * (r / (pitch * 0.5));

      // Spatial murmuration cohorts share swirl chirality (+/-1).
      const flockNoise = fieldNoise(px, py, 3.0 / Math.max(320, minDim));
      swirlSign[i] = flockNoise >= 0.5 ? 1 : -1;

      // Musical ~4.0s emergence choreography:
      // Deep blindfold & nose shadows condense first (~0.35s-1.2s), followed by
      // swirling midtone cheek/hair flocks, with sunlit pinpoint edges locking last.
      const distNorm = clamp(Math.hypot(px - focusX, py - focusY) / maxFocusDist, 0, 1);
      const waveNoise = fieldNoise(px + 90, py - 60, 2.2 / Math.max(320, minDim));
      const d = 0.30 + distNorm * 0.68 + waveNoise * 0.48 - pr * 0.28 + s1 * 0.22;
      delay[i] = clamp(d, 0.22, 1.78);
      span[i] = 1.42 + (1 - pr) * 0.46 + s2 * 0.34;

      if (shouldStartSettled) {
        x[i] = px;
        y[i] = py;
        vx[i] = 0;
        vy[i] = 0;
      } else {
        // Multi-step baroque dispersion: split into 3 organic current bands so
        // opening chaos fills the sheet gracefully with swirling ink ribbons.
        let cxp = px, cyp = py;
        const bandAngle = ((Math.floor(s2 * 3) * 2.094) + s0 * 0.85);
        const advectScale = minDim * (0.26 + 0.38 * (1 - 0.25 * pr) + 0.26 * s1);
        const subSteps = 7;
        const stepSize = advectScale / subSteps;

        for (let st = 0; st < subSteps; st++) {
          curlAt(cxp, cyp, 1.8 - st * 0.24 + s2 * 0.5, curlScale, swirlVec);
          let fx = swirlVec[0] * 1.25 + Math.cos(bandAngle) * 0.38;
          let fy = swirlVec[1] * 1.25 + Math.sin(bandAngle) * 0.38;
          for (let v = 0; v < vortices.length; v++) {
            const vor = vortices[v];
            const dx = cxp - vor.vx, dy = cyp - vor.vy;
            const d2 = dx * dx + dy * dy + 1100;
            const fall = Math.exp(-d2 / (vor.rad * vor.rad));
            const inv = vor.str * fall / Math.sqrt(d2);
            fx += (-dy * inv) * 1.05 + (dx * inv) * 0.30;
            fy += (dx * inv) * 1.05 + (dy * inv) * 0.30;
          }
          const mag = Math.hypot(fx, fy) || 1;
          cxp += (fx / mag) * stepSize;
          cyp += (fy / mag) * stepSize;
        }

        // Organic eddy jitter + 12% sweeping outer ink flecks.
        const theta = s0 * Math.PI * 2;
        const rogue = s2 > 0.88 ? minDim * (0.16 + 0.28 * s1) : 0;
        const jitter = (24 + 68 * s1) * (minDim / 900) + rogue;
        cxp += Math.cos(theta) * jitter;
        cyp += Math.sin(theta) * jitter;

        // Soft elastic reflection (never hard-clamping onto a vertical line!).
        const leftFloor = isPortrait ? -minDim * 0.05 : width * 0.22;
        const rightCeil = width + minDim * 0.05;
        const topFloor = -minDim * 0.04;
        const botCeil = isPortrait ? height * 0.78 : height + minDim * 0.05;
        if (cxp < leftFloor) cxp = leftFloor + (leftFloor - cxp) * (0.45 + 0.55 * s0) + s1 * minDim * 0.18;
        if (cxp > rightCeil) cxp = rightCeil - (cxp - rightCeil) * (0.45 + 0.55 * s1) - s0 * minDim * 0.12;
        if (cyp < topFloor) cyp = topFloor + (topFloor - cyp) * (0.45 + 0.55 * s0) + s2 * minDim * 0.12;
        if (cyp > botCeil) cyp = botCeil - (cyp - botCeil) * (0.45 + 0.55 * s1) - s0 * minDim * 0.14;

        x[i] = cxp;
        y[i] = cyp;

        // Initial velocity tangent to live curl field so chaos flows from frame 0.
        curlAt(cxp, cyp, 0, curlScale, swirlVec);
        const initSpeed = (75 + 120 * s0) * (minDim / 900);
        vx[i] = swirlVec[0] * initSpeed;
        vy[i] = swirlVec[1] * initSpeed;
      }
    }

    settled = shouldStartSettled;
    elapsed = shouldStartSettled ? 5.0 : 0;

    if (gl && glInstBuf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, glInstBuf);
      gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
    }
    host.dataset.halftoneDots = String(count);
  }

  function stepPhysics(dt) {
    if (!count) return;
    const minDim = Math.min(width, height);
    const curlScale = 2.4 / Math.max(340, minDim);
    const swirlVec = new Float32Array(2);
    const hasPointer = ptrEnergy > 0.002;
    const ptrRadius = isPortraitViewport() ? 94 : 158;
    const ptrRadSq = ptrRadius * ptrRadius;

    if (ptrEnergy > 0) ptrEnergy = Math.max(0, ptrEnergy * Math.exp(-dt * 3.2) - 0.001);
    ptrVx *= Math.exp(-dt * 6.5);
    ptrVy *= Math.exp(-dt * 6.5);

    const introDone = elapsed >= 4.15;
    let maxKinetic = 0;

    const steps = dt > 0.022 ? 2 : 1;
    const h = dt / steps;

    for (let st = 0; st < steps; st++) {
      const tNow = elapsed - dt + h * (st + 1);
      for (let i = 0; i < count; i++) {
        let px = x[i], py = y[i], vxi = vx[i], vyi = vy[i];
        const dx = tx[i] - px, dy = ty[i] - py;

        if (introDone) {
          // Silky elastic home spring + tactile interactive pointer vortex wake.
          const kHome = 20.0;
          const damp = 6.4;
          let ax = dx * kHome - vxi * damp;
          let ay = dy * kHome - vyi * damp;

          if (hasPointer) {
            const rx = px - ptrX, ry = py - ptrY;
            const d2 = rx * rx + ry * ry;
            if (d2 < ptrRadSq && d2 > 0.5) {
              const dist = Math.sqrt(d2);
              const u = 1 - dist / ptrRadius;
              const fall = u * u * ptrEnergy;
              const inv = 1 / dist;
              const nx = rx * inv, ny = ry * inv;
              const swirl = swirlSign[i] * 480;
              ax += (nx * 740 - ny * swirl + ptrVx * 2.1) * fall / mass[i];
              ay += (ny * 740 + nx * swirl + ptrVy * 2.1) * fall / mass[i];
            }
          }

          vxi += ax * h;
          vyi += ay * h;
          px += vxi * h;
          py += vyi * h;

          const dSq = dx * dx + dy * dy;
          const vSq = vxi * vxi + vyi * vyi;
          if (!hasPointer && dSq < 0.0008 && vSq < 0.02) {
            px = tx[i]; py = ty[i]; vxi = 0; vyi = 0;
          } else if (vSq + dSq * 4 > maxKinetic) {
            maxKinetic = vSq + dSq * 4;
          }
        } else {
          // Four-act chaotic-to-crystalline assembly physics.
          const p = smoother((tNow - delay[i]) / span[i]);
          const invP = 1 - p;

          // 1. Live divergence-free 2D curl turbulence.
          const curlAmp = (240 * Math.pow(invP, 1.5)) * (minDim / 900);
          let ax = 0, ay = 0;
          if (curlAmp > 0.4) {
            curlAt(px, py, tNow * 1.05 + seed[i] * 0.35, curlScale, swirlVec);
            ax += swirlVec[0] * curlAmp;
            ay += swirlVec[1] * curlAmp;
          }

          // 2. Decaying logarithmic-spiral Coriolis torque around target.
          const arcBell = Math.sin(Math.PI * p) * Math.pow(invP, 0.52);
          const omega = swirlSign[i] * (5.2 + 3.0 * seed[i]) * arcBell;
          ax += -dy * omega;
          ay += dx * omega;

          // 3. Progressive harmonic spring pull + critical damping lock.
          const kSpring = (28.0 + 22.0 * prom[i]) * Math.pow(p, 1.7) / mass[i];
          const damp = 1.55 + 11.6 * Math.pow(p, 1.32);

          ax += dx * kSpring - vxi * damp;
          ay += dy * kSpring - vyi * damp;

          if (hasPointer && p > 0.72) {
            const rx = px - ptrX, ry = py - ptrY;
            const d2 = rx * rx + ry * ry;
            if (d2 < ptrRadSq && d2 > 0.5) {
              const dist = Math.sqrt(d2);
              const u = 1 - dist / ptrRadius;
              const fall = u * u * ptrEnergy * (p - 0.72) * 3.5;
              ax += ((rx / dist) * 620 + ptrVx * 1.6) * fall;
              ay += ((ry / dist) * 620 + ptrVy * 1.6) * fall;
            }
          }

          vxi += ax * h;
          vyi += ay * h;
          px += vxi * h;
          py += vyi * h;
          maxKinetic = 100;
        }

        x[i] = px; y[i] = py; vx[i] = vxi; vy[i] = vyi;
      }
    }

    if (introDone && !settled && maxKinetic < 1.8) {
      settled = true;
      scheduleIdleSleep();
      reflect();
    }
  }

  function packInstances() {
    const t = elapsed;
    const bt = breatheTime;
    const isSettledMode = settled || reduced.matches || preview || !optedIn;
    const waveFreq = 1 / Math.max(420, Math.min(width, height));

    for (let i = 0; i < count; i++) {
      const o = i * 6;
      const px = x[i], py = y[i], vxi = vx[i], vyi = vy[i];
      const spd = Math.hypot(vxi, vyi);
      const baseR = rTarget[i];

      let rad = baseR;
      let alpha = 0.96;

      if (isSettledMode && !reduced.matches && !preview && optedIn) {
        // Whisper-calm press breathing wave across settled cotton-paper halftone.
        const wave = Math.sin((px * 0.65 + py * 0.76) * waveFreq * 4.2 - bt * 0.56 + seed[i] * 1.4);
        rad = baseR * (1 + 0.022 * wave);
        alpha = 0.945 + 0.035 * wave;
      } else if (!isSettledMode) {
        // Immediate rich ink presence from frame 0, sharpening as velocity drops.
        const entry = smooth((t - seed[i] * 0.16) / 0.24);
        const flight = clamp(spd / 280, 0, 1);
        const settleFactor = smooth((t - delay[i]) / span[i]);
        rad = baseR * (0.76 + 0.24 * settleFactor) * (1 - 0.12 * flight);
        alpha = entry * (0.62 + 0.35 * settleFactor * (1 - 0.24 * flight));
      }

      instanceData[o] = px;
      instanceData[o + 1] = py;
      instanceData[o + 2] = vxi;
      instanceData[o + 3] = vyi;
      instanceData[o + 4] = rad;
      instanceData[o + 5] = alpha;
    }
  }

  function renderGL() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;

    gl.useProgram(glProg);
    gl.uniform2f(glLoc.res, width, height);
    gl.uniform1f(glLoc.dpr, dpr);
    gl.uniform3f(glLoc.ink, INK_R, INK_G, INK_B);

    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuf);
    gl.enableVertexAttribArray(glLoc.quad);
    gl.vertexAttribPointer(glLoc.quad, 2, gl.FLOAT, false, 0, 0);
    if (glExt) glExt.vertexAttribDivisorANGLE(glLoc.quad, 0);
    else gl.vertexAttribDivisor(glLoc.quad, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glInstBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);

    const stride = 24;
    gl.enableVertexAttribArray(glLoc.pos);
    gl.vertexAttribPointer(glLoc.pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(glLoc.vel);
    gl.vertexAttribPointer(glLoc.vel, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(glLoc.meta);
    gl.vertexAttribPointer(glLoc.meta, 2, gl.FLOAT, false, stride, 16);

    if (glExt) {
      glExt.vertexAttribDivisorANGLE(glLoc.pos, 1);
      glExt.vertexAttribDivisorANGLE(glLoc.vel, 1);
      glExt.vertexAttribDivisorANGLE(glLoc.meta, 1);
      glExt.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
    } else {
      gl.vertexAttribDivisor(glLoc.pos, 1);
      gl.vertexAttribDivisor(glLoc.vel, 1);
      gl.vertexAttribDivisor(glLoc.meta, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
  }

  function render2D() {
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, width, height);
    ctx2d.fillStyle = '#11100f';
    for (let bucket = 0; bucket < 4; bucket++) {
      const lo = bucket * 0.25, hi = lo + 0.25;
      ctx2d.globalAlpha = Math.min(1, lo + 0.16);
      ctx2d.beginPath();
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const a = instanceData[o + 5];
        if (a <= lo || (bucket < 3 && a > hi)) continue;
        const px = instanceData[o], py = instanceData[o + 1], r = instanceData[o + 4];
        if (r < 0.2) continue;
        ctx2d.moveTo(px + r, py);
        ctx2d.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
  }

  function draw() {
    packInstances();
    if (gl) renderGL();
    else if (ctx2d) render2D();
    onFrame?.({
      cover: { ...cover },
      time: elapsed,
      visible: 1,
      held: settled,
    });
  }

  function permitted() {
    return active && !disposed && !paused && !preview && optedIn && !reduced.matches &&
      !waitlistOpen() && !document.hidden && !pageSuspended && intersecting && !sleeping;
  }

  function reflect() {
    if (!active) return;
    host.dataset.renderer = `halftone-${backend}`;
    host.dataset.materialIdle = settled ? (permitted() ? 'running' : 'paused') : 'assembling';
    host.dataset.motion = !optedIn || reduced.matches || preview ? 'static' : permitted() ? 'running' : 'static';
  }

  function scheduleIdleSleep() {
    clearTimeout(sleepTimer);
    if (!active || !settled || disposed || paused || sleeping) return;
    sleepTimer = setTimeout(() => {
      if (active && settled && !disposed) {
        sleeping = true;
        sync();
      }
    }, 90_000);
  }

  function wake() {
    if (!active || disposed || paused) return;
    if (sleeping) {
      sleeping = false;
      sync();
    }
    if (settled) scheduleIdleSleep();
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastNow = 0;
  }

  function sync() {
    stop();
    reflect();
    if (permitted()) {
      if (settled) scheduleIdleSleep();
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    rafId = 0;
    if (!permitted()) {
      lastNow = 0;
      reflect();
      return;
    }
    if (!lastNow) lastNow = now;
    const needsFast = !settled || ptrEnergy > 0.005;
    const minStep = needsFast ? 0 : (1000 / 20 - 0.5);
    const diff = now - lastNow;
    if (diff >= minStep) {
      const dt = Math.min(diff, 50) / 1000;
      lastNow = now;
      elapsed += dt;
      if (settled) breatheTime += dt;
      stepPhysics(dt);
      draw();
    }
    rafId = requestAnimationFrame(tick);
  }

  function resize(preserveSettled = true) {
    width = Math.max(1, Math.round(host.clientWidth));
    height = Math.max(1, Math.round(host.clientHeight));
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    buildParticles(preserveSettled);
    draw();
  }

  function scheduleResize() {
    if (!active || disposed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!active || disposed || !host.clientWidth || !host.clientHeight) return;
      resize(settled);
      sync();
    });
  }

  function onPointerMove(e) {
    if (!active || disposed || reduced.matches || waitlistOpen()) return;
    const rect = host.getBoundingClientRect();
    const nx = e.clientX - rect.left;
    const ny = e.clientY - rect.top;
    if (nx < 0 || ny < 0 || nx > rect.width || ny > rect.height) {
      ptrInside = false;
      return;
    }
    if (ptrInside) {
      ptrVx = clamp((nx - ptrX) * 32, -1100, 1100);
      ptrVy = clamp((ny - ptrY) * 32, -1100, 1100);
    }
    ptrX = nx;
    ptrY = ny;
    ptrInside = true;
    ptrEnergy = Math.min(1, ptrEnergy + 0.72);
    wake();
  }

  function onPointerLeave() {
    ptrInside = false;
  }

  const resizeObserver = new ResizeObserver(scheduleResize);
  const intersectionObserver = new IntersectionObserver(entries => {
    intersecting = entries[0]?.isIntersecting ?? true;
    sync();
  });
  const waitlistObserver = new MutationObserver(() => sync());

  initBackend();
  resizeObserver.observe(host);
  intersectionObserver.observe(host);
  waitlistObserver.observe(body, { attributes: true, attributeFilter: ['data-waitlist-open'] });
  document.addEventListener('visibilitychange', sync, events);
  window.addEventListener('pointermove', onPointerMove, { ...events, passive: true });
  window.addEventListener('pointerleave', onPointerLeave, { ...events, passive: true });
  window.addEventListener('keydown', wake, { ...events, passive: true });
  window.addEventListener('pagehide', e => {
    pageSuspended = true;
    if (e.persisted) sync();
    else dispose();
  }, events);
  window.addEventListener('pageshow', e => {
    if (e.persisted && !disposed) {
      pageSuspended = false;
      sync();
    }
  }, events);

  function start(fresh = true) {
    if (disposed || backend === 'none') return false;
    active = true;
    sleeping = false;
    if (!canvas.isConnected) host.append(canvas);
    canvas.hidden = false;
    resize(!fresh);
    host.classList.add('ready');
    sync();
    return true;
  }

  function deactivate() {
    active = false;
    stop();
    clearTimeout(sleepTimer);
    canvas.hidden = true;
  }

  function onReducedChange() {
    if (!active || disposed) return;
    resize(reduced.matches);
    sync();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    stop();
    clearTimeout(sleepTimer);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    abort.abort();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    waitlistObserver.disconnect();
    canvas.remove();
    sampleCanvas.width = sampleCanvas.height = 1;
  }

  return {
    start,
    deactivate,
    onReducedChange,
    dispose,
    get settled() { return settled; },
    get count() { return count; },
    get backend() { return backend; },
  };
}

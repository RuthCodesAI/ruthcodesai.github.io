/**
 * Ruth Day Mode: 3D Chaotic-to-Orthogonal Halftone & Living Blindfold-Lift.
 *
 * Reconstructs the exact 234x132 (30,888-dot) orthogonal 0-degree Swiss halftone
 * matrix directly from assets/justitia-day-grid.rht (30 KB) and streams the full
 * 77-keyframe blindfold-lift track from assets/justitia-day-lift.rht (268 KB),
 * rendering every dot as an individual GPU-simulated analytic SDF particle at
 * native Retina DPR (WebGL2/WebGL1 instanced with automatic Canvas 2D fallback).
 *
 * Three-act sublime choreography:
 *   Act I  (0.0-4.1s): 3D Chaotic Constellation -> Crystalline Orthogonal Lock.
 *     Sculptural dots emerge from deep 3D perspective space (z in [-0.85, +0.95])
 *     with real optical depth-of-field blur, calligraphic velocity stretch, 3D
 *     divergence-free curl-torus ribbons, and counter-rotating Coriolis spirals,
 *     snapping into razor-sharp 0-degree registration on the z = 0 cotton paper
 *     plane as the background pinpoint matrix ripples outward into place.
 *   Act II (4.6-17.2s): Living 60/120fps Vector Blindfold Lift.
 *     Justitia raises her left hand, lifts the corner of her blindfold to see,
 *     and lowers it back to rest via smooth Catmull-Rom cubic interpolation of
 *     all 30,888 dot radii with subtle kinetic print recoil along moving edges
 *     and a live GPU reading aura protecting typography legibility.
 *   Act III (17.2s+): Sublime Living Stillness & Interactive 3D Magnetic Field.
 *     Whisper-subtle diagonal press sheen, silky 3D magnetic curl-vortex cursor
 *     wake, and radial chaotic dispersion ripple on bare-paper clicks. Pauses
 *     automatically when the waitlist opens, sleeps after 90s of inactivity,
 *     and renders the exact static orthogonal print under reduced motion.
 */

const GRID_URL = '/assets/justitia-day-grid.rht?v=2026-ht2';
const LIFT_URL = '/assets/justitia-day-lift.rht?v=2026-ht2';

let cachedGridPromise = null;
let cachedLiftPromise = null;

async function loadStaticGrid() {
  if (!cachedGridPromise) {
    cachedGridPromise = fetch(GRID_URL).then(async (res) => {
      if (!res.ok) throw new Error('Grid fetch failed');
      const buf = await res.arrayBuffer();
      const view = new DataView(buf);
      const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (magic !== 'RHT0') throw new Error('Invalid RHT0 header');
      const cols = view.getUint16(4, true);
      const rows = view.getUint16(6, true);
      const data = new Uint8Array(buf, 8, cols * rows);
      return { cols, rows, data };
    });
  }
  return cachedGridPromise;
}

async function loadLiftTrack() {
  if (typeof DecompressionStream !== 'function') return null;
  if (!cachedLiftPromise) {
    cachedLiftPromise = fetch(LIFT_URL).then(async (res) => {
      if (!res.ok) return null;
      const ds = new DecompressionStream('gzip');
      const decompressed = await new Response(res.body.pipeThrough(ds)).arrayBuffer();
      const view = new DataView(decompressed);
      const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (magic !== 'RHT1') return null;
      const cols = view.getUint16(4, true);
      const rows = view.getUint16(6, true);
      const nFrames = view.getUint16(8, true);
      const fps = view.getUint8(10);
      const cellCount = cols * rows;
      const raw = new Uint8Array(decompressed, 11);
      // Reconstruct absolute 0..63 quantized frames from delta bytes.
      const frames = new Uint8Array(nFrames * cellCount);
      frames.set(raw.subarray(0, cellCount), 0);
      for (let f = 1; f < nFrames; f++) {
        const prevOff = (f - 1) * cellCount;
        const curOff = f * cellCount;
        for (let i = 0; i < cellCount; i++) {
          frames[curOff + i] = (frames[prevOff + i] + raw[curOff + i]) & 0x3F;
        }
      }
      return { cols, rows, nFrames, fps, frames };
    }).catch(() => null);
  }
  return cachedLiftPromise;
}

export function createDayHalftone(options) {
  const { host, photo, body, reduced, mobile, onFrame } = options;
  const preview = new URLSearchParams(location.search).has('preview');
  const optedIn = body.dataset.animate === 'true';
  const abort = new AbortController(), events = { signal: abort.signal };

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'halftone-canvas';

  // Exact original printer's ink (#0f0f0e).
  const INK_R = 15 / 255, INK_G = 15 / 255, INK_B = 14 / 255;

  let disposed = false, active = false, paused = false, intersecting = true;
  let pageSuspended = false, sleeping = false;
  let phase = 'loading'; // 'assembling' | 'hold' | 'lifting' | 'settled'
  let rafId = 0, resizeFrame = 0, sleepTimer = 0;
  let lastNow = 0, elapsed = 0, liftElapsed = 0, breatheTime = 0;
  let width = 1, height = 1, dpr = 1, dotPitch = 6.8;
  let cover = { x: 0, y: 0, width: 1, height: 1 };

  let grid = null;     // { cols, rows, data }
  let liftTrack = null; // { cols, rows, nFrames, fps, frames }

  // Structure-of-Arrays particle buffers for all visible dots (up to 30,888).
  let count = 0;
  let cellIdx;         // index into 234x132 source grid
  let isFigure;        // 1 = sculptural figure dot (3D chaotic flight), 0 = background register dot
  let tx, ty;          // exact 0-deg orthogonal target coordinates (CSS px)
  let x, y, z;         // live 3D position (z = 0 is cotton rag paper plane)
  let vx, vy, vz;      // live 3D velocity
  let baseR, curR;     // target & live radius (CSS px)
  let delay, span, swirlSign, mass, seed, prom;
  let instanceData;    // Float32Array(count * 8): [x, y, z, vx, vy, r, alpha, focus]

  // Live typography reading-aura bounds (updated via ResizeObserver so text stays AAA crisp
  // even as Justitia's rising forearm passes nearby during Act II).
  let auraCx = 0, auraCy = 0, auraRx = 1, auraRy = 1, auraActive = 0;

  // Interactive 3D pointer magnetic wake & click shockwave.
  let ptrX = -9999, ptrY = -9999, ptrVx = 0, ptrVy = 0, ptrEnergy = 0, ptrInside = false;
  let rippleX = -9999, rippleY = -9999, rippleAge = 99;

  // WebGL2 / WebGL1 / Canvas 2D backend.
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

  // Smooth periodic-free 2-octave divergence-free 2D curl + vertical 3D lift component.
  function curl3At(px, py, pz, t, scale, out) {
    const sx = px * scale, sy = py * scale, sz = pz * 1.35;
    const t1 = t * 0.52, t2 = t * 0.86;

    const a1 = sx * 0.84 + sy * 0.54 + sz * 0.42 + t1;
    const b1 = -sx * 0.49 + sy * 0.87 - sz * 0.36 - t1 * 0.81;
    const sA1 = Math.sin(a1), cA1 = Math.cos(a1);
    const sB1 = Math.sin(b1), cB1 = Math.cos(b1);
    const d1dx = cA1 * 0.84 * cB1 + sA1 * sB1 * 0.49;
    const d1dy = cA1 * 0.54 * cB1 - sA1 * sB1 * 0.87;

    const sx2 = sx * 2.18 + 3.1, sy2 = sy * 2.18 - 1.7;
    const a2 = sx2 * 0.61 - sy2 * 0.79 - t2;
    const b2 = sx2 * 0.78 + sy2 * 0.62 + t2 * 0.69;
    const sA2 = Math.sin(a2), cA2 = Math.cos(a2);
    const sB2 = Math.sin(b2), cB2 = Math.cos(b2);
    const w2 = 0.48;
    const d2dx = w2 * (cA2 * 0.61 * cB2 - sA2 * sB2 * 0.78);
    const d2dy = w2 * (cA2 * (-0.79) * cB2 - sA2 * sB2 * 0.62);

    out[0] = d1dy + d2dy;
    out[1] = -(d1dx + d2dx);
    out[2] = 0.68 * Math.sin(sx * 1.15 - sy * 0.92 + t1 * 1.15) * Math.cos(sz * 1.4 - t2 * 0.5);
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
          attribute vec4 a_posv;  // (x, y, z, vx)
          attribute vec4 a_meta;  // (vy, r, alpha, focus)
          uniform vec2 u_res;
          uniform float u_dpr;
          uniform vec4 u_aura;    // (cx, cy, rx, ry)
          uniform float u_auraOn;
          varying vec2 v_local;
          varying float v_rad;
          varying float v_halfLen;
          varying float v_alpha;
          varying float v_soft;
          varying vec2 v_world;

          void main() {
            vec2 pos2 = a_posv.xy;
            float pz = a_posv.z;
            vec2 vel = vec2(a_posv.w, a_meta.x);
            float r = a_meta.y;
            float alpha = a_meta.z;
            float focus = a_meta.w;
            if (r < 0.05 || alpha < 0.005) {
              gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
              v_local = vec2(0.0); v_rad = 0.0; v_halfLen = 0.0; v_alpha = 0.0; v_soft = 1.0; v_world = vec2(0.0);
              return;
            }

            // Perspective projection relative to canvas center (z = 0 is the cotton rag paper).
            float focal = 2.65;
            float persp = focal / max(0.55, focal - pz);
            vec2 center = u_res * vec2(0.58, 0.48);
            vec2 projPos = center + (pos2 - center) * persp;
            float projR = r * persp;

            // Subtle optical depth-of-field bloom when floating off z = 0;
            // snaps to razor-sharp letterpress precision on the paper plane.
            float depthOff = abs(pz);
            float dofBlur = depthOff * 2.85;
            projR += dofBlur * 0.34;
            float dofFade = 1.0 / (1.0 + depthOff * 1.15);

            // Calligraphic velocity elongation in chaotic 3D flight.
            float spd = length(vel);
            vec2 dir = spd > 2.0 ? (vel / spd) : vec2(1.0, 0.0);
            vec2 perp = vec2(-dir.y, dir.x);
            float stretch = 1.0 + min(2.45, spd * 0.0034);
            float rPerp = projR / pow(stretch, 0.35);
            float halfLen = rPerp * (stretch - 1.0) * 0.94;

            // Live typography reading aura: gently thins ink right behind Ruth / headline / CTA
            // so the rising forearm & swirling chaos never compromise text contrast.
            float auraScale = 1.0;
            if (u_auraOn > 0.5) {
              vec2 dAura = (projPos - u_aura.xy) / u_aura.zw;
              float dist = length(dAura);
              auraScale = mix(0.16, 1.0, smoothstep(0.42, 1.18, dist));
            }

            float flight = smoothstep(10.0, 280.0, spd);
            float soft = max(0.52 / u_dpr, dofBlur + mix(0.52 / u_dpr, 1.25 / u_dpr, flight) * (1.2 - 0.2 * focus));
            float pad = soft + 1.4 / u_dpr;

            vec2 local = vec2(a_quad.x * (rPerp + halfLen + pad), a_quad.y * (rPerp + pad));
            vec2 screenPos = projPos + dir * local.x + perp * local.y;

            vec2 clip = (screenPos / u_res) * 2.0 - 1.0;
            clip.y = -clip.y;
            gl_Position = vec4(clip, 0.0, 1.0);

            v_local = local;
            v_rad = rPerp;
            v_halfLen = halfLen;
            v_alpha = alpha * dofFade * auraScale;
            v_soft = soft;
            v_world = screenPos;
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

            float tooth = 0.965 + 0.035 * grain(v_world * 1.4);
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
              posv: gl.getAttribLocation(prog, 'a_posv'),
              meta: gl.getAttribLocation(prog, 'a_meta'),
              res: gl.getUniformLocation(prog, 'u_res'),
              dpr: gl.getUniformLocation(prog, 'u_dpr'),
              ink: gl.getUniformLocation(prog, 'u_ink'),
              aura: gl.getUniformLocation(prog, 'u_aura'),
              auraOn: gl.getUniformLocation(prog, 'u_auraOn'),
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

  // Exact mapping from quantized dot amplitude v in [0, 1] -> crisp circular radius.
  // Preserves the iconic bold orthogonal 0-deg dots while keeping hairline micro-gaps
  // between deep shadow dots so every individual circle reads razor sharp.
  function radiusFromValue(v, pitchPx, isMobilePortrait) {
    if (v <= 0.195) {
      // Iconic subtle full-sheet register pinpoint matrix on warm cotton paper.
      return isMobilePortrait ? 0 : pitchPx * (0.068 + 0.055 * (v / 0.195));
    }
    const r = pitchPx * Math.min(0.468, v * 0.502);
    return r;
  }

  function updateReadingAura() {
    const artRect = host.getBoundingClientRect();
    if (!artRect.width || !artRect.height || waitlistOpen()) {
      auraActive = 0;
      return;
    }
    const nodes = ['.ruth-home', 'h1', '#signup-cta']
      .map((s) => document.querySelector(s))
      .filter(Boolean);
    if (!nodes.length) { auraActive = 0; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.left < minX) minX = b.left;
      if (b.top < minY) minY = b.top;
      if (b.right > maxX) maxX = b.right;
      if (b.bottom > maxY) maxY = b.bottom;
    }
    if (!Number.isFinite(minX)) { auraActive = 0; return; }
    auraCx = (minX + maxX) * 0.5 - artRect.left;
    auraCy = (minY + maxY) * 0.5 - artRect.top;
    auraRx = Math.max(90, (maxX - minX) * 0.72 + 44);
    auraRy = Math.max(80, (maxY - minY) * 0.74 + 42);
    auraActive = 1;
  }

  function computeCover() {
    const iw = 1638, ih = 924;
    if (isPortraitViewport()) {
      // Portrait mobile framing: show Justitia's full head, blindfold, hair bun, lips,
      // chin, and upper collarbone cleanly framed above "Ruth" at crisp orthogonal dot scale.
      const desiredHeadSpan = width * 1.08;
      const sourceHeadSpan = iw * 0.49;
      const scale = Math.max(desiredHeadSpan / sourceHeadSpan, (height * 0.67) / ih);
      const cw = iw * scale;
      const ch = ih * scale;
      const cx = width * 0.51 - cw * 0.605;
      const cy = -height * 0.022;
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

  function buildParticles(preserveSettled = false) {
    if (!grid) return;
    computeCover();
    updateReadingAura();

    const { cols, rows, data } = grid;
    const isPortrait = isPortraitViewport();
    const cellW = cover.width / cols;
    const cellH = cover.height / rows;
    dotPitch = Math.min(cellW, cellH);

    // Focal epicenter near blindfold / nose bridge for sculptural wave emergence.
    const focusX = cover.x + cover.width * 0.565;
    const focusY = cover.y + cover.height * 0.36;
    const maxDist = Math.hypot(width, height) * 0.68;

    const list = [];
    for (let r = 0; r < rows; r++) {
      const py = cover.y + (r + 0.5) * cellH;
      if (py < -dotPitch || py > height + dotPitch) continue;
      for (let c = 0; c < cols; c++) {
        const px = cover.x + (c + 0.5) * cellW;
        if (px < -dotPitch || px > width + dotPitch) continue;
        const idx = r * cols + c;
        const v = data[idx] / 255;

        // Portrait mobile: keep cells above the bottom fade so Justitia's rising left
        // hand materializes cleanly during Act II, while keeping resting background
        // pinpoint cells at radius 0 (spotless cotton paper around the portrait).
        let fade = 1;
        if (isPortrait) {
          const edgeDrop = Math.abs(px / width - 0.52) * height * 0.075;
          fade = 1 - smooth((py + edgeDrop - height * 0.44) / (height * 0.155));
          if (fade <= 0.03) continue;
        }

        const rad = radiusFromValue(v, dotPitch, isPortrait) * Math.sqrt(fade);
        if (!isPortrait && rad < 0.28) continue;

        const fig = v > 0.215 ? 1 : 0;
        list.push(idx, px, py, rad, fig, c, r);
      }
    }

    count = list.length / 7;
    cellIdx = new Int32Array(count);
    isFigure = new Uint8Array(count);
    tx = new Float32Array(count);
    ty = new Float32Array(count);
    x = new Float32Array(count);
    y = new Float32Array(count);
    z = new Float32Array(count);
    vx = new Float32Array(count);
    vy = new Float32Array(count);
    vz = new Float32Array(count);
    baseR = new Float32Array(count);
    curR = new Float32Array(count);
    delay = new Float32Array(count);
    span = new Float32Array(count);
    swirlSign = new Float32Array(count);
    mass = new Float32Array(count);
    seed = new Float32Array(count);
    prom = new Float32Array(count);
    instanceData = new Float32Array(count * 8);

    const minDim = Math.min(width, height);
    const vortices = isPortrait
      ? [
          { vx: width * 0.26, vy: height * 0.22, str: 1.12, rad: minDim * 0.56 },
          { vx: width * 0.78, vy: height * 0.34, str: -1.04, rad: minDim * 0.52 },
          { vx: width * 0.48, vy: height * 0.50, str: 0.85, rad: minDim * 0.44 },
        ]
      : [
          { vx: width * 0.54, vy: height * 0.26, str: 1.18, rad: minDim * 0.54 },
          { vx: width * 0.82, vy: height * 0.58, str: -1.08, rad: minDim * 0.50 },
          { vx: width * 0.42, vy: height * 0.74, str: 0.92, rad: minDim * 0.46 },
        ];
    const curlScale = 2.35 / Math.max(340, minDim);
    const cVec = new Float32Array(3);
    const shouldStartSettled = preserveSettled || reduced.matches || preview || !optedIn;

    for (let i = 0; i < count; i++) {
      const o = i * 7;
      const idx = list[o], px = list[o + 1], py = list[o + 2], r = list[o + 3];
      const fig = list[o + 4], gc = list[o + 5], gr = list[o + 6];

      const s0 = hash2(gc + 131, gr - 59);
      const s1 = hash2(gc - 277, gr + 419);
      const s2 = hash2(gc + 911, gr + 173);
      const s3 = hash2(gc * 3 + 17, gr * 5 - 41);

      cellIdx[i] = idx;
      isFigure[i] = fig;
      tx[i] = px;
      ty[i] = py;
      baseR[i] = r;
      curR[i] = r;
      seed[i] = s0;

      const normR = clamp(r / (dotPitch * 0.47), 0, 1);
      prom[i] = fig ? clamp(0.25 + 0.75 * normR, 0, 1) : 0;
      mass[i] = 0.74 + 0.54 * normR;

      const flockNoise = fieldNoise(px, py, 2.9 / Math.max(320, minDim));
      swirlSign[i] = flockNoise >= 0.5 ? 1 : -1;

      const distNorm = clamp(Math.hypot(px - focusX, py - focusY) / maxDist, 0, 1);
      const waveNoise = fieldNoise(px + 95, py - 55, 2.15 / Math.max(320, minDim));

      if (fig) {
        // Bold shadow contours emerge first (0.24s..1.1s); midtones sweep in (0.9s..1.85s).
        delay[i] = clamp(0.24 + distNorm * 0.74 + waveNoise * 0.50 - normR * 0.30 + s1 * 0.22, 0.18, 1.82);
        span[i] = 1.48 + (1 - normR) * 0.48 + s2 * 0.34;
      } else {
        // Background register dot matrix prints cleanly as a subtle orthogonal wave right behind the lock.
        delay[i] = clamp(1.85 + distNorm * 1.15 + waveNoise * 0.35, 1.75, 3.25);
        span[i] = 0.65;
      }

      if (shouldStartSettled || !fig) {
        x[i] = px; y[i] = py; z[i] = 0;
        vx[i] = 0; vy[i] = 0; vz[i] = 0;
      } else {
        // 3D backward advection through curl + counter-rotating baroque torus vortices
        // so frame 0 opens with a breathtaking 3D floating ink constellation!
        let cxp = px, cyp = py, czp = (s3 - 0.48) * 1.55;
        const advectScale = minDim * (0.28 + 0.42 * (1 - 0.22 * normR) + 0.28 * s1);
        const subSteps = 7;
        const stepXY = advectScale / subSteps;
        const bandAngle = Math.floor(s2 * 3) * 2.094 + s0 * 0.9;

        for (let st = 0; st < subSteps; st++) {
          curl3At(cxp, cyp, czp, 1.9 - st * 0.24 + s2 * 0.5, curlScale, cVec);
          let fx = cVec[0] * 1.3 + Math.cos(bandAngle) * 0.40;
          let fy = cVec[1] * 1.3 + Math.sin(bandAngle) * 0.40;
          for (let v = 0; v < vortices.length; v++) {
            const vor = vortices[v];
            const dx = cxp - vor.vx, dy = cyp - vor.vy;
            const d2 = dx * dx + dy * dy + 1100;
            const fall = Math.exp(-d2 / (vor.rad * vor.rad));
            const inv = vor.str * fall / Math.sqrt(d2);
            fx += (-dy * inv) * 1.12 + (dx * inv) * 0.32;
            fy += (dx * inv) * 1.12 + (dy * inv) * 0.32;
          }
          const mag = Math.hypot(fx, fy) || 1;
          cxp += (fx / mag) * stepXY;
          cyp += (fy / mag) * stepXY;
          czp += cVec[2] * 0.14;
        }

        const theta = s0 * Math.PI * 2;
        const rogue = s2 > 0.87 ? minDim * (0.18 + 0.30 * s1) : 0;
        const jitter = (26 + 74 * s1) * (minDim / 900) + rogue;
        cxp += Math.cos(theta) * jitter;
        cyp += Math.sin(theta) * jitter;
        czp = clamp(czp, -0.92, 0.92);

        // Soft elastic reflection (zero artificial vertical edge pileup).
        const leftFloor = isPortrait ? -minDim * 0.05 : width * 0.18;
        const rightCeil = width + minDim * 0.05;
        const topFloor = -minDim * 0.04;
        const botCeil = isPortrait ? height * 0.78 : height + minDim * 0.05;
        if (cxp < leftFloor) cxp = leftFloor + (leftFloor - cxp) * (0.45 + 0.55 * s0) + s1 * minDim * 0.22;
        if (cxp > rightCeil) cxp = rightCeil - (cxp - rightCeil) * (0.45 + 0.55 * s1) - s0 * minDim * 0.14;
        if (cyp < topFloor) cyp = topFloor + (topFloor - cyp) * (0.45 + 0.55 * s0) + s2 * minDim * 0.14;
        if (cyp > botCeil) cyp = botCeil - (cyp - botCeil) * (0.45 + 0.55 * s1) - s0 * minDim * 0.14;

        x[i] = cxp; y[i] = cyp; z[i] = czp;

        // Initial 3D curl velocity so constellation is smoothly alive from frame 0.
        curl3At(cxp, cyp, czp, 0, curlScale, cVec);
        const initSpeed = (82 + 130 * s0) * (minDim / 900);
        vx[i] = cVec[0] * initSpeed;
        vy[i] = cVec[1] * initSpeed;
        vz[i] = cVec[2] * 0.45;
      }
    }

    if (shouldStartSettled) {
      phase = 'settled';
      elapsed = 5.0;
    } else {
      phase = 'assembling';
      elapsed = 0;
      liftElapsed = 0;
    }

    if (gl && glInstBuf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, glInstBuf);
      gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
    }
    host.dataset.halftoneDots = String(count);
  }

  // Smooth Catmull-Rom cubic interpolation of 6fps blindfold-lift keyframes -> 60/120fps vector dots.
  function sampleLiftRadii(tSec) {
    if (!liftTrack) return false;
    const { cols, rows, nFrames, fps, frames } = liftTrack;
    const cellCount = cols * rows;
    const isPortrait = isPortraitViewport();
    const fPos = tSec * fps;
    if (fPos >= nFrames - 1) {
      // Completed full lift cycle; return cleanly to exact resting Frame 0 radii.
      for (let i = 0; i < count; i++) curR[i] = baseR[i];
      return true;
    }

    const f1 = Math.floor(fPos);
    const u = fPos - f1;
    const f0 = Math.max(0, f1 - 1);
    const f2 = Math.min(nFrames - 1, f1 + 1);
    const f3 = Math.min(nFrames - 1, f1 + 2);
    const o0 = f0 * cellCount, o1 = f1 * cellCount, o2 = f2 * cellCount, o3 = f3 * cellCount;
    const u2 = u * u, u3 = u2 * u;

    for (let i = 0; i < count; i++) {
      const idx = cellIdx[i];
      const p0 = frames[o0 + idx];
      const p1 = frames[o1 + idx];
      const p2 = frames[o2 + idx];
      const p3 = frames[o3 + idx];
      let v;
      if (p0 === p1 && p1 === p2 && p2 === p3) {
        v = p1 / 63;
      } else {
        // Catmull-Rom spline clamped to avoid overshoot rings.
        const cr = 0.5 * (
          (2 * p1) +
          (-p0 + p2) * u +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * u3
        );
        v = clamp(cr / 63, 0, 1);
      }

      const prevR = curR[i];
      let nextR = radiusFromValue(v, dotPitch, isPortrait);
      if (isPortrait) {
        const edgeDrop = Math.abs(tx[i] / width - 0.52) * height * 0.075;
        const fade = 1 - smooth((ty[i] + edgeDrop - height * 0.44) / (height * 0.155));
        nextR *= Math.sqrt(fade);
      }
      curR[i] = nextR;

      // Kinetic print elasticity: dots whose radius actively changes along the rising
      // hand or lifted blindfold receive a whisper-subtle spring breath.
      const dr = nextR - prevR;
      if (Math.abs(dr) > 0.08 && Math.abs(x[i] - tx[i]) < 4) {
        const push = clamp(dr * 3.8, -14, 14);
        vy[i] -= push;
        vz[i] += clamp(Math.abs(dr) * 0.14, 0, 0.25);
      }
    }
    return false;
  }

  function stepPhysics(dt) {
    if (!count) return;
    const minDim = Math.min(width, height);
    const curlScale = 2.35 / Math.max(340, minDim);
    const cVec = new Float32Array(3);
    const hasPointer = ptrEnergy > 0.002;
    const ptrRadius = isPortraitViewport() ? 98 : 165;
    const ptrRadSq = ptrRadius * ptrRadius;

    if (ptrEnergy > 0) ptrEnergy = Math.max(0, ptrEnergy * Math.exp(-dt * 3.0) - 0.001);
    ptrVx *= Math.exp(-dt * 6.0);
    ptrVy *= Math.exp(-dt * 6.0);
    if (rippleAge < 3.5) rippleAge += dt;

    // Phase progression: assembling (0..4.15s) -> hold (0.45s) -> lifting (12.6s) -> settled.
    if (phase === 'hold') {
      if (elapsed >= 4.55) {
        if (liftTrack) {
          phase = 'lifting';
          liftElapsed = 0;
          reflect();
        } else {
          phase = 'settled';
          scheduleIdleSleep();
          reflect();
        }
      }
    } else if (phase === 'lifting') {
      liftElapsed += dt;
      const done = sampleLiftRadii(liftElapsed);
      if (done) {
        phase = 'settled';
        scheduleIdleSleep();
        reflect();
      }
    }

    const inIntro = phase === 'assembling';
    const introDoneTime = elapsed >= 4.15;
    let maxKinetic = 0;

    const steps = dt > 0.022 ? 2 : 1;
    const h = dt / steps;
    const hasRipple = rippleAge < 1.6;
    const ripFront = rippleAge * minDim * 0.58;
    const ripBand = minDim * 0.13;

    for (let st = 0; st < steps; st++) {
      const tNow = elapsed - dt + h * (st + 1);
      for (let i = 0; i < count; i++) {
        let px = x[i], py = y[i], pz = z[i];
        let vxi = vx[i], vyi = vy[i], vzi = vz[i];
        const dx = tx[i] - px, dy = ty[i] - py, dz = -pz;

        if (!inIntro) {
          // Crisp damped 3D spring back onto z = 0 orthogonal Swiss registration.
          const kHome = 21.0;
          const damp = 6.6;
          let ax = dx * kHome - vxi * damp;
          let ay = dy * kHome - vyi * damp;
          let az = dz * 24.0 - vzi * 7.4;

          // Silky interactive 3D magnetic cursor curl wake.
          if (hasPointer) {
            const rx = px - ptrX, ry = py - ptrY;
            const d2 = rx * rx + ry * ry;
            if (d2 < ptrRadSq && d2 > 0.5) {
              const dist = Math.sqrt(d2);
              const u = 1 - dist / ptrRadius;
              const fall = u * u * ptrEnergy;
              const inv = 1 / dist;
              const nx = rx * inv, ny = ry * inv;
              const swirl = swirlSign[i] * 520;
              ax += (nx * 780 - ny * swirl + ptrVx * 2.2) * fall / mass[i];
              ay += (ny * 780 + nx * swirl + ptrVy * 2.2) * fall / mass[i];
              az += (3.6 * u * ptrEnergy) / mass[i]; // lifts dots gently out of the paper toward the viewer!
            }
          }

          // Bare-paper click acoustic dispersion ripple.
          if (hasRipple) {
            const rx = px - rippleX, ry = py - rippleY;
            const dist = Math.hypot(rx, ry);
            const bandDiff = Math.abs(dist - ripFront);
            if (bandDiff < ripBand && dist > 1) {
              const env = (1 - bandDiff / ripBand) * Math.exp(-rippleAge * 2.1);
              const nx = rx / dist, ny = ry / dist;
              const swirl = swirlSign[i] * 540;
              ax += (nx * 960 - ny * swirl) * env / mass[i];
              ay += (ny * 960 + nx * swirl) * env / mass[i];
              az += 4.2 * env * (seed[i] - 0.35);
            }
          }

          vxi += ax * h; vyi += ay * h; vzi += az * h;
          px += vxi * h; py += vyi * h; pz += vzi * h;

          const dSq = dx * dx + dy * dy + dz * dz * 100;
          const vSq = vxi * vxi + vyi * vyi + vzi * vzi * 100;
          if (!hasPointer && !hasRipple && dSq < 0.0008 && vSq < 0.02) {
            px = tx[i]; py = ty[i]; pz = 0; vxi = 0; vyi = 0; vzi = 0;
          } else if (vSq + dSq * 4 > maxKinetic) {
            maxKinetic = vSq + dSq * 4;
          }
        } else if (isFigure[i]) {
          // Act I: 3D chaotic constellation -> helical Coriolis spiral -> orthogonal lock.
          const p = smoother((tNow - delay[i]) / span[i]);
          const invP = 1 - p;

          const curlAmp = (265 * Math.pow(invP, 1.48)) * (minDim / 900);
          let ax = 0, ay = 0, az = 0;
          if (curlAmp > 0.4) {
            curl3At(px, py, pz, tNow * 1.08 + seed[i] * 0.35, curlScale, cVec);
            ax += cVec[0] * curlAmp;
            ay += cVec[1] * curlAmp;
            az += cVec[2] * 1.45 * Math.pow(invP, 1.35);
          }

          // Decaying 3D helical Coriolis swirl around orthogonal lattice home.
          const arcBell = Math.sin(Math.PI * p) * Math.pow(invP, 0.50);
          const omega = swirlSign[i] * (5.6 + 3.1 * seed[i]) * arcBell;
          ax += -dy * omega;
          ay += dx * omega;

          const kSpring = (29.0 + 23.0 * prom[i]) * Math.pow(p, 1.68) / mass[i];
          const damp = 1.50 + 11.8 * Math.pow(p, 1.30);
          ax += dx * kSpring - vxi * damp;
          ay += dy * kSpring - vyi * damp;

          // Pull z smoothly onto the z = 0 paper plane as dot approaches registration.
          const kz = (26.0 + 18.0 * prom[i]) * Math.pow(p, 1.55);
          const dampZ = 1.8 + 10.6 * Math.pow(p, 1.25);
          az += dz * kz - vzi * dampZ;

          vxi += ax * h; vyi += ay * h; vzi += az * h;
          px += vxi * h; py += vyi * h; pz += vzi * h;
          maxKinetic = 100;
        }

        x[i] = px; y[i] = py; z[i] = pz;
        vx[i] = vxi; vy[i] = vyi; vz[i] = vzi;
      }
    }

    if (inIntro && introDoneTime) {
      // Snap any microscopic residual drift so transition into blindfold-lift is razor crisp.
      for (let i = 0; i < count; i++) {
        if (Math.hypot(tx[i] - x[i], ty[i] - y[i]) < 2.2) {
          x[i] = tx[i]; y[i] = ty[i]; z[i] = 0;
          vx[i] = 0; vy[i] = 0; vz[i] = 0;
        }
      }
      phase = 'hold';
      reflect();
    }
  }

  function packInstances() {
    const t = elapsed;
    const bt = breatheTime;
    const isStatic = reduced.matches || preview || !optedIn;
    const waveFreq = 1 / Math.max(420, Math.min(width, height));

    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const px = x[i], py = y[i], pz = z[i];
      const vxi = vx[i], vyi = vy[i];
      const rNow = curR[i];
      const fig = isFigure[i];

      let rad = rNow;
      let alpha = fig ? 0.985 : 0.72;
      let focus = 1.0;

      if (!isStatic && phase === 'assembling') {
        if (fig) {
          const entry = smooth((t - seed[i] * 0.16) / 0.24);
          const spd = Math.hypot(vxi, vyi);
          const flight = clamp(spd / 300, 0, 1);
          const settleF = smooth((t - delay[i]) / span[i]);
          rad = rNow * (0.78 + 0.22 * settleF) * (1 - 0.10 * flight);
          alpha = entry * (0.64 + 0.345 * settleF);
          focus = settleF;
        } else {
          // Iconic background pinpoint register matrix sweeps cleanly into print registration.
          const bgReveal = smooth((t - delay[i]) / span[i]);
          rad = rNow * (0.3 + 0.7 * bgReveal);
          alpha = 0.72 * bgReveal;
        }
      } else if (!isStatic && phase === 'settled') {
        const wave = Math.sin((px * 0.65 + py * 0.76) * waveFreq * 4.0 - bt * 0.54 + seed[i] * 1.4);
        rad = rNow * (1 + (fig ? 0.018 : 0.01) * wave);
        alpha = (fig ? 0.975 : 0.72) + 0.02 * wave;
      }

      instanceData[o] = px;
      instanceData[o + 1] = py;
      instanceData[o + 2] = pz;
      instanceData[o + 3] = vxi;
      instanceData[o + 4] = vyi;
      instanceData[o + 5] = rad;
      instanceData[o + 6] = alpha;
      instanceData[o + 7] = focus;
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
    gl.uniform4f(glLoc.aura, auraCx, auraCy, auraRx, auraRy);
    gl.uniform1f(glLoc.auraOn, auraActive && !isPortraitViewport() ? 1.0 : 0.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuf);
    gl.enableVertexAttribArray(glLoc.quad);
    gl.vertexAttribPointer(glLoc.quad, 2, gl.FLOAT, false, 0, 0);
    if (glExt) glExt.vertexAttribDivisorANGLE(glLoc.quad, 0);
    else gl.vertexAttribDivisor(glLoc.quad, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glInstBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);

    const stride = 32; // 8 floats * 4 bytes
    gl.enableVertexAttribArray(glLoc.posv);
    gl.vertexAttribPointer(glLoc.posv, 4, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(glLoc.meta);
    gl.vertexAttribPointer(glLoc.meta, 4, gl.FLOAT, false, stride, 16);

    if (glExt) {
      glExt.vertexAttribDivisorANGLE(glLoc.posv, 1);
      glExt.vertexAttribDivisorANGLE(glLoc.meta, 1);
      glExt.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
    } else {
      gl.vertexAttribDivisor(glLoc.posv, 1);
      gl.vertexAttribDivisor(glLoc.meta, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
  }

  function render2D() {
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, width, height);
    ctx2d.fillStyle = '#0f0f0e';
    for (let bucket = 0; bucket < 4; bucket++) {
      const lo = bucket * 0.25, hi = lo + 0.25;
      ctx2d.globalAlpha = Math.min(1, lo + 0.16);
      ctx2d.beginPath();
      for (let i = 0; i < count; i++) {
        const o = i * 8;
        const a = instanceData[o + 6];
        if (a <= lo || (bucket < 3 && a > hi)) continue;
        const px = instanceData[o], py = instanceData[o + 1], r = instanceData[o + 5];
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
      held: phase === 'settled',
    });
  }

  function permitted() {
    return active && !disposed && !paused && !preview && optedIn && !reduced.matches &&
      !waitlistOpen() && !document.hidden && !pageSuspended && intersecting && !sleeping && !!grid;
  }

  function reflect() {
    if (!active) return;
    host.dataset.renderer = `halftone-${backend}`;
    host.dataset.halftonePhase = phase;
    host.dataset.materialIdle = phase === 'settled'
      ? (permitted() ? 'running' : 'paused')
      : (permitted() ? phase : 'paused');
    host.dataset.motion = !optedIn || reduced.matches || preview ? 'static' : permitted() ? 'running' : 'static';
  }

  function scheduleIdleSleep() {
    clearTimeout(sleepTimer);
    if (!active || phase !== 'settled' || disposed || paused || sleeping) return;
    sleepTimer = setTimeout(() => {
      if (active && phase === 'settled' && !disposed) {
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
    if (phase === 'settled') scheduleIdleSleep();
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
      if (phase === 'settled') scheduleIdleSleep();
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
    const needsFast = phase !== 'settled' || ptrEnergy > 0.005 || rippleAge < 2.2;
    const minStep = needsFast ? 0 : (1000 / 20 - 0.5);
    const diff = now - lastNow;
    if (diff >= minStep) {
      const dt = Math.min(diff, 50) / 1000;
      lastNow = now;
      elapsed += dt;
      if (phase === 'settled') breatheTime += dt;
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
    if (grid) {
      buildParticles(preserveSettled);
      draw();
    }
  }

  function scheduleResize() {
    if (!active || disposed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!active || disposed || !host.clientWidth || !host.clientHeight) return;
      resize(phase === 'settled');
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
      ptrVx = clamp((nx - ptrX) * 34, -1200, 1200);
      ptrVy = clamp((ny - ptrY) * 34, -1200, 1200);
    }
    ptrX = nx;
    ptrY = ny;
    ptrInside = true;
    ptrEnergy = Math.min(1, ptrEnergy + 0.78);
    wake();
  }

  function onPointerDown(e) {
    if (!active || disposed || reduced.matches || waitlistOpen() || phase === 'assembling') return;
    // Only emit subtle acoustic ripple when clicking bare cotton paper (never links/buttons).
    if (e.target.closest('a, button, input, form, .masthead, .waitlist, .ruth-home')) return;
    const rect = host.getBoundingClientRect();
    rippleX = e.clientX - rect.left;
    rippleY = e.clientY - rect.top;
    rippleAge = 0;
    wake();
  }

  function onPointerLeave() {
    ptrInside = false;
  }

  const resizeObserver = new ResizeObserver(() => {
    updateReadingAura();
    scheduleResize();
  });
  const intersectionObserver = new IntersectionObserver(entries => {
    intersecting = entries[0]?.isIntersecting ?? true;
    sync();
  });
  const waitlistObserver = new MutationObserver(() => {
    updateReadingAura();
    sync();
  });

  initBackend();
  resizeObserver.observe(host);
  intersectionObserver.observe(host);
  waitlistObserver.observe(body, { attributes: true, attributeFilter: ['data-waitlist-open'] });
  document.addEventListener('visibilitychange', sync, events);
  window.addEventListener('pointermove', onPointerMove, { ...events, passive: true });
  window.addEventListener('pointerdown', onPointerDown, { ...events, passive: true });
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
  document.fonts?.ready?.then(() => {
    if (active && !disposed) {
      updateReadingAura();
      if (grid) draw();
    }
  });

  async function start(fresh = true) {
    if (disposed || backend === 'none') return false;
    active = true;
    sleeping = false;
    if (!canvas.isConnected) host.append(canvas);
    canvas.hidden = false;

    try {
      if (!grid) grid = await loadStaticGrid();
      if (disposed || !active) return false;
      resize(!fresh);
      host.classList.add('ready');
      sync();

      // Stream the 268 KB blindfold-lift keyframe track asynchronously during Act I
      // (never downloaded under prefers-reduced-motion: reduce!).
      if (!reduced.matches && !preview && optedIn && !liftTrack) {
        loadLiftTrack().then((track) => {
          if (!disposed && track) liftTrack = track;
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  function deactivate() {
    active = false;
    stop();
    clearTimeout(sleepTimer);
    canvas.hidden = true;
  }

  function onReducedChange() {
    if (!active || disposed || !grid) return;
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
  }

  return {
    start,
    deactivate,
    onReducedChange,
    dispose,
    get phase() { return phase; },
    get count() { return count; },
    get backend() { return backend; },
  };
}

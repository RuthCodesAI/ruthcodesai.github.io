/**
 * Ruth Day Mode: Original 234x132 Orthogonal Halftone + Living Blindfold-Lift,
 * followed by Living Stillness.
 *
 * Choreography:
 *   Act I  (0.0s -> ~12.6s): Immediate Original Blindfold-Lift.
 *     Opens directly on the exact original 234x132 (0-degree orthogonal) halftone
 *     portrait on warm museum stock (zero scatter on initial load) and plays the
 *     full blindfold-lift animation smoothly at 60/120fps across all GPU dots.
 *   Act II (after head turns back to rest): Living Stillness.
 *     Once Justitia lowers her blindfold and her head returns to rest, gentle
 *     living stillness breathes subtly across the exact 0-degree orthogonal print
 *     with zero pointer or cursor disturbance.
 *     Pauses automatically when the waitlist or menu opens, sleeps after 120s of
 *     inactivity, and renders the exact static orthogonal halftone under
 *     prefers-reduced-motion.
 */

const GRID_URL = '/assets/justitia-day-grid.rht?v=2026-ht4';
const LIFT_URL = '/assets/justitia-day-lift.rht?v=2026-ht4';

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
      if (magic !== 'RHT1' && magic !== 'RHT2') return null;
      const cols = view.getUint16(4, true);
      const rows = view.getUint16(6, true);
      const nFrames = view.getUint16(8, true);
      const fps = view.getUint8(10);
      const isV2 = magic === 'RHT2';
      const maxVal = isV2 ? view.getUint8(11) : 63;
      const mask = maxVal; // power-of-two minus 1 (63 or 127)
      const cellCount = cols * rows;
      const raw = new Uint8Array(decompressed, isV2 ? 12 : 11);
      const frames = new Uint8Array(nFrames * cellCount);
      frames.set(raw.subarray(0, cellCount), 0);
      for (let f = 1; f < nFrames; f++) {
        const prevOff = (f - 1) * cellCount;
        const curOff = f * cellCount;
        for (let i = 0; i < cellCount; i++) {
          frames[curOff + i] = (frames[prevOff + i] + raw[curOff + i]) & mask;
        }
      }
      return { cols, rows, nFrames, fps, maxVal, frames };
    }).catch(() => null);
  }
  return cachedLiftPromise;
}

export function createDayHalftone(options) {
  const { host, photo, body, reduced, onFrame } = options;
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
  // Lifecycle phases: 'waiting-lift' -> 'lifting' -> 'settled'
  let phase = 'waiting-lift';
  let liftCompleted = false;
  let rafId = 0, resizeFrame = 0, sleepTimer = 0;
  let lastNow = 0, elapsed = 0, liftElapsed = 0, breatheTime = 0;
  let width = 1, height = 1, dpr = 1, dotPitch = 6.8;
  let cover = { x: 0, y: 0, width: 1, height: 1 };

  let grid = null;
  let liftTrack = null;

  // Structure-of-Arrays particle buffers (zero per-frame GC).
  let count = 0;
  let cellIdx, isFigure;
  let tx, ty;
  let baseR, curR, seed;
  let instanceData; // Float32Array(count * 8): [x, y, z, vx, vy, r, alpha, focus]

  // Live typography reading aura (protects Ruth / headline / CTA legibility cleanly).
  let auraCx = 0, auraCy = 0, auraRx = 1, auraRy = 1, auraActive = 0;

  // WebGL2 / WebGL1 / Canvas 2D backend.
  let gl = null, glExt = null, glProg = null, glQuadBuf = null, glInstBuf = null;
  let glLoc = null, ctx2d = null, backend = 'none';

  const waitlistOpen = () => body.dataset.waitlistOpen === 'true' || body.dataset.menuOpen === 'true';
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function hash2(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

            // Perspective projection relative to sculptural center (z = 0 is the cotton rag paper).
            float focal = 2.65;
            float persp = focal / max(0.55, focal - pz);
            vec2 center = u_res * vec2(0.58, 0.48);
            vec2 projPos = center + (pos2 - center) * persp;
            float projR = r * persp;

            // Optical depth-of-field bloom when dots lift off z = 0 during whirls or cursor wake;
            // razor-sharp letterpress dots when seated on z = 0.
            float depthOff = abs(pz);
            float dofBlur = depthOff * 2.85;
            projR += dofBlur * 0.34;
            float dofFade = 1.0 / (1.0 + depthOff * 1.12);

            // Calligraphic velocity stretch during whirls and cursor wake.
            float spd = length(vel);
            vec2 dir = spd > 2.0 ? (vel / spd) : vec2(1.0, 0.0);
            vec2 perp = vec2(-dir.y, dir.x);
            float stretch = 1.0 + min(2.65, spd * 0.0038);
            float rPerp = projR / pow(stretch, 0.35);
            float halfLen = rPerp * (stretch - 1.0) * 0.96;

            // Live typography reading aura protecting Ruth / headline / CTA.
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

  function radiusFromValue(v, pitchPx, isMobilePortrait) {
    if (v <= 0.195) {
      return isMobilePortrait
        ? pitchPx * 0.088
        : pitchPx * (0.068 + 0.055 * (v / 0.195));
    }
    return pitchPx * Math.min(0.468, v * 0.502);
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
    const isPortrait = isPortraitViewport();
    auraCx = (minX + maxX) * 0.5 - artRect.left;
    auraCy = (minY + maxY) * 0.5 - artRect.top;
    auraRx = isPortrait
      ? Math.max(110, (maxX - minX) * 0.64 + 28)
      : Math.max(90, (maxX - minX) * 0.72 + 44);
    auraRy = isPortrait
      ? Math.max(85, (maxY - minY) * 0.62 + 24)
      : Math.max(80, (maxY - minY) * 0.74 + 42);
    auraActive = 1;
  }

  function computeCover() {
    const iw = 1638, ih = 924;
    if (isPortraitViewport()) {
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

  function buildParticles(preservePhase = false) {
    if (!grid) return;
    computeCover();
    updateReadingAura();

    const { cols, rows, data } = grid;
    const isPortrait = isPortraitViewport();
    const cellW = cover.width / cols;
    const cellH = cover.height / rows;
    dotPitch = Math.min(cellW, cellH);

    const list = [];
    const bgPin = dotPitch * 0.088;
    const minCol = Math.max(0, Math.floor((-dotPitch - cover.x) / cellW));
    const maxCol = Math.min(cols - 1, Math.ceil((width + dotPitch - cover.x) / cellW));
    for (let r = 0; r < rows; r++) {
      const py = cover.y + (r + 0.5) * cellH;
      if (py < -dotPitch || py > height + dotPitch) continue;
      for (let c = minCol; c <= maxCol; c++) {
        const px = cover.x + (c + 0.5) * cellW;
        if (px < -dotPitch || px > width + dotPitch) continue;
        const idx = r * cols + c;
        const v = data[idx] / 255;

        let rad;
        if (isPortrait) {
          const edgeDrop = Math.abs(px / width - 0.52) * height * 0.075;
          const fade = 1 - smooth((py + edgeDrop - height * 0.44) / (height * 0.155));
          const fullRad = radiusFromValue(v, dotPitch, true);
          rad = bgPin + Math.max(0, fullRad - bgPin) * Math.sqrt(fade);
        } else {
          rad = radiusFromValue(v, dotPitch, false);
          if (rad < 0.28) continue;
        }

        const fig = v > 0.215 ? 1 : 0;
        list.push(idx, px, py, rad, fig, c, r);
      }
    }

    // In portrait viewports, continue the exact orthogonal pinpoint sheet seamlessly
    // below Justitia's bust all the way to the bottom edge (zero moire, 1:1 grid lock).
    if (isPortrait) {
      let extraRow = rows;
      for (let py = cover.y + (rows + 0.5) * cellH; py <= height + dotPitch; py += cellH, extraRow++) {
        if (py < -dotPitch) continue;
        for (let c = minCol; c <= maxCol; c++) {
          const px = cover.x + (c + 0.5) * cellW;
          if (px < -dotPitch || px > width + dotPitch) continue;
          list.push(-1, px, py, bgPin, 0, c, extraRow);
        }
      }
    }

    count = list.length / 7;
    cellIdx = new Int32Array(count);
    isFigure = new Uint8Array(count);
    tx = new Float32Array(count);
    ty = new Float32Array(count);
    baseR = new Float32Array(count);
    curR = new Float32Array(count);
    seed = new Float32Array(count);
    instanceData = new Float32Array(count * 8);

    for (let i = 0; i < count; i++) {
      const o = i * 7;
      const idx = list[o], px = list[o + 1], py = list[o + 2], r = list[o + 3];
      const fig = list[o + 4], gc = list[o + 5], gr = list[o + 6];

      cellIdx[i] = idx;
      isFigure[i] = fig;
      // Always stay cleanly registered on the exact original 0-deg orthogonal halftone grid.
      tx[i] = px; ty[i] = py;
      baseR[i] = r; curR[i] = r;
      seed[i] = hash2(gc + 131, gr - 59);
    }

    if (!preservePhase) {
      if (reduced.matches || preview || !optedIn) {
        phase = 'settled';
        liftCompleted = true;
      } else if (liftTrack) {
        phase = 'lifting';
        liftElapsed = 0;
        liftCompleted = false;
      } else {
        phase = 'waiting-lift';
        liftElapsed = 0;
        liftCompleted = false;
      }
      elapsed = 0;
    }

    if (gl && glInstBuf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, glInstBuf);
      gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
    }
    host.dataset.halftoneDots = String(count);
  }

  // Silky 60/120fps linear blend across motion-compensated 24fps zero-deadband keyframes
  // (zero Catmull-Rom ringing, zero deadband popping, 2x native temporal resolution).
  function sampleLiftRadii(tSec) {
    if (!liftTrack) return false;
    const { cols, rows, nFrames, fps, maxVal, frames } = liftTrack;
    const cellCount = cols * rows;
    const isPortrait = isPortraitViewport();
    const fPos = tSec * fps;
    if (fPos >= nFrames - 1) {
      for (let i = 0; i < count; i++) curR[i] = baseR[i];
      return true;
    }

    const f1 = Math.floor(fPos);
    const u = fPos - f1;
    const f2 = Math.min(nFrames - 1, f1 + 1);
    const o1 = f1 * cellCount, o2 = f2 * cellCount;
    const invMax = 1 / (maxVal || 63);

    const bgPin = dotPitch * 0.088;
    for (let i = 0; i < count; i++) {
      const idx = cellIdx[i];
      if (idx < 0) continue;
      const p1 = frames[o1 + idx];
      const p2 = frames[o2 + idx];
      const v = (p1 === p2 ? p1 : (p1 + (p2 - p1) * u)) * invMax;

      let nextR = radiusFromValue(v, dotPitch, isPortrait);
      if (isPortrait) {
        const edgeDrop = Math.abs(tx[i] / width - 0.52) * height * 0.075;
        const fade = 1 - smooth((ty[i] + edgeDrop - height * 0.44) / (height * 0.155));
        nextR = bgPin + Math.max(0, nextR - bgPin) * Math.sqrt(fade);
      }
      curR[i] = nextR;
    }
    return false;
  }

  function stepPhysics(dt) {
    if (!count) return;

    // Act I: Original blindfold-lift animation plays undisturbed from start to finish.
    if (phase === 'waiting-lift') {
      if (liftTrack) {
        phase = 'lifting';
        liftElapsed = 0;
        reflect();
      } else if (elapsed > 5.0) {
        // Fallback if lift track unavailable (e.g. offline/unsupported): unlock settled state.
        liftCompleted = true;
        phase = 'settled';
        scheduleIdleSleep();
        reflect();
      }
      return;
    }

    if (phase === 'lifting') {
      liftElapsed += dt;
      const done = sampleLiftRadii(liftElapsed);
      if (done) {
        liftCompleted = true;
        phase = 'settled';
        scheduleIdleSleep();
        reflect();
      }
      return;
    }

    // Act II (after head turns back): living stillness on the exact orthogonal grid.
    breatheTime += dt;
  }

  function packInstances() {
    const bt = breatheTime;
    const isStatic = reduced.matches || preview || !optedIn;
    const waveFreq = 1 / Math.max(420, Math.min(width, height));
    const breathing = !isStatic && liftCompleted;

    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const px = tx[i], py = ty[i];
      const rNow = curR[i];
      const fig = isFigure[i];

      let rad = rNow;
      let alpha = fig ? 0.985 : 0.72;

      if (breathing && phase === 'settled') {
        const wave = Math.sin((px * 0.65 + py * 0.76) * waveFreq * 4.0 - bt * 0.54 + seed[i] * 1.4);
        rad = rNow * (1 + (fig ? 0.016 : 0.008) * wave);
        alpha = (fig ? 0.978 : 0.72) + 0.018 * wave;
      }

      instanceData[o] = px;
      instanceData[o + 1] = py;
      instanceData[o + 2] = 0;
      instanceData[o + 3] = 0;
      instanceData[o + 4] = 0;
      instanceData[o + 5] = rad;
      instanceData[o + 6] = alpha;
      instanceData[o + 7] = 1.0;
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
    gl.uniform1f(glLoc.auraOn, auraActive ? 1.0 : 0.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuf);
    gl.enableVertexAttribArray(glLoc.quad);
    gl.vertexAttribPointer(glLoc.quad, 2, gl.FLOAT, false, 0, 0);
    if (glExt) glExt.vertexAttribDivisorANGLE(glLoc.quad, 0);
    else gl.vertexAttribDivisor(glLoc.quad, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glInstBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);

    const stride = 32;
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
      held: liftCompleted,
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
    host.dataset.materialIdle = liftCompleted
      ? (permitted() ? 'running' : 'paused')
      : (permitted() ? phase : 'paused');
    host.dataset.motion = !optedIn || reduced.matches || preview ? 'static' : permitted() ? 'running' : 'static';
  }

  function scheduleIdleSleep() {
    clearTimeout(sleepTimer);
    if (!active || !liftCompleted || disposed || paused || sleeping) return;
    sleepTimer = setTimeout(() => {
      if (active && liftCompleted && !disposed) {
        sleeping = true;
        sync();
      }
    }, 120_000);
  }

  function wake() {
    if (!active || disposed || paused) return;
    if (sleeping) {
      sleeping = false;
      sync();
    }
    if (liftCompleted) scheduleIdleSleep();
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
      if (liftCompleted) scheduleIdleSleep();
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
    const needsFast = phase !== 'settled';
    const minStep = needsFast ? 0 : (1000 / 24 - 0.5);
    const diff = now - lastNow;
    if (diff >= minStep) {
      const dt = Math.min(diff, 50) / 1000;
      lastNow = now;
      elapsed += dt;
      stepPhysics(dt);
      draw();
    }
    rafId = requestAnimationFrame(tick);
  }

  function resize(preservePhase = true) {
    width = Math.max(1, Math.round(host.clientWidth));
    height = Math.max(1, Math.round(host.clientHeight));
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    if (grid) {
      buildParticles(preservePhase);
      if (phase === 'lifting' && liftTrack) sampleLiftRadii(liftElapsed);
      draw();
    }
  }

  function scheduleResize() {
    if (!active || disposed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!active || disposed || !host.clientWidth || !host.clientHeight) return;
      resize(true);
      sync();
    });
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
  waitlistObserver.observe(body, { attributes: true, attributeFilter: ['data-waitlist-open', 'data-menu-open'] });
  document.addEventListener('visibilitychange', sync, events);
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
      // Begin fetching the blindfold-lift track immediately in parallel with the static grid
      // (skipped cleanly under prefers-reduced-motion: reduce).
      const liftPromise = (!reduced.matches && !preview && optedIn && !liftTrack)
        ? loadLiftTrack()
        : null;

      if (!grid) grid = await loadStaticGrid();
      if (disposed || !active) return false;

      resize(!fresh);
      host.classList.add('ready');
      sync();

      if (liftPromise) {
        liftPromise.then((track) => {
          if (disposed || !track) return;
          liftTrack = track;
          if (active && phase === 'waiting-lift') {
            phase = 'lifting';
            liftElapsed = 0;
            sync();
          }
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
    resize(false);
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

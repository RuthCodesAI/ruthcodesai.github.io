/**
 * Boxes tied to the ASCII figure. Points are stored in film coordinates and
 * mapped through the renderer's own cover rectangle, so they follow every
 * crop and resize. The hand and head follow tracks measured from the film.
 * Drawing happens only while the ASCII figure is visible; with reduced motion
 * the figure stays a photograph and no boxes are drawn.
 */
import tracks from './figure-tracks.js';

const host = document.getElementById('shader');
if (host && document.body.dataset.study === '16') initializeBoxes(host);

function initializeBoxes(host) {
  const art = host.parentElement, overlay = document.createElement('canvas');
  overlay.className = 'figure-boxes'; overlay.setAttribute('aria-hidden', 'true');
  art.append(overlay);
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  const serif = new URLSearchParams(location.search).get('boxes') === 'serif';
  const mobile = matchMedia('(max-width:650px)'), fine = matchMedia('(hover:hover) and (pointer:fine)');
  const token = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/[\s,]+/).filter(Boolean).join(',')) || fallback;
  const ink = token('--ink-rgb', '245,243,238'), ground = token('--ground-rgb', '16,16,16'), FILM = [1916, 1080];
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t*t*(3-2*t); };

  // kind: head points move with the face, hand points with the tracked hand,
  // still points belong to the fixed body plate. read: show a coordinate readout.
  const points = [
    { kind:'head', at:[.405,.25], read:true }, { kind:'head', at:[.55,.19] },
    { kind:'head', at:[.70,.21], read:true }, { kind:'head', at:[.49,.43] },
    { kind:'head', at:[.525,.485], read:true }, { kind:'head', at:[.555,.585] },
    { kind:'head', at:[.63,.40] },
    { kind:'hand', index:0, read:true, large:true }, { kind:'hand', index:1 },
    { kind:'hand', index:2, read:true }, { kind:'hand', index:3 }, { kind:'hand', index:4 },
    { kind:'still', at:[.905,.30], read:true }, { kind:'still', at:[.79,.64], read:true, large:true },
    { kind:'still', at:[.765,.80] }, { kind:'still', at:[.81,.96] },
    { kind:'still', at:[.445,.815], read:true }, { kind:'still', at:[.33,.93] },
  ];
  const regions = [
    { label:'A-01', kind:'head', box:[.385,.13,.76,.33] },
    { label:'B-02', kind:'hand' },
    { label:'C-03', kind:'still', box:[.70,.585,.985,.99] },
  ];
  // Without a pointer, the target visits these points in turn after the hand leaves.
  const tour = [0, 4, 13, 16, 2, 12];
  // The target reads REVIEW while the hand is at work, then a verdict per stop.
  const verdicts = ['APPROVED', 'GO', 'CLEARED', 'CONFIRMED'];

  let frame = null, width = 1, height = 1, dpr = 1, shown = 0, acquired = -1;
  let pointer = null, pointerAt = -1e9, target = null, tourIndex = 0, tourSince = 0;
  let ripple = -1e9, lastWord = '', calm = 1;
  const decoding = new Map(), cipher = '0123456789ABCDEFKXZ#/+-';

  function sampleTrack(list, time) {
    const f = Math.max(0, Math.min(list.length-1, time*tracks.fps)), i = Math.floor(f), k = f-i;
    const a = list[i], b = list[Math.min(list.length-1, i+1)];
    if (!a || !b) return a || b || null;
    const mix = (p, q) => p == null || q == null ? p ?? q : typeof p === 'number' ? p+(q-p)*k : p.map((v, j) => mix(v, q[j]));
    return mix(a, b);
  }
  function resize() {
    width = Math.max(1, art.clientWidth); height = Math.max(1, art.clientHeight);
    dpr = Math.min(devicePixelRatio || 1, 2);
    overlay.width = Math.round(width*dpr); overlay.height = Math.round(height*dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // Labels arrive as cipher and resolve left to right into their word.
  function decode(key, text, now) {
    const stable = text.replace(/\d+/g, '0');
    let entry = decoding.get(key);
    if (!entry || entry.stable !== stable) decoding.set(key, entry = { stable, since: now });
    const solved = (now-entry.since)/38, beat = Math.floor(now/55);
    if (solved >= text.length) return text;
    let out = '';
    for (let i = 0; i < text.length; i++)
      out += i < solved || text[i] === ' ' ? text[i] : cipher[(i*7+beat*13+key.length*3)%cipher.length];
    return out;
  }
  // Text keeps priority. Marks and labels stay off the headline and wordmark,
  // where only faint lines pass behind. The signup is kept entirely clear:
  // nothing is drawn in its area, closed or open.
  function measureZone() {
    const base = overlay.getBoundingClientRect(), text = [], quiet = [];
    const box = (r, pad) => [r.left-base.left-pad, r.top-base.top-pad, r.right-base.left+pad, r.bottom-base.top+pad];
    for (const el of document.querySelectorAll('h1, .masthead')) {
      if (getComputedStyle(el).opacity === '0') continue;
      for (const r of el.getClientRects()) text.push(box(r, 10));
    }
    const signup = document.querySelector('.waitlist'), panel = document.getElementById('waitlist-panel');
    if (signup) quiet.push(box(signup.getBoundingClientRect(), 18));
    for (const el of document.querySelectorAll('[data-figure-quiet]')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.bottom > 0 && r.top < innerHeight) quiet.push(box(r, 14));
    }
    if (panel && document.body.dataset.waitlistOpen === 'true') {
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const el of [panel, ...panel.querySelectorAll('*')]) {
        const q = el.getBoundingClientRect();
        if (!q.width || !q.height) continue;
        l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      }
      if (r > l) quiet.push(box({ left: l, top: t, right: r, bottom: b }, 18));
    }
    return { text, quiet, labels: [], view: [-base.left+4, -base.top+4, -base.left+innerWidth-4, -base.top+innerHeight-4] };
  }
  const overlaps = (list, x0, y0, x1, y1) => list.some(r => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]);
  const free = (zone, x0, y0, x1, y1, labels = true) =>
    x0 >= zone.view[0] && y0 >= zone.view[1] && x1 <= zone.view[2] && y1 <= zone.view[3] &&
    !overlaps(zone.text, x0, y0, x1, y1) && !overlaps(zone.quiet, x0, y0, x1, y1) && !(labels && overlaps(zone.labels, x0, y0, x1, y1));

  const spacing = () => serif ? .6 : 1.1;
  function font(size) { return serif ? `500 ${size+1.5}px Newsreader, Georgia, serif` : `500 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; }
  function textWidth(text, size) { ctx.font = font(size); return ctx.measureText(text).width+spacing()*(text.length-1); }
  // Labels are placed in priority order; each takes the first free position.
  function place(zone, item, candidates) {
    for (const [x, y] of candidates) {
      const box = [Math.round(x), Math.round(y), Math.round(x+item.w), Math.round(y+item.h)];
      if (free(zone, ...box)) { zone.labels.push([box[0]-3, box[1]-3, box[2]+3, box[3]+3]); return { ...item, box }; }
    }
    return null;
  }
  function tagItem(text, size, alpha, key) { return { text, size, alpha, key, framed: true, w: textWidth(text, size)+size*1.1, h: Math.round(size*1.9) }; }
  function letters(text, x, y, fill) {
    ctx.fillStyle = fill; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) { ctx.letterSpacing = spacing()+'px'; ctx.fillText(text, x, y); ctx.letterSpacing = '0px'; return; }
    for (const c of text) { ctx.fillText(c, x, y); x += ctx.measureText(c).width+spacing(); }
  }
  function drawLabel(label, now) {
    const [x0, y0, x1, y1] = label.box, a = label.alpha;
    if (label.key && !serif) label = { ...label, text: decode(label.key, label.text, now) };
    ctx.font = font(label.size);
    if (label.framed) {
      ctx.fillStyle = `rgba(${ground},${.66*a})`; ctx.fillRect(x0, y0, x1-x0, y1-y0);
      ctx.strokeStyle = `rgba(${ink},${.7*a})`; ctx.lineWidth = 1; ctx.strokeRect(x0+.5, y0+.5, x1-x0-1, y1-y0-1);
      letters(label.text, x0+label.size*.55, (y0+y1)/2, `rgba(${ink},${.94*a})`);
    } else {
      ctx.fillStyle = `rgba(${ground},${.55*a})`; ctx.fillRect(x0-3, y0, x1-x0+6, y1-y0);
      letters(label.text, x0, (y0+y1)/2, `rgba(${ink},${.86*a})`);
    }
  }

  function draw(detail, now) {
    const { cover, time } = detail, visible = smooth(detail.visible);
    if (overlay.width !== Math.round(art.clientWidth*Math.min(devicePixelRatio || 1, 2))) resize();
    ctx.clearRect(0, 0, width, height);
    if (visible <= .01) { shown = 0; acquired = -1; decoding.clear(); return; }
    if (acquired < 0) acquired = now;
    const small = mobile.matches, zone = measureZone();
    // Type and marks grow gently on large screens and stay legible on small ones.
    const size = small ? 9 : Math.max(10.5, Math.min(15, Math.min(innerWidth/128, innerHeight/72))), unit = size/(small ? 11.25 : 10.5);
    const head = sampleTrack(tracks.head, time) || [0, 0], hand = sampleTrack(tracks.hand, time);
    const handBox = sampleTrack(tracks.box, time);
    const toScreen = ([u, v]) => [cover.x+u*cover.width, cover.y+v*cover.height];
    const located = points.map((p, i) => {
      let at = p.kind === 'hand' ? hand?.[p.index] : p.at;
      if (!at) return null;
      if (p.kind === 'head') at = [at[0]+head[0], at[1]+head[1]];
      const [x, y] = toScreen(at), s = (p.large ? 11 : 7)*unit;
      // Each point locks on in sequence: a wide square narrows onto it.
      const lock = smooth((now-acquired-i*55)/260);
      return lock > 0 && free(zone, x-s, y-s, x+s, y+s, false) ? { ...p, i, x, y, s, lock, film:at } : null;
    }).filter(Boolean);
    shown = located.length;

    // Target: the pointer when one is in use, otherwise the pinching fingertip
    // while the hand holds the blindfold, then a slow tour of tracked points.
    let goal = null, word = 'GO';
    // The pointer steers the target only away from the signup. Once it nears
    // the signup, or the form is open, the target returns to the figure.
    const open = document.body.dataset.waitlistOpen === 'true';
    const nearSignup = pointer && zone.quiet.some(r => pointer[0] > r[0]-70 && pointer[0] < r[2]+70 && pointer[1] > r[1]-70 && pointer[1] < r[3]+70);
    const page = window.ruthFigure || {};
    calm += ((open ? .5 : 1)*(page.dim ?? 1)-calm)*.12;
    if (pointer && fine.matches && !open && !nearSignup && now-pointerAt < 2600) goal = pointer;
    else {
      const tip = located.find(p => p.kind === 'hand' && p.index === 0);
      if (tip && time > 2.4 && time < 8.6) { goal = [tip.x, tip.y]; word = 'REVIEW'; }
      else if (located.length) {
        if (now-tourSince > 3400) { tourIndex = (tourIndex+1)%tour.length; tourSince = now; }
        const stop = located.find(p => p.i === tour[tourIndex]) || located[tourIndex%located.length];
        const words = page.verdicts?.length ? page.verdicts : verdicts;
        goal = [stop.x, stop.y]; word = words[tourIndex%words.length];
      }
    }
    if (goal) target = target ? [target[0]+(goal[0]-target[0])*.12, target[1]+(goal[1]-target[1])*.12] : goal.slice();
    if (word !== lastWord) { lastWord = word; ripple = now+420; }
    const tw = Math.round(34*unit), th = Math.round(24*unit);

    // Label placement, in priority order.
    const labels = [], appear = smooth((now-acquired-200)/500);
    if (target) {
      const t = tagItem(word, size, 1, 'target'), [x, y] = target;
      labels.push(place(zone, t, [[x+tw/2+8, y-th/2], [x-tw/2-8-t.w, y-th/2], [x-t.w/2, y+th/2+6], [x-t.w/2, y-th/2-6-t.h]]));
      zone.labels.push([x-tw/2-2, y-th/2-2, x+tw/2+2, y+th/2+2]);
    }
    const frames = [];
    for (const [index, region] of regions.entries()) {
      let box = region.kind === 'hand' ? handBox && [handBox[0]-.012, handBox[1]-.02, handBox[2]+.012, handBox[3]+.02] : region.box;
      if (!box) continue;
      if (region.kind === 'head') box = [box[0]+head[0], box[1]+head[1], box[2]+head[0], box[3]+head[1]];
      const [x0, y0] = toScreen(box), [x1, y1] = toScreen([box[2], box[3]]);
      const cx0 = Math.max(x0, zone.view[0]), cy0 = Math.max(y0, zone.view[1]), cx1 = Math.min(x1, zone.view[2]), cy1 = Math.min(y1, zone.view[3]);
      if (cx1-cx0 < 40 || cy1-cy0 < 30) continue;
      frames.push([cx0, cy0, cx1, cy1]);
      const t = tagItem(page.regions?.[index] || region.label, size, appear, 'region'+index);
      labels.push(place(zone, t, [[cx0, cy0-t.h-3], [cx0+4, cy0+4], [cx1-t.w-4, cy0+4], [cx0+4, cy1-t.h-4]]));
    }
    for (const p of located) if (p.read && p.lock > .9 && (!small || p.large)) {
      const text = `X ${Math.round(p.film[0]*FILM[0])}  Y ${Math.round(p.film[1]*FILM[1])}`;
      const item = { text, size, alpha: 1, key: 'read'+p.i, framed: false, w: textWidth(text, size), h: Math.round(size*1.3) };
      labels.push(place(zone, item, [[p.x+p.s+5, p.y-p.s-item.h], [p.x+p.s+5, p.y+p.s], [p.x-p.s-5-item.w, p.y-p.s-item.h]]));
    }

    // Lines run in full around the text and continue faintly behind it.
    const text = new Path2D(), around = new Path2D(), clear = new Path2D();
    around.rect(0, 0, width, height); clear.rect(0, 0, width, height);
    for (const r of zone.text) { text.rect(r[0], r[1], r[2]-r[0], r[3]-r[1]); around.rect(r[2], r[1], r[0]-r[2], r[3]-r[1]); }
    for (const r of zone.quiet) clear.rect(r[2], r[1], r[0]-r[2], r[3]-r[1]);
    const lines = k => {
      ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${ink},${.32*appear*k})`;
      for (const [x0, y0, x1, y1] of frames) ctx.strokeRect(Math.round(x0)+.5, Math.round(y0)+.5, Math.round(x1-x0), Math.round(y1-y0));
      // A faint constellation between neighbouring points.
      ctx.lineWidth = .6; ctx.strokeStyle = `rgba(${ink},${.11*k})`; ctx.beginPath();
      for (const p of located) {
        let near = null, best = Infinity;
        for (const q of located) if (q !== p) { const d = (q.x-p.x)**2+(q.y-p.y)**2; if (d < best) { best = d; near = q; } }
        if (near) { ctx.moveTo(p.x, p.y); ctx.lineTo(near.x, near.y); }
      }
      ctx.stroke();
      if (!target) return;
      // Leaders fade towards their points. A quiet pulse runs along each,
      // outward on one line and inward on the next.
      for (const p of located) {
        const dx = p.x-target[0], dy = p.y-target[1];
        const line = ctx.createLinearGradient(target[0], target[1], p.x, p.y);
        line.addColorStop(0, `rgba(${ink},${.3*k})`); line.addColorStop(1, `rgba(${ink},${.06*k})`);
        ctx.lineWidth = .7; ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(target[0], target[1]); ctx.lineTo(p.x, p.y); ctx.stroke();
        const phase = (now/3200+p.i*.173)%1, f = p.i%2 ? 1-phase : phase, g = Math.max(0, Math.min(1, f+(p.i%2 ? -.05 : .05)));
        ctx.lineWidth = .9; ctx.strokeStyle = `rgba(${ink},${.3*k*Math.sin(Math.PI*phase)})`; ctx.beginPath();
        ctx.moveTo(target[0]+dx*f, target[1]+dy*f); ctx.lineTo(target[0]+dx*g, target[1]+dy*g); ctx.stroke();
      }
    };
    ctx.save(); ctx.globalAlpha = visible*calm; ctx.clip(clear, 'evenodd');
    ctx.save(); ctx.clip(text); lines(.42); ctx.restore();
    ctx.clip(around, 'evenodd'); lines(1);
    for (const p of located) {
      const s = p.s*(1+1.6*(1-p.lock)), breath = .74+.26*Math.sin(now/900+p.i*1.7);
      ctx.strokeStyle = `rgba(${ink},${.9*p.lock*breath})`; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(p.x-s/2)+.5, Math.round(p.y-s/2)+.5, Math.round(s), Math.round(s));
      ctx.fillStyle = `rgba(${ink},${.9*p.lock*breath})`; ctx.fillRect(Math.round(p.x)-.5, Math.round(p.y)-.5, 1.5, 1.5);
    }
    if (target) {
      // Corner marks instead of a closed box, and a ring that opens when the verdict lands.
      const x0 = Math.round(target[0]-tw/2)+.5, y0 = Math.round(target[1]-th/2)+.5, c = Math.round(tw*.18);
      ctx.strokeStyle = `rgba(${ink},.95)`; ctx.lineWidth = 1.2; ctx.beginPath();
      for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x0+tw, y0, -1, 1], [x0, y0+th, 1, -1], [x0+tw, y0+th, -1, -1]]) {
        ctx.moveTo(x+sx*c, y); ctx.lineTo(x, y); ctx.lineTo(x, y+sy*c);
      }
      ctx.stroke();
      const r = (now-ripple)/900;
      if (r > 0 && r < 1) {
        const grow = 1+smooth(r)*2.4;
        ctx.strokeStyle = `rgba(${ink},${.6*(1-r)})`; ctx.lineWidth = 1;
        ctx.strokeRect(target[0]-tw*grow/2, target[1]-th*grow/2, tw*grow, th*grow);
      }
    }
    for (const label of labels) if (label) drawLabel(label, now);
    ctx.restore();
    host.dataset.figureBoxes = String(shown);
  }

  host.addEventListener('figureframe', event => {
    frame = event.detail;
    draw(frame, performance.now());
  });
  addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const base = overlay.getBoundingClientRect();
    pointer = [event.clientX-base.left, event.clientY-base.top]; pointerAt = performance.now();
  }, { passive: true });
  new ResizeObserver(() => { resize(); if (frame) draw(frame, performance.now()); }).observe(art);
  resize();
}

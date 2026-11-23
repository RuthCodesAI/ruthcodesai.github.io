import { createLivingVideo } from './living-video.js';

const root = document.documentElement;
const dayArt = document.querySelector('.ruth-day-art');
const nightArt = document.querySelector('.art');
const light = matchMedia('(prefers-color-scheme: light)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const preview = new URLSearchParams(location.search).has('preview');
let day;
let pending;
let playingMode = light.matches ? 'day' : 'night';

function frameOf(mode) {
  return (mode === 'day' ? dayArt : nightArt).querySelector('video');
}

function start(mode) {
  const layer = mode === 'day' ? dayArt : nightArt;
  const image = layer.querySelector('img');
  if (mode === 'night') return import('./study-16-ascii.js?v=system-poster');
  if (day) return;
  day = createLivingVideo({ root: dayArt, container: dayArt, photo: image, maxFrameRate: 12 });
  trackNarrowCrop(day);
}

// The halftone film uses the full photographic frame. For particularly narrow
// covers keep the moving right corner of the lips inside the printed image.
function trackNarrowCrop(player) {
  const rightEdge = [1102, 1146, 1210, 1242, 1247, 1249, 1249, 1249, 1227, 1171, 1120, 1099, 1096, 1096];
  const narrow = matchMedia('(max-aspect-ratio: 47/100)');
  let unsubscribe;
  let visibleWidth;
  function position(video) {
    const t = Math.min(video.currentTime, rightEdge.length - 1);
    const i = Math.min(Math.floor(t), rightEdge.length - 2);
    const edge = rightEdge[i] + (rightEdge[i + 1] - rightEdge[i]) * (t - i);
    const hiddenWidth = 1916 - visibleWidth;
    const left = Math.max(.54 * hiddenWidth, edge + 14 - visibleWidth);
    video.style.setProperty('--day-x', (100 * left / hiddenWidth).toFixed(3) + '%');
  }
  function resize() {
    unsubscribe?.();
    unsubscribe = undefined;
    player.video.style.removeProperty('--day-x');
    if (!narrow.matches || !dayArt.clientHeight) return;
    visibleWidth = 1916 * dayArt.clientWidth / dayArt.clientHeight * 924 / 1638;
    if (visibleWidth >= 1916) return;
    position(player.video);
    unsubscribe = player.onFrame(position);
  }
  new ResizeObserver(resize).observe(dayArt);
  narrow.addEventListener('change', resize);
  resize();
}

// Measure the artwork treatment from the original lockup. Theme changes never
// change the typography's layout, and the patch follows wrapping and font load.
const readables = ['.ruth-home', 'h1', '#signup-cta'].map(s => document.querySelector(s));
function setReadingArea() {
  const art = dayArt.getBoundingClientRect();
  if (!art.height || document.body.dataset.waitlistOpen === 'true') return;
  const boxes = readables.map(node => node.getBoundingClientRect());
  const top = boxes[0].top - art.top;
  const height = boxes[2].bottom - boxes[0].top;
  const width = Math.max(...boxes.map(box => box.width));
  dayArt.style.setProperty('--reading-top', top + 'px');
  dayArt.style.setProperty('--reading-y', (top + height / 2) + 'px');
  dayArt.style.setProperty('--reading-rx', (width * .74 + 18) + 'px');
  dayArt.style.setProperty('--reading-ry', (height * .66 + 14) + 'px');
}
const readingObserver = new ResizeObserver(setReadingArea);
[dayArt, ...readables].forEach(node => readingObserver.observe(node));
document.fonts.ready.then(setReadingArea);

// A slow or unavailable movie must not prevent switching to its poster. Stop
// waiting immediately if the user changes their mind or selects reduced motion.
async function until(test, signal, timeout) {
  const end = performance.now() + timeout;
  while (!signal.aborted && performance.now() < end) {
    if (test()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

async function change(mode, signal) {
  const outgoing = frameOf(playingMode);
  const previousTime = outgoing?.currentTime || 0;
  const ended = outgoing?.ended;
  const layer = mode === 'day' ? dayArt : nightArt;
  const image = layer.querySelector('img');
  function align(target) {
    if (!outgoing || reduced.matches || preview || !Number.isFinite(target.duration)) return;
    const stamp = ended || outgoing.ended ? target.duration :
      Math.min(Math.max(previousTime, outgoing.currentTime), target.duration);
    if (stamp > 0 && Math.abs(target.currentTime - stamp) > .06) target.currentTime = stamp;
  }
  // Even on a slow connection, the incoming movie starts at the playhead the
  // previous edition reached. This also runs if the poster was shown first.
  if (!reduced.matches && !preview && previousTime > 0 && !frameOf(mode)?.readyState) {
    layer.addEventListener('loadedmetadata', event => {
      if (root.dataset.ruthTheme === mode || root.dataset.ruthPreparing === mode) align(event.target);
    }, { capture: true, once: true, signal });
  }
  root.dataset.ruthPreparing = mode;
  setReadingArea();
  try {
    Promise.resolve(start(mode)).catch(() => {});
    if (!image.complete) await until(() => image.complete, signal, 1000);
    if (!reduced.matches && !preview && previousTime > 0) {
      const available = await until(() => {
        const film = frameOf(mode);
        return reduced.matches || film?.readyState >= 2 || ['error', 'blocked'].includes(film?.dataset.state);
      }, signal, 2500);
      const target = frameOf(mode);
      if (available && target?.readyState >= 2 && Number.isFinite(target.duration)) {
        // The two editions are the same take. Sample the running playhead after
        // the new film has loaded, then reveal a decoded frame at that instant.
        align(target);
        if (target.seeking) await until(() => !target.seeking && target.readyState >= 2, signal, 1200);
      }
    }
  } catch {
    // The selected artwork still has a native image if a media module fails.
  }
  if (signal.aborted) return;
  playingMode = mode;
  delete root.dataset.ruthPreparing;
  pending = undefined;
  outgoing?.pause();
  setReadingArea();
}

function followSystemAppearance() {
  const mode = light.matches ? 'day' : 'night';
  root.dataset.ruthTheme = mode;
  if (root.dataset.ruthPreparing === mode) return;
  pending?.abort();
  pending = undefined;
  delete root.dataset.ruthPreparing;
  if (mode === playingMode) return;
  pending = new AbortController();
  change(mode, pending.signal);
}

root.dataset.ruthTheme = playingMode;
light.addEventListener('change', followSystemAppearance);
window.addEventListener('pageshow', followSystemAppearance);
Promise.resolve(start(playingMode)).catch(() => {});

import { createLivingVideo } from './living-video.js';

const STORAGE_KEY = 'ruth-edition';
const root = document.documentElement;
const dayArt = document.querySelector('.ruth-day-art');
const nightArt = document.querySelector('.art');
const editionToggle = document.getElementById('edition-toggle');
const motionToggle = document.getElementById('motion-toggle');
const light = matchMedia('(prefers-color-scheme: light)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const preview = new URLSearchParams(location.search).has('preview');

let day;
let night;
let nightLoading;
let pending;

function readStored() {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value === 'day' || value === 'night' ? value : null;
  } catch {
    return null;
  }
}

function writeStored(mode) {
  try {
    if (mode) sessionStorage.setItem(STORAGE_KEY, mode);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

let playingMode = readStored() || (light.matches ? 'day' : 'night');

function frameOf(mode) {
  return (mode === 'day' ? dayArt : nightArt).querySelector('video');
}

function ensurePosterVisible(mode) {
  const layer = mode === 'day' ? dayArt : nightArt;
  const picture = layer.querySelector('picture');
  const img = layer.querySelector('img');
  if (!picture || !img) return;
  const desired = layer.dataset.videoPoster || document.body.dataset.videoPoster;
  if (mode === 'day') {
    const daySrc = dayArt.dataset.videoPoster;
    picture.querySelectorAll('source[media]').forEach(s => {
      if (s.media.includes('prefers-color-scheme')) s.removeAttribute('media');
    });
    if (daySrc && img.getAttribute('src') !== daySrc) img.setAttribute('src', daySrc);
  } else {
    picture.querySelectorAll('source[media]').forEach(s => s.remove());
    if (desired && img.getAttribute('src') !== desired) img.setAttribute('src', desired);
  }
}

function syncChrome(mode) {
  if (editionToggle) {
    const next = mode === 'day' ? 'night' : 'day';
    const label = editionToggle.querySelector('.edition-label');
    if (label) label.textContent = next === 'night' ? 'Code' : 'Print';
    editionToggle.setAttribute('aria-label', next === 'night'
      ? 'Switch to Night code edition'
      : 'Switch to Day print edition');
    editionToggle.setAttribute('aria-pressed', String(mode === 'night'));
    editionToggle.dataset.currentEdition = mode;
  }
  const color = mode === 'day' ? '#f1edea' : '#000000';
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    if (!meta.hasAttribute('media')) meta.content = color;
  });
}

function syncMotionButton() {
  if (!motionToggle) return;
  if (preview) {
    motionToggle.hidden = true;
    return;
  }
  motionToggle.hidden = false;
  if (playingMode === 'day') {
    const st = day?.state;
    const ended = !!st?.ended;
    const active = !!st?.playing || st?.state === 'loading';
    motionToggle.textContent = ended ? 'Replay' : active ? 'Pause' : 'Play';
    motionToggle.setAttribute('aria-label', ended
      ? 'Replay hero motion'
      : active ? 'Pause hero motion' : 'Play hero motion');
  } else {
    const st = night?.state;
    const active = !!st?.active;
    motionToggle.textContent = active ? 'Pause' : 'Play';
    motionToggle.setAttribute('aria-label', active ? 'Pause living code motion' : 'Play living code motion');
  }
}

function start(mode) {
  ensurePosterVisible(mode);
  if (mode === 'night') {
    if (!nightLoading) {
      nightLoading = import('./study-16-ascii.js?v=2026-overhaul').then(async mod => {
        night = await mod.getNightController?.();
        night?.onState(syncMotionButton);
        syncMotionButton();
        return night;
      });
    }
    return nightLoading;
  }
  if (day) return;
  const image = dayArt.querySelector('img');
  day = createLivingVideo({ root: dayArt, container: dayArt, photo: image, maxFrameRate: 12 });
  day.onState(syncMotionButton);
  trackNarrowCrop(day);
  syncMotionButton();
}

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
  dayArt.style.setProperty('--reading-rx', (width * .78 + 24) + 'px');
  dayArt.style.setProperty('--reading-ry', (height * .72 + 22) + 'px');
}
const readingObserver = new ResizeObserver(setReadingArea);
[dayArt, ...readables].forEach(node => readingObserver.observe(node));
document.fonts.ready.then(setReadingArea);

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
  ensurePosterVisible(mode);
  const image = layer.querySelector('img');
  function align(target) {
    if (!outgoing || reduced.matches || preview || !Number.isFinite(target.duration)) return;
    const stamp = ended || outgoing.ended ? target.duration :
      Math.min(Math.max(previousTime, outgoing.currentTime), target.duration);
    if (stamp > 0 && Math.abs(target.currentTime - stamp) > .06) target.currentTime = stamp;
  }
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
        align(target);
        if (target.seeking) await until(() => !target.seeking && target.readyState >= 2, signal, 1200);
      }
    }
  } catch {}
  if (signal.aborted) return;
  playingMode = mode;
  delete root.dataset.ruthPreparing;
  pending = undefined;
  outgoing?.pause();
  setReadingArea();
  syncChrome(mode);
  syncMotionButton();
}

function selectEdition(mode, { persist = false } = {}) {
  root.dataset.ruthTheme = mode;
  if (persist) writeStored(mode);
  syncChrome(mode);
  if (root.dataset.ruthPreparing === mode) return;
  pending?.abort();
  pending = undefined;
  delete root.dataset.ruthPreparing;
  if (mode === playingMode) {
    syncMotionButton();
    return;
  }
  pending = new AbortController();
  change(mode, pending.signal);
}

function followSystemAppearance() {
  if (readStored()) return;
  selectEdition(light.matches ? 'day' : 'night', { persist: false });
}

editionToggle?.addEventListener('click', () => {
  const next = playingMode === 'day' ? 'night' : 'day';
  selectEdition(next, { persist: true });
});

motionToggle?.addEventListener('click', () => {
  if (playingMode === 'day') {
    if (!day) {
      start('day');
      return;
    }
    const st = day.state;
    if (st.ended) day.replay();
    else if (st.playing || st.state === 'loading') day.pause();
    else day.play();
  } else {
    Promise.resolve(start('night')).then(ctrl => {
      if (!ctrl) return;
      if (ctrl.state.active) ctrl.pause();
      else ctrl.play();
      syncMotionButton();
    });
  }
});

root.dataset.ruthTheme = playingMode;
syncChrome(playingMode);
light.addEventListener('change', followSystemAppearance);
window.addEventListener('pageshow', followSystemAppearance);
Promise.resolve(start(playingMode)).catch(() => {});

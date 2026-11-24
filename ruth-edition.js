const STORAGE_KEY = 'ruth-edition';
const lightQuery = matchMedia('(prefers-color-scheme: light)');
const root = document.documentElement;
const toggle = document.getElementById('edition-toggle');
const themeMeta = document.querySelectorAll('meta[name="theme-color"]');

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

export function currentEdition() {
  const explicit = root.dataset.ruthTheme;
  if (explicit === 'day' || explicit === 'night') return explicit;
  return lightQuery.matches ? 'day' : 'night';
}

function syncMeta(mode) {
  const color = mode === 'day' ? '#f1edea' : '#0a0a0a';
  themeMeta.forEach(meta => {
    if (!meta.hasAttribute('media')) meta.content = color;
  });
}

function syncToggle(mode) {
  if (!toggle) return;
  const next = mode === 'day' ? 'night' : 'day';
  const label = toggle.querySelector('.edition-label');
  if (label) label.textContent = next === 'night' ? 'Code' : 'Print';
  toggle.setAttribute('aria-label', next === 'night'
    ? 'Switch to Night code edition'
    : 'Switch to Day print edition');
  toggle.setAttribute('aria-pressed', String(mode === 'night'));
  toggle.dataset.currentEdition = mode;
}

function syncReadingPictures(mode) {
  document.querySelectorAll('picture[data-day-src][data-night-src]').forEach(picture => {
    const img = picture.querySelector('img');
    if (!img) return;
    const desired = mode === 'day' ? picture.dataset.daySrc : picture.dataset.nightSrc;
    if (root.dataset.ruthTheme) {
      picture.querySelectorAll('source').forEach(source => source.remove());
    }
    if (desired && img.getAttribute('src') !== desired) {
      img.setAttribute('src', desired);
    }
  });
}

export function applyReadingEdition(mode, { persist = false } = {}) {
  root.dataset.ruthTheme = mode;
  if (persist) writeStored(mode);
  syncToggle(mode);
  syncMeta(mode);
  syncReadingPictures(mode);
}

// Only auto-initialize on reading pages (homepage uses ruth-theme.js directly).
if (!document.body?.hasAttribute('data-design')) {
  const initial = readStored() || (lightQuery.matches ? 'day' : 'night');
  syncToggle(initial);
  syncMeta(initial);
  if (readStored()) syncReadingPictures(initial);

  toggle?.addEventListener('click', () => {
    const next = currentEdition() === 'day' ? 'night' : 'day';
    applyReadingEdition(next, { persist: true });
  });

  lightQuery.addEventListener('change', () => {
    if (!readStored()) {
      const next = lightQuery.matches ? 'day' : 'night';
      syncToggle(next);
      syncMeta(next);
    }
  });
}

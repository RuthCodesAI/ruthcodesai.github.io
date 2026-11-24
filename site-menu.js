/**
 * Ruth archival monograph mobile navigation menu (<= 680px).
 * Progressively enhances the semantic .masthead / .site-nav on every route:
 *   - Desktop (> 680px): keeps inline About / Team links untouched.
 *   - Mobile (<= 680px): reveals a razor-thin two-hairline toggle at top-right
 *     across every route that morphs in-place into an archival x and opens a
 *     full-viewport laid-cotton (Day) or obsidian (Night) editorial index.
 *   - Accessible: focus management, Tab loop, Escape close, inert toggle,
 *     body[data-menu-open="true"] pauses background canvas animations.
 */

const WORDMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1831 714" aria-hidden="true" focusable="false"><g fill="currentColor"><path fill-rule="evenodd" d="M0 0H267C417 0 505 70 505 185C505 283 439 344 340 369L484 598C508 636 535 673 563 700H421L222 379H126V576C126 627 135 671 149 700H0C14 671 23 627 23 576V124C23 74 14 30 0 0ZM126 58V321H255C350 321 405 272 405 185C405 103 350 58 250 58Z"/><path transform="translate(561 0)" d="M0 214H131C119 246 114 282 114 327V527C114 609 145 654 207 654C254 654 300 619 333 569V327C333 282 328 246 316 214H445C433 246 428 282 428 327V587C428 635 435 672 450 700H333V642C294 690 245 714 184 714C73 714 17 649 17 540V327C17 282 12 246 0 214Z"/><path transform="translate(1042 0)" d="M0 230H64V124L162 89C155 127 152 159 152 195V230H292V286H152V566C152 624 171 653 212 653C246 653 273 640 301 616L324 646C283 692 242 714 188 714C107 714 60 664 60 579V286H0Z"/><path transform="translate(1386 0)" d="M0 0H125C114 33 109 72 109 121V286C146 240 191 214 251 214C358 214 411 279 411 388V587C411 635 418 672 433 700H298C311 672 316 635 316 587V404C316 322 287 279 230 279C182 279 138 311 109 354V587C109 635 116 672 131 700H0C13 672 18 635 18 587V121C18 72 12 33 0 0Z"/></g></svg>`;
const ARROW_SVG = `<svg class="menu-arrow" viewBox="0 0 18 12" aria-hidden="true" focusable="false"><path d="M1 6h15M11 1l5 5-5 5"/></svg>`;
const THEME_GLYPH_SVG = `<svg class="theme-glyph" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M6 1.2a4.8 4.8 0 0 0 0 9.6z" fill="currentColor"/></svg>`;
const THEME_KEY = 'ruth-theme';

function initThemeSwitcher(isHome, menuFootLinks) {
  const lightMq = matchMedia('(prefers-color-scheme: light)');
  const readStored = () => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'day' || t === 'night' ? t : null;
    } catch {
      return null;
    }
  };
  const osTheme = () => (lightMq.matches ? 'day' : 'night');
  const currentTheme = () => readStored() || osTheme();

  const buttons = [];
  function makeButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-switch';
    btn.innerHTML = `${THEME_GLYPH_SVG}<span class="theme-label"></span>`;
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'day' ? 'night' : 'day';
      try {
        if (next === osTheme()) localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, next);
      } catch { /* storage unavailable */ }
      applyTheme(next, true);
    });
    buttons.push(btn);
    return btn;
  }

  // Mobile: discreetly inside the monograph menu footer.
  if (menuFootLinks) {
    menuFootLinks.prepend(makeButton());
  }

  // Larger views: discreetly in the footer (.colophon-links on reading pages,
  // or anchored bottom-left on the Swiss rail on the full-viewport homepage).
  const colophonLinks = document.querySelector('.site-colophon .colophon-links');
  if (colophonLinks) {
    colophonLinks.prepend(makeButton());
  } else if (isHome) {
    const homeFoot = document.createElement('div');
    homeFoot.className = 'home-theme-foot';
    homeFoot.append(makeButton());
    document.body.append(homeFoot);
  }

  function syncAboutPicture(theme, overridden) {
    const pic = document.querySelector('picture.about-print');
    if (!pic) return;
    const sources = [...pic.querySelectorAll('source')];
    const darkSrc = sources.find(s => (s.dataset.origMedia || s.media).includes('dark'));
    const lightSrc = sources.find(s => (s.dataset.origMedia || s.media).includes('light'));
    if (darkSrc && !darkSrc.dataset.origMedia) darkSrc.dataset.origMedia = darkSrc.media;
    if (lightSrc && !lightSrc.dataset.origMedia) lightSrc.dataset.origMedia = lightSrc.media;
    const img = pic.querySelector('img');
    if (img && !img.dataset.origSrc) img.dataset.origSrc = img.getAttribute('src') || '';

    if (overridden) {
      if (darkSrc) darkSrc.media = theme === 'night' ? 'all' : 'not all';
      if (lightSrc) lightSrc.media = theme === 'day' ? 'all' : 'not all';
      if (img) img.src = theme === 'night' ? '/assets/about-justitia-night.webp' : img.dataset.origSrc;
    } else {
      if (darkSrc) darkSrc.media = darkSrc.dataset.origMedia;
      if (lightSrc) lightSrc.media = lightSrc.dataset.origMedia;
      if (img && img.dataset.origSrc) img.src = img.dataset.origSrc;
    }
  }

  function syncThemeColorMeta(theme, overridden) {
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    const lightMeta = metas.find(m => (m.dataset.origMedia || m.media).includes('light'));
    const darkMeta = metas.find(m => (m.dataset.origMedia || m.media).includes('dark'));
    if (lightMeta && !lightMeta.dataset.origMedia) lightMeta.dataset.origMedia = lightMeta.media;
    if (darkMeta && !darkMeta.dataset.origMedia) darkMeta.dataset.origMedia = darkMeta.media;
    if (overridden) {
      if (lightMeta) lightMeta.media = theme === 'day' ? 'all' : 'not all';
      if (darkMeta) darkMeta.media = theme === 'night' ? 'all' : 'not all';
    } else {
      if (lightMeta) lightMeta.media = lightMeta.dataset.origMedia;
      if (darkMeta) darkMeta.media = darkMeta.dataset.origMedia;
    }
  }

  function applyTheme(theme, notify = false) {
    const overridden = readStored() !== null;
    if (overridden || isHome) {
      document.documentElement.dataset.ruthTheme = theme;
    } else {
      delete document.documentElement.dataset.ruthTheme;
    }
    syncAboutPicture(theme, overridden);
    syncThemeColorMeta(theme, overridden);

    const nextLabel = theme === 'day' ? 'Dark' : 'Light';
    const aria = theme === 'day' ? 'Switch to dark mode' : 'Switch to light mode';
    for (const btn of buttons) {
      btn.dataset.theme = theme;
      btn.setAttribute('aria-label', aria);
      const labelEl = btn.querySelector('.theme-label');
      if (labelEl) labelEl.textContent = nextLabel;
    }

    if (notify) {
      window.dispatchEvent(new CustomEvent('ruththemechange', { detail: { theme } }));
    }
  }

  applyTheme(currentTheme(), false);

  lightMq.addEventListener('change', () => {
    if (readStored() === null) {
      applyTheme(osTheme(), false);
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) {
      applyTheme(currentTheme(), true);
    }
  });
}

export function initSiteMenu() {
  const masthead = document.querySelector('body > .masthead');
  const nav = masthead?.querySelector('.site-nav');
  if (!masthead || !nav || document.getElementById('site-menu-toggle')) return;

  document.documentElement.classList.add('has-menu-js');

  const isHome = document.body.hasAttribute('data-design');
  const inlineWaitlist = document.querySelector('[data-inline-waitlist]');
  const currentPath = location.pathname.replace(/index\.html$/, '') || '/';
  const mqDesktop = matchMedia(
    isHome
      ? '(min-width: 900px) and (min-height: 550px) and (min-aspect-ratio: 4/3), (min-width: 1024px) and (min-aspect-ratio: 4/3)'
      : '(min-width: 681px)'
  );

  // Wordless Ruth 3x3 diagonal-graded halftone matrix (6.5px pitch, 18x18)
  // whose 4 cardinal dots glide along a 45-degree pinwheel into the 4 inner
  // diagonal slots, conserving all 9 halftone dots as a pure-dot x on an
  // inverted circular medallion.
  const MATRIX_SVG = `<svg class="menu-matrix" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><g class="mm-dots" fill="currentColor"><circle class="mm-d mm-nw" style="--d:0" cx="2.5" cy="2.5" r="1.78"/><circle class="mm-d mm-n" style="--d:1" cx="9" cy="2.5" r="1.52"/><circle class="mm-d mm-ne" style="--d:2" cx="15.5" cy="2.5" r="1.3"/><circle class="mm-d mm-w" style="--d:1" cx="2.5" cy="9" r="1.52"/><circle class="mm-d mm-ctr" style="--d:2" cx="9" cy="9" r="1.34"/><circle class="mm-d mm-e" style="--d:3" cx="15.5" cy="9" r="1.1"/><circle class="mm-d mm-sw" style="--d:2" cx="2.5" cy="15.5" r="1.3"/><circle class="mm-d mm-s" style="--d:3" cx="9" cy="15.5" r="1.1"/><circle class="mm-d mm-se" style="--d:4" cx="15.5" cy="15.5" r=".92"/></g></svg>`;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'site-menu-toggle';
  toggle.className = 'menu-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'site-menu');
  toggle.setAttribute('aria-label', 'Open navigation menu');
  toggle.innerHTML = MATRIX_SVG;
  masthead.append(toggle);

  // Full-viewport Swiss archival monograph menu overlay.
  const entries = [
    { num: '01', label: 'Home', sub: 'Tailored legal infrastructure', href: '/' },
    { num: '02', label: 'About', sub: 'Four pillars & how Ruth runs', href: '/about/' },
    { num: '03', label: 'Team', sub: 'Jonas Hertner & Joel Niklaus', href: '/team/' },
  ];

  const sheet = document.createElement('div');
  sheet.id = 'site-menu';
  sheet.className = 'site-menu';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Site navigation');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.inert = true;

  const isCurrent = (href) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };

  const rowsHtml = entries.map((item, idx) => {
    const cur = isCurrent(item.href);
    const trailing = cur
      ? `<span class="menu-current" aria-hidden="true"><span class="menu-current-dot"></span>Current</span>`
      : ARROW_SVG;
    return `<li class="menu-row" style="--i:${idx}">
      <a class="menu-link" href="${item.href}"${cur ? ' aria-current="page"' : ''}>
        <span class="menu-num" aria-hidden="true">${item.num}</span>
        <span class="menu-text">
          <span class="menu-title">${item.label}</span>
          <span class="menu-sub">${item.sub}</span>
        </span>
        ${trailing}
      </a>
    </li>`;
  }).join('');

  const waitlistTrigger = (isHome || inlineWaitlist)
    ? `<button type="button" class="menu-waitlist-btn" data-menu-waitlist>Join the waitlist <span class="menu-plus" aria-hidden="true"></span></button>`
    : `<a class="menu-waitlist-btn" href="/?waitlist=1">Join the waitlist <span class="menu-plus" aria-hidden="true"></span></a>`;

  sheet.innerHTML = `
    <div class="site-menu-inner">
      <div class="site-menu-head">
        <a class="menu-imprint" href="/" aria-label="Ruth">${WORDMARK_SVG}</a>
        <button type="button" class="menu-close" aria-label="Close navigation menu">
          ${MATRIX_SVG}
        </button>
      </div>
      <nav class="site-menu-nav" aria-label="Mobile navigation">
        <p class="menu-kicker" aria-hidden="true">Index</p>
        <ol class="menu-list">${rowsHtml}</ol>
      </nav>
      <div class="site-menu-foot">
        ${waitlistTrigger}
        <div class="menu-foot-links">
          <a class="menu-privacy" href="/privacy/"${isCurrent('/privacy/') ? ' aria-current="page"' : ''}>Privacy</a>
        </div>
      </div>
    </div>
  `;

  document.body.append(sheet);
  initThemeSwitcher(isHome, sheet.querySelector('.menu-foot-links'));

  const closeBtn = sheet.querySelector('.menu-close');
  const waitlistBtn = sheet.querySelector('[data-menu-waitlist]');
  let open = false;

  function focusables() {
    return [...sheet.querySelectorAll('a[href], button:not([disabled])')].filter(
      el => el.offsetParent !== null
    );
  }

  function openMenu() {
    if (open) return;
    if (document.body.dataset.waitlistOpen === 'true') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
    open = true;
    document.body.dataset.menuOpen = 'true';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation menu');
    sheet.inert = false;
    sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      const first = sheet.querySelector('.menu-link') || closeBtn;
      first?.focus({ preventScroll: true });
    });
  }

  function closeMenu(restoreFocus = true) {
    if (!open) return;
    open = false;
    document.body.dataset.menuOpen = 'false';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    sheet.inert = true;
    sheet.setAttribute('aria-hidden', 'true');
    if (restoreFocus && !mqDesktop.matches) {
      toggle.focus({ preventScroll: true });
    }
  }

  toggle.addEventListener('click', () => (open ? closeMenu() : openMenu()));
  closeBtn.addEventListener('click', () => closeMenu());

  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeMenu();
    const link = e.target.closest('a[href]');
    if (link && !link.getAttribute('href').includes('?') && isCurrent(link.getAttribute('href'))) {
      e.preventDefault();
      closeMenu();
    }
  });

  waitlistBtn?.addEventListener('click', () => {
    closeMenu(false);
    if (isHome) {
      setTimeout(() => {
        document.getElementById('signup-cta')?.click();
      }, 150);
    } else if (inlineWaitlist) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => {
        inlineWaitlist.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        inlineWaitlist.querySelector('input[type="email"]')?.focus({ preventScroll: true });
      }, 150);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key === 'Tab') {
      const list = focusables();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  mqDesktop.addEventListener('change', (e) => {
    if (e.matches && open) closeMenu(false);
  });
}

initSiteMenu();

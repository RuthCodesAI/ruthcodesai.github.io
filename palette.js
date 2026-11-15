/**
 * Palettes for comparison. Each is a pair of tones for the figure and page
 * (ground and ink), a quieter text tone, and the sheet used for the decision
 * page that follows it, with one accent for what the visitor can change or do.
 * Light palettes draw the figure dark on a light ground.
 * Runs before the figure starts, so the characters are drawn in these tones.
 * Choose with ?palette=name, or add ?palettes to show a control at top right;
 * the choice is kept in this browser.
 */
(() => {
  const palettes = {
    night:     { name: 'Night',     ground: [16, 16, 16],    ink: [242, 240, 235], muted: [201, 198, 192], paper: [255, 255, 255], paperInk: [16, 16, 16], accent: [16, 46, 208] },
    marble:    { name: 'Marble',    ground: [236, 235, 230], ink: [20, 20, 20],    muted: [85, 83, 78],    paper: [255, 255, 255], paperInk: [16, 16, 16],  light: .925, accent: [16, 46, 208] },
    blueink:   { name: 'Blue ink',  ground: [232, 236, 241], ink: [12, 23, 48],    muted: [66, 78, 104],   paper: [255, 255, 255], paperInk: [12, 23, 48],  light: .925, accent: [16, 46, 208] },
    ink:       { name: 'Ink',       ground: [10, 15, 28],    ink: [238, 240, 243], muted: [185, 192, 204], paper: [255, 255, 255], paperInk: [10, 15, 28], accent: [16, 46, 208] },
    oxblood:   { name: 'Oxblood',   ground: [23, 11, 13],    ink: [243, 235, 230], muted: [203, 185, 180], paper: [255, 255, 255], paperInk: [23, 11, 13], accent: [110, 31, 36] },
    verdigris: { name: 'Verdigris', ground: [11, 20, 17],    ink: [233, 239, 234], muted: [181, 196, 188], paper: [255, 255, 255], paperInk: [11, 20, 17], accent: [31, 92, 77] },
  };
  const KEY = 'ruth-palette', root = document.documentElement, body = document.body;
  let chosen = new URLSearchParams(location.search).get('palette');
  try { if (palettes[chosen]) localStorage.setItem(KEY, chosen); else chosen = localStorage.getItem(KEY); } catch {}
  if (!palettes[chosen]) chosen = 'night';
  const p = palettes[chosen], hex = c => '#'+c.map(v => v.toString(16).padStart(2, '0')).join('');
  for (const [token, value] of [['--ground-rgb', p.ground], ['--ink-rgb', p.ink], ['--muted-rgb', p.muted], ['--paper-rgb', p.paper], ['--paper-ink-rgb', p.paperInk], ['--accent-rgb', p.accent]])
    root.style.setProperty(token, value.join(' '));
  root.dataset.palette = chosen;
  if (p.light) { root.dataset.light = ''; root.style.setProperty('--photo-light', String(p.light)); }
  body.dataset.asciiBack = hex(p.ground); body.dataset.asciiFront = hex(p.ink); body.dataset.asciiLight = hex(p.ink);

  addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('.page');
    // The comparison control appears only when asked for with ?palettes.
    if (!page || !new URLSearchParams(location.search).has('palettes')) return;
    const label = document.createElement('label'), hidden = document.createElement('span'), select = document.createElement('select');
    label.className = 'palette'; label.dataset.figureQuiet = '';
    hidden.className = 'visually-hidden'; hidden.textContent = 'Colour palette';
    for (const [key, value] of Object.entries(palettes)) select.add(new Option(value.name, key, false, key === chosen));
    select.addEventListener('change', () => {
      try { localStorage.setItem(KEY, select.value); } catch {}
      const url = new URL(location.href); url.searchParams.set('palette', select.value); location.replace(url.href);
    });
    label.append(hidden, select); page.append(label);
  });
})();

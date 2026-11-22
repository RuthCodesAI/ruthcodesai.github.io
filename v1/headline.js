(() => {
  const heading = document.querySelector('h1');
  const ending = heading?.querySelector('.headline-end');
  const art = document.querySelector('.art');
  const registry = window.CSS?.highlights;
  const name = 'ruth-pending-letters';
  if (!ending || !art || heading.dataset.reveal) return;

  function phase(value) {
    heading.dataset.reveal = value;
    ending.dataset.reveal = value;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const unavailable = new Set(['blocked', 'error', 'preview', 'disposed']);
  function staticView() {
    const state = document.body.dataset.videoState;
    return document.hidden || reduced.matches || forced.matches ||
      document.body.dataset.waitlistOpen === 'true' || !!document.querySelector('dialog[open]') ||
      unavailable.has(state) || (state === 'paused' && !art.querySelector('video')?.ended) ||
      art.querySelector('#shader')?.dataset.renderer === 'photograph';
  }
  // A late script must leave an already painted headline alone.
  if (!registry || !window.Highlight || !CSS.supports('selector(::highlight(ruth-pending-letters))') ||
      staticView() || new URLSearchParams(location.search).has('preview') ||
      (!document.body.dataset.videoSrc && !document.body.dataset.videoWebm && !art.querySelector('video')) ||
      performance.getEntriesByName('first-contentful-paint').length) {
    phase('complete');
    return;
  }

  const stops = [];
  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(document.documentElement.lang || 'en', { granularity: 'grapheme' })
    : null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const letters = segmenter ? Array.from(segmenter.segment(node.data), part => part.segment) : node.data;
    let offset = 0;
    for (const letter of letters) {
      const range = document.createRange();
      range.setStart(node, offset);
      offset += letter.length;
      range.setEnd(node, offset);
      stops.push({ range, letter, count: stops.length + 1 });
    }
  }
  if (!stops.length) { phase('complete'); return; }

  // The head has returned to its opening pose at 10.50s in gentle-lift.mp4.
  const headReturned = 10.5;
  const strokeMs = 74;
  const returnMs = 720;
  const pending = document.createRange();
  pending.setEndAfter(ending);
  const caret = document.createElement('span');
  caret.className = 'headline-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;
  heading.append(caret);

  const events = new AbortController();
  const listen = { signal: events.signal };
  const observed = new MutationObserver(checkFilm);
  const resized = new ResizeObserver(measure);
  let keys = [];
  let video, callback = 0, timer = 0;
  let visible = 0, lastTime = 0, lastAdvance = performance.now();
  let returnBlink;

  function finish() {
    if (events.signal.aborted) return;
    registry.delete(name);
    events.abort();
    observed.disconnect();
    resized.disconnect();
    returnBlink?.cancel();
    caret.remove();
    clearTimeout(timer);
    if (video?.requestVideoFrameCallback) video.cancelVideoFrameCallback(callback);
    else cancelAnimationFrame(callback);
    phase('complete');
  }

  function placeCaret(key) {
    caret.style.transform = `translate(${key.x}px,${key.y}px)`;
    caret.style.height = `${key.height}px`;
  }

  function measure() {
    if (events.signal.aborted) return;
    const box = heading.getBoundingClientRect();
    let row = 0, previousMid;
    keys = [];
    for (const stop of stops) {
      const rect = stop.range.getBoundingClientRect();
      // Collapsed spaces at a wrap or between blocks have no caret position.
      if (!rect.width || !rect.height) continue;
      const mid = rect.top + rect.height / 2;
      if (previousMid !== undefined && mid - previousMid > rect.height / 2) row++;
      previousMid = mid;
      // The Newsreader capitals occupy the upper part of the text range.
      keys.push({
        ...stop, row, x: rect.right - box.left + 1.5,
        y: rect.top - box.top + rect.height * 0.025, height: rect.height * 0.725
      });
    }
    const current = keys.findLast(key => key.count <= visible);
    if (current) {
      placeCaret(current);
      const next = keys.find(key => key.count > visible);
      const atLineEnd = !next || next.row !== current.row;
      if (atLineEnd !== Boolean(returnBlink)) queueNext(current, next);
    }
  }

  function paint(count) {
    visible = count;
    if (count === stops.length) {
      registry.delete(name);
      phase('settling');
    } else {
      const next = stops[count].range;
      pending.setStart(next.startContainer, next.startOffset);
      registry.set(name, new Highlight(pending));
      if (count && heading.dataset.reveal === 'waiting') phase('running');
    }
  }

  function queueNext(current, next) {
    clearTimeout(timer);
    returnBlink?.cancel();
    returnBlink = null;
    if (next && next.row === current.row) {
      delete caret.dataset.return;
      timer = setTimeout(strike, next.letter === ' ' ? strokeMs * 0.8 : strokeMs);
      return;
    }
    // Start the return lit. Show one dark interval and relight the cursor
    // in place before releasing the next keystroke, including at the period.
    caret.dataset.return = '';
    returnBlink = caret.animate([
      { opacity: 1, offset: 0, easing: 'step-end' },
      { opacity: 0, offset: 0.34, easing: 'step-end' },
      { opacity: 1, offset: 0.72 }, { opacity: 1, offset: 1 }
    ], { duration: returnMs, fill: 'both' });
    returnBlink.onfinish = strike;
  }

  function strike() {
    if (events.signal.aborted) return;
    const index = keys.findIndex(key => key.count > visible);
    if (index < 0) { finish(); return; }
    const current = keys[index];
    paint(current.count);
    placeCaret(current);
    caret.hidden = false;
    queueNext(current, keys[index + 1]);
  }

  function onFrame(_, metadata) {
    if (events.signal.aborted || visible) return;
    const time = metadata?.mediaTime ?? video.currentTime;
    if (time > lastTime) { lastAdvance = performance.now(); lastTime = time; }
    if (video.readyState >= 2 && time >= headReturned) {
      strike();
      return;
    }
    callback = video.requestVideoFrameCallback
      ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame);
  }

  function checkFilm() {
    if (staticView()) { finish(); return; }
    if (video) return;
    video = art.querySelector('video');
    if (!video) return;
    for (const type of ['error', 'abort']) video.addEventListener(type, finish, listen);
    video.addEventListener('ended', () => {
      if (!visible) {
        if (video.currentTime >= headReturned) strike();
        else finish();
      }
    }, listen);
    onFrame();
  }

  // Release the static headline if the film stalls before the cue. Once
  // typing begins its clock continues over the film's held final frame.
  function guardPlayback() {
    if (visible || events.signal.aborted) return;
    const remaining = lastAdvance + 2000 - performance.now();
    if (remaining <= 0) finish();
    else timer = setTimeout(guardPlayback, remaining);
  }

  try {
    reduced.addEventListener('change', finish, listen);
    forced.addEventListener('change', finish, listen);
    document.addEventListener('visibilitychange', finish, listen);
    window.addEventListener('pagehide', finish, listen);
    observed.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['open', 'data-waitlist-open', 'data-video-state', 'data-renderer'] });
    phase('waiting');
    paint(0);
    measure();
    resized.observe(heading);
    document.fonts.addEventListener('loadingdone', measure, listen);
    guardPlayback();
    checkFilm();
  } catch { finish(); }
})();

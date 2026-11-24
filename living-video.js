/**
 * Real video playback for Ruth. No synthetic frames are generated here.
 * Import createLivingVideo for an ASCII consumer or native display.
 */
export function createLivingVideo(options = {}) {
  const root = options.root || document.body;
  const container = options.container || root.querySelector('.art');
  const photo = options.photo || root.querySelector('.photo');
  const button = options.button || null;
  const visible = options.visible !== false;
  const doc = root.ownerDocument || document;
  const view = doc.defaultView || window;
  const preview = new URLSearchParams(view.location.search).has('preview');
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = view.matchMedia('(max-width: 650px)');
  const sources = [
    root.dataset.videoWebm && { src: root.dataset.videoWebm, type: 'video/webm' },
    root.dataset.videoSrc && { src: root.dataset.videoSrc, type: root.dataset.videoType || 'video/mp4' },
  ].filter(Boolean);
  const configured = !!container && sources.length > 0;
  const abort = new AbortController(), events = { signal: abort.signal };
  const video = doc.createElement('video');
  const frameListeners = new Set(options.onFrame ? [options.onFrame] : []);
  const stateListeners = new Set(options.onState ? [options.onState] : []);
  const maxFrameRate = Math.max(1, Math.min(30, Number(options.maxFrameRate) || 24));
  let disposed = false, loaded = false, hasFrame = false, hasPlayed = false;
  let userPaused = false, manualAllowed = false, blocked = false, failed = false, ended = false;
  let offscreen = false, pageSuspended = false, playPending = false, playing = false;
  let playEpoch = 0, frameHandle = 0, frameKind = '', lastFrame = -Infinity, lastMediaTime = -1;
  let resizeObserver, intersectionObserver, sourceErrors = 0, state = 'poster';
  const stateIs = () => ({
    state, configured, preview, reducedMotion: reduced.matches, playing,
    hasFrame, hasPlayed, pausedByUser: userPaused, blocked, failed, ended, offscreen, disposed,
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
  });

  video.className = visible ? 'living-video' : 'living-video living-video-source';
  video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
  video.muted = true; video.defaultMuted = true; video.setAttribute('muted', '');
  video.playsInline = true; video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.controls = false; video.loop = root.dataset.videoLoop === 'true';
  video.preload = 'none'; video.autoplay = false;
  video.poster = root.dataset.videoPoster || photo?.currentSrc || photo?.src || '';
  video.disablePictureInPicture = true;
  video.crossOrigin = options.crossOrigin || 'anonymous';

  function motionPermitted() {
    return configured && !disposed && !preview && !userPaused && !blocked && !failed &&
      !ended && !doc.hidden && !offscreen && !pageSuspended && (!reduced.matches || manualAllowed);
  }
  function update(next) {
    state = next;
    root.dataset.videoState = next;
    video.dataset.state = next;
    if (button) {
      button.hidden = disposed || !configured || preview;
      button.disabled = disposed || !configured || preview;
      const label = ended ? 'Replay' : failed ? 'Retry' : playing || playPending ? 'Pause' : 'Play';
      button.textContent = label;
      button.setAttribute('aria-label', ended ? 'Replay hero motion' :
        failed ? 'Retry hero motion' : playing || playPending ? 'Pause hero motion' : 'Play hero motion');
    }
    const snapshot = stateIs();
    for (const listener of stateListeners) {
      try { listener(snapshot); } catch (error) { view.console?.warn('Video state listener failed', error); }
    }
  }
  function align() {
    video.style.objectPosition = mobile.matches && root.dataset.videoPositionMobile ?
      root.dataset.videoPositionMobile : root.dataset.videoPosition ||
      (photo ? view.getComputedStyle(photo).objectPosition : '50% 50%');
  }
  function stopFrames() {
    if (frameHandle) {
      if (frameKind === 'video') video.cancelVideoFrameCallback?.(frameHandle);
      else view.cancelAnimationFrame(frameHandle);
    }
    frameHandle = 0; frameKind = ''; lastFrame = -Infinity; lastMediaTime = -1;
  }
  function emitFrame(now, metadata) {
    if (disposed || preview || video.readyState < 2) return;
    for (const listener of frameListeners) {
      try { listener(video, metadata || { mediaTime: video.currentTime, now }); }
      catch (error) { view.console?.warn('Video frame listener failed', error); }
    }
  }
  function scheduleFrame() {
    if (disposed || !playing || !motionPermitted() || !frameListeners.size || frameHandle) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameKind = 'video';
      frameHandle = video.requestVideoFrameCallback((now, metadata) => {
        frameHandle = 0;
        if (!playing || !motionPermitted()) return;
        if (now - lastFrame >= 1000 / maxFrameRate) {
          lastFrame = Number.isFinite(lastFrame) ? now - (now - lastFrame) % (1000 / maxFrameRate) : now;
          emitFrame(now, metadata);
        }
        scheduleFrame();
      });
    } else {
      frameKind = 'raf';
      frameHandle = view.requestAnimationFrame(now => {
        frameHandle = 0;
        if (!playing || !motionPermitted()) return;
        if (now - lastFrame >= 1000 / maxFrameRate && video.currentTime !== lastMediaTime) {
          lastFrame = Number.isFinite(lastFrame) ? now - (now - lastFrame) % (1000 / maxFrameRate) : now;
          lastMediaTime = video.currentTime;
          emitFrame(now);
        }
        scheduleFrame();
      });
    }
  }
  function cancelPlayback(next) {
    playEpoch++; playPending = false; playing = false;
    video.autoplay = false; video.pause(); stopFrames(); update(next);
  }
  function fail() {
    if (disposed || preview || ended) return;
    failed = true; blocked = false; hasFrame = false;
    video.classList.remove('is-ready');
    cancelPlayback('error');
  }
  function ensureLoaded() {
    if (loaded) return;
    loaded = true; sourceErrors = 0; video.preload = 'auto';
    for (const source of sources) {
      const element = doc.createElement('source');
      element.src = source.src; element.type = source.type;
      element.addEventListener('error', () => {
        sourceErrors++;
        if (sourceErrors >= sources.length) fail();
      }, events);
      video.append(element);
    }
    video.load();
  }
  function attemptPlay() {
    if (!motionPermitted() || playPending || playing) return;
    ensureLoaded();
    video.autoplay = true;
    const epoch = ++playEpoch; playPending = true; update('loading');
    let promise;
    try { promise = video.play(); } catch (error) { promise = Promise.reject(error); }
    Promise.resolve(promise).then(() => {
      if (disposed || epoch !== playEpoch || !motionPermitted()) {
        if (!motionPermitted()) video.pause();
        return;
      }
      playPending = false;
      if (!video.paused) {
        playing = true; hasFrame = video.readyState >= 2; hasPlayed = true;
        if (hasFrame) video.classList.add('is-ready');
        update('playing'); scheduleFrame();
      } else update(hasFrame ? 'paused' : 'poster');
    }).catch(error => {
      if (disposed || epoch !== playEpoch) return;
      playPending = false; playing = false; stopFrames();
      if (!motionPermitted() || error?.name === 'AbortError') { update(hasFrame ? 'paused' : 'poster'); return; }
      if (error?.name === 'NotAllowedError') {
        blocked = true; video.autoplay = false; video.pause(); update('blocked');
      } else fail();
    });
  }
  function reconcile() {
    if (disposed) return;
    if (motionPermitted()) attemptPlay();
    else cancelPlayback(preview ? 'preview' : failed ? 'error' : blocked ? 'blocked' :
      ended ? 'ended' : hasFrame ? 'paused' : 'poster');
  }
  function play() {
    if (disposed || !configured || preview) return;
    if (ended) {
      ended = false;
      try { video.currentTime = 0; } catch {}
    }
    userPaused = false; manualAllowed = true; blocked = false;
    if (failed) {
      failed = false; sourceErrors = 0;
      video.load();
    }
    reconcile();
  }
  function pause() {
    if (disposed) return;
    userPaused = true;
    cancelPlayback(ended ? 'ended' : hasFrame ? 'paused' : 'poster');
  }
  function replay() {
    if (disposed || !configured || preview) return;
    ended = false;
    userPaused = false;
    manualAllowed = true;
    blocked = false;
    failed = false;
    ensureLoaded();
    try { video.currentTime = 0; } catch {}
    reconcile();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; playEpoch++; playPending = false; playing = false;
    stopFrames(); abort.abort(); resizeObserver?.disconnect(); intersectionObserver?.disconnect();
    video.pause(); video.autoplay = false;
    video.removeAttribute('src'); video.querySelectorAll('source').forEach(source => source.remove());
    video.load(); video.remove(); update('disposed');
    frameListeners.clear(); stateListeners.clear();
    root.dataset.videoState = 'disposed';
  }

  video.addEventListener('playing', () => {
    if (!motionPermitted()) { video.pause(); return; }
    playing = true; playPending = false; hasFrame = true; hasPlayed = true;
    video.classList.add('is-ready'); update('playing'); emitFrame(view.performance.now()); scheduleFrame();
  }, events);
  video.addEventListener('pause', () => {
    if (disposed || playPending) return;
    playing = false; stopFrames();
    update(failed ? 'error' : blocked ? 'blocked' : ended ? 'ended' : hasFrame ? 'paused' : 'poster');
  }, events);
  video.addEventListener('loadeddata', () => {
    if (hasPlayed && video.readyState >= 2) { hasFrame = true; emitFrame(view.performance.now()); }
  }, events);
  video.addEventListener('ended', () => {
    emitFrame(view.performance.now()); ended = true; playing = false; playPending = false;
    video.autoplay = false; stopFrames(); update('ended');
  }, events);
  video.addEventListener('error', fail, events);
  video.addEventListener('waiting', () => { if (motionPermitted()) update('loading'); }, events);
  button?.addEventListener('click', () => {
    if (ended) replay();
    else if (playing || playPending) pause();
    else play();
  }, events);
  reduced.addEventListener('change', () => { if (reduced.matches) manualAllowed = false; reconcile(); }, events);
  doc.addEventListener('visibilitychange', reconcile, events);
  view.addEventListener('pagehide', e => {
    pageSuspended = true;
    if (e.persisted) reconcile(); else dispose();
  }, events);
  view.addEventListener('pageshow', e => { if (e.persisted && !disposed) { pageSuspended = false; reconcile(); } }, events);
  view.addEventListener('resize', align, { ...events, passive: true });
  mobile.addEventListener('change', align, events);

  if (configured) {
    container.append(video); align();
    const rect = container.getBoundingClientRect();
    offscreen = rect.bottom <= 0 || rect.right <= 0 || rect.top >= view.innerHeight || rect.left >= view.innerWidth;
    if (typeof view.IntersectionObserver === 'function') {
      intersectionObserver = new view.IntersectionObserver(entries => {
        offscreen = !entries[0]?.isIntersecting; reconcile();
      });
      intersectionObserver.observe(container);
    }
    if (typeof view.ResizeObserver === 'function') {
      resizeObserver = new view.ResizeObserver(align); resizeObserver.observe(container);
    }
  }
  reconcile();
  return {
    video, play, pause, replay, dispose,
    get state() { return stateIs(); },
    onFrame(listener) { frameListeners.add(listener); scheduleFrame(); return () => { frameListeners.delete(listener); if (!frameListeners.size) stopFrames(); }; },
    onState(listener) { stateListeners.add(listener); listener(stateIs()); return () => stateListeners.delete(listener); },
  };
}

if (typeof document !== 'undefined' && document.body?.dataset.videoSrc &&
    document.body.dataset.videoRenderer !== 'ascii' && document.body.dataset.videoAutoinit !== 'false') {
  createLivingVideo();
}

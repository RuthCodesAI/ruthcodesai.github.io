/**
 * Independent study16: a local contact hint, then one full material change.
 * The original film runs once; source-derived cached glyphs continue afterward.
 */
const host = document.getElementById('shader');
if (host && document.body.dataset.study === '16') initializeAscii(host);

async function initializeAscii(host) {
  const body = document.body, photo = body.querySelector('.photo'), button = document.getElementById('motion-toggle');
  const hasVideo = !!(body.dataset.videoSrc || body.dataset.videoWebm);
  const variant = body.dataset.asciiTransition || (hasVideo ? 'direct' : 'flicker');
  const mode = variant === 'shards' || variant === 'head-reveal' ? 'shards' : variant === 'direct' ? 'direct' : 'flicker';
  const preview = new URLSearchParams(location.search).has('preview');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), mobile = matchMedia('(max-width:650px)');
  const optedIn = body.dataset.animate === 'true';
  const abort = new AbortController(), events = { signal: abort.signal };
  let disposed = false, failed = false, ready = false, paused = false, manualAllowed = false;
  let intersecting = true, managedPlaying = false, pageSuspended = false, videoController;
  const isStudy16 = body.dataset.study === '16' && hasVideo;
  let idleReady = false, idleElapsed = 0, sourceLuma, sampledFilmTime = -1;
  let idlePreparing = false;
  let interiorCells;
  const ramp = ' .,:;=+itIH0#@';
  // Equal signs and plus signs form parallel bars across flat skin tones.
  // Use the same density steps, with curved and oblique marks of matched ink.
  const shapes = { 5: 'csov', 6: 'xnuk' };
  const inkRatios = new Map();
  function markAt(level, x, y) {
    const forms = shapes[level];
    if (!forms) return ramp[level];
    let seed = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b);
    seed = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
    return forms[(seed ^ (seed >>> 15)) & 3];
  }
  function markAlpha(density, glyph) {
    return Math.min(1, materialAlpha(density) * (inkRatios.get(glyph) || 1));
  }
  // The material has its own foreground clock. A missed video-end notification
  // must never leave a successfully decoded, completed figure permanently still.
  const hasDecodedFilm = () => isStudy16 && media?.videoWidth > 0 && media.currentTime > 0;
  let livingStrips = [];
  const idleRunning = () => isStudy16 && idleReady && !reduced.matches;
  let frame = 0, resizeFrame = 0, last = 0, elapsed = 0, image, media;
  let resizeObserver, intersectionObserver;
  let width = 1, height = 1, dpr = 1, columns = 1, rows = 1, cell = 7.2, row = 10;
  let cover = { x: 0, y: 0, width: 1, height: 1 };
  const color = (value, fallback) => /^#[\da-f]{6}$/i.test(value || '') ? value : fallback;
  const background = color(body.dataset.asciiBack, '#111b17'), foreground = color(body.dataset.asciiFront, '#efead7');
  const highlight = color(body.dataset.asciiLight, '#fff5dd');
  const bounded = (value, fallback, min, max) => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const duration = bounded(body.dataset.asciiTransitionDuration, mode === 'shards' ? 6.4 : 5.4, 4.5, 12);
  const region = (() => {
    try {
      const values = (body.dataset.asciiHeadRegion || '.62,.33,.255,.39').split(',').map(Number);
      return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0 ? values : [.62,.33,.255,.39];
    } catch { return [.62,.33,.255,.39]; }
  })();
  const canvases = Array.from({ length: 5 }, () => document.createElement('canvas'));
  const [canvas, ink, mask, treatment, sample] = canvases;
  const ctx = canvas.getContext('2d'), inkCtx = ink.getContext('2d'), maskCtx = mask.getContext('2d');
  const treatmentCtx = treatment.getContext('2d'), sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  const matte = isStudy16 ? document.createElement('canvas') : null;
  const matteCtx = matte?.getContext('2d');
  const permitted = () => optedIn && ready && !failed && !disposed && !preview && !paused &&
    !document.hidden && !pageSuspended && intersecting && (!reduced.matches || manualAllowed || hasVideo && managedPlaying) &&
    (!hasVideo || managedPlaying || idleRunning() || hasDecodedFilm());
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t*t*(3-2*t); };

  // The film and held field share one tone law: a clean black point, a smooth
  // shadow toe and open highlights. No temporal brightness modulation is used.
  const materialDensity = luminance => {
    const normalized=Math.max(0,Math.min(1,(luminance-.04)/.96));
    const lifted=Math.pow(normalized,.62);
    const shaped=Math.max(0,Math.min(1,lifted+.20*(lifted-.42)*(1-Math.abs(2*lifted-1))));
    return shaped*smooth((luminance-.04)/.06);
  };
  const materialAlpha = density => .52+.48*density;

  // One restrained exposure around established fingertip/blindfold contact.
  // At30fps: rise90→92, hold92→94, return94→98. No repeated flashes.
  const contactCuts = [[90,0],[92,.46],[94,.46],[98,0]];
  const contactRegion = [.462,.355,.095,.145];
  const fullAsciiPhase = filmTime => smooth((filmTime-142/30)/1.80);
  function contactHint() {
    if (!isStudy16 || preview || reduced.matches || !optedIn || idleReady || !media?.videoWidth) return 0;
    const frame = media.currentTime*30;
    if(frame<=contactCuts[0][0]||frame>=contactCuts[contactCuts.length-1][0])return 0;
    for(let i=1;i<contactCuts.length;i++){
      const [end,to]=contactCuts[i],[start,from]=contactCuts[i-1];
      if(frame<=end)return from+(to-from)*smooth((frame-start)/(end-start));
    }
    return 0;
  }

  function reflect() {
    if (isStudy16) host.dataset.materialIdle = idleReady ? permitted() ? 'running' : 'paused' : 'waiting';
    host.dataset.motion = failed ? 'fallback' : !ready ? 'loading' : permitted() ? 'running' : 'static';
    if (!button || hasVideo) return;
    button.hidden = !optedIn || preview || disposed;
    button.disabled = failed || !ready;
    button.textContent = failed ? 'Still image' : permitted() ? 'Pause motion' : 'Play motion';
    button.setAttribute('aria-label', failed ? 'Still photograph: effect unavailable' :
      permitted() ? 'Pause photo and ASCII transition' : 'Play photo and ASCII transition');
    button.removeAttribute('aria-pressed');
  }
  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; }
  function sync() { stop(); reflect(); if (permitted()) frame = requestAnimationFrame(tick); }
  function tick(now) {
    frame = 0;
    if (!permitted()) { last = 0; reflect(); return; }
    if (!last) last = now;
    if (now-last >= (isStudy16 ? 1000/30-.25 : 50)) {
      const delta = Math.min(now-last, 200)/1000; last = now;
      try {
        if (hasDecodedFilm() && media.ended && !idleReady) { beginLivingCode(); reflect(); }
        if (idleRunning()) idleElapsed += delta;
        elapsed += delta; render(elapsed);
      } catch { fallback(); return; }
    }
    frame = requestAnimationFrame(tick);
  }
  function fallback() {
    
    failed = true; ready = false; stop();
    videoController?.dispose(); host.classList.remove('ready'); canvas.remove();
    host.dataset.renderer = 'photograph';
    if (button) { button.hidden = preview; button.disabled = true; button.textContent = 'Still image'; }
    reflect();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ready = false; stop();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    abort.abort(); resizeObserver?.disconnect(); intersectionObserver?.disconnect();
    videoController?.dispose(); canvas.remove();
    for (const item of canvases.slice(1)) item.width = item.height = 1;
    if (button) { button.hidden = true; button.disabled = true; }
  }
  function sourceSize(value) {
    return { width: value.videoWidth || value.naturalWidth, height: value.videoHeight || value.naturalHeight };
  }
  function updateCover(value) {
    const size = sourceSize(value);
    if (!size.width || !size.height) return false;
    const ratio = Math.max(width/size.width, height/size.height);
    const iw = size.width*ratio, ih = size.height*ratio;
    const positionElement = value.videoWidth ? value : photo;
    const computedPosition=positionElement?getComputedStyle(positionElement).objectPosition:'50% 50%';
    const position=computedPosition.match(/calc\([^)]*\)|[^\s]+/g)||['50%','50%'];
    const offset=(token,available)=>{
      if(token==='left'||token==='top')return 0;
      if(token==='right'||token==='bottom')return available;
      if(!token||token==='center')return available*.5;
      if(/^[-+]?\d*\.?\d+%$/.test(token))return available*parseFloat(token)/100;
      if(/^[-+]?\d*\.?\d+px$/.test(token))return parseFloat(token);
      if(token.startsWith('calc(')){
        const terms=token.slice(5,-1).replace(/\s+/g,'').match(/[+-]?\d*\.?\d+(?:%|px)/g);
        if(terms?.length)return terms.reduce((value,term)=>value+parseFloat(term)*(term.endsWith('%')?available/100:1),0);
      }
      return available*.5;
    };
    cover = { x:offset(position[0],width-iw),y:offset(position[1],height-ih),width:iw,height:ih };
    return true;
  }
  function calibrateMarks() {
    // Measure the actual browser font and pixel ratio once per grid size.
    const atlas = document.createElement('canvas');
    const measures = [...'=+csovxnuk'];
    const w = Math.ceil(cell*dpr)+4, h = Math.ceil(row*dpr)+4;
    atlas.width = w*measures.length; atlas.height = h;
    const a = atlas.getContext('2d', {willReadFrequently:true});
    a.setTransform(dpr,0,0,dpr,0,0);
    a.font = '500 '+(row*.96)+'px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    a.textAlign = 'center'; a.textBaseline = 'middle';
    for (let i=0; i<measures.length; i++) a.fillText(measures[i], (i*w+2)/dpr+cell/2, 2/dpr+row/2, cell*1.08);
    const pixels = a.getImageData(0,0,atlas.width,h).data;
    const mass = new Map();
    for (let i=0; i<measures.length; i++) {
      let sum = 0;
      for (let y=0; y<h; y++) for (let x=0; x<w; x++) sum += pixels[(y*atlas.width+i*w+x)*4+3];
      mass.set(measures[i],sum);
    }
    for (const [level,forms] of Object.entries(shapes)) {
      for (const form of forms) inkRatios.set(form, mass.get(ramp[level]) / (mass.get(form) || 1));
    }
  }
  function paintGlyphs(value) {
    const previousCover = cover;
    if (!updateCover(value)) return;
    if (previousCover.x !== cover.x || previousCover.y !== cover.y || previousCover.width !== cover.width || previousCover.height !== cover.height) makeMask();
    // The last cell may extend past the viewport. Sample by its actual pitch
    // rather than stretching the entire rounded-up grid back into the viewport.
    const sub = isStudy16 ? 2 : 1;
    sampleCtx.clearRect(0,0,sample.width,sample.height);
    sampleCtx.drawImage(value,cover.x/cell*sub,cover.y/row*sub,cover.width/cell*sub,cover.height/row*sub);
    const samples = sampleCtx.getImageData(0,0,sample.width,sample.height), pixels = samples.data;
    const lumaAt = i => (pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722)/255;
    if (isStudy16) {
      if (sourceLuma?.length !== columns*rows) {
        sourceLuma = new Float32Array(columns*rows);
        interiorCells = new Uint8Array(columns*rows);
      }
      sourceLuma.fill(0); interiorCells.fill(1);
      const sw=samples.width, sh=samples.height;
      for (let y=0; y<sh; y++) for (let x=0; x<sw; x++) {
        const i = (y*sw+x)*4, bucket = (y>>1)*columns+(x>>1), luma = lumaAt(i);
        sourceLuma[bucket] += luma*.25;
        // Clip antialiased letter edges to the moving photographed figure.
        // Four source positions per cell retain fine chains, fingers and hair.
        const alpha = smooth((luma-.025)/.035);
        pixels[i+3] = Math.round(255*alpha);
        if (alpha<1) interiorCells[bucket]=0;
      }
      matteCtx.putImageData(samples,0,0);
    }
    inkCtx.clearRect(0,0,width,height);
    inkCtx.textAlign = 'center'; inkCtx.textBaseline = 'middle';
    inkCtx.font = (isStudy16 ? '500 ' : '400 ')+(row*.96)+'px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    inkCtx.fillStyle = foreground;
    for (let y=0;y<rows;y++) for (let x=0;x<columns;x++) {
      const index = y*columns+x;
      const luminance = isStudy16 ? sourceLuma[index] : lumaAt(index*4);
      const density = isStudy16 ? materialDensity(luminance) : Math.pow(luminance,.82);
      const level = Math.min(ramp.length-1,Math.floor(density*ramp.length));
      if (!level) continue;
      const glyph = isStudy16 ? markAt(level,x,y) : ramp[level];
      inkCtx.globalAlpha = isStudy16 ? markAlpha(density,glyph) : .50+.50*density;
      inkCtx.fillText(glyph,(x+.5)*cell,(y+.5)*row,cell*1.08);
    }
    inkCtx.globalAlpha = 1;
    if (isStudy16) {
      inkCtx.globalCompositeOperation='destination-in';
      inkCtx.drawImage(matte,0,0,columns*cell,rows*row);
      inkCtx.globalCompositeOperation='source-over';
    }
    if (isStudy16) sampledFilmTime=value.videoWidth ? value.currentTime : -1;
    if (isStudy16 && idleReady) prepareLivingCode();
    host.dataset.asciiColumns = String(columns); host.dataset.asciiRows = String(rows);
  }
  function makeMask() {
    if (isStudy16) {
      // After the film, this canvas belongs to the opaque cached glyph underlay.
      if(idleReady)return;
      maskCtx.clearRect(0,0,width,height);
      const [x,y,rx,ry]=contactRegion;
      maskCtx.save();maskCtx.translate(cover.x+x*cover.width,cover.y+y*cover.height);
      maskCtx.scale(rx*cover.width,ry*cover.height);
      const feather=maskCtx.createRadialGradient(0,0,.35,0,0,1);
      feather.addColorStop(0,'#fff');feather.addColorStop(.55,'#fffb');feather.addColorStop(1,'#fff0');
      maskCtx.fillStyle=feather;maskCtx.fillRect(-1,-1,2,2);maskCtx.restore();
      return;
    }
    maskCtx.clearRect(0,0,width,height);
    const cx = cover.x+region[0]*cover.width, cy = cover.y+region[1]*cover.height;
    const rx = region[2]*cover.width, ry = region[3]*cover.height;
    maskCtx.save(); maskCtx.translate(cx,cy); maskCtx.scale(rx,ry);
    const gradient = maskCtx.createRadialGradient(0,0,.72,0,0,1);
    gradient.addColorStop(0,'#fff'); gradient.addColorStop(1,'#fff0');
    maskCtx.fillStyle = gradient; maskCtx.fillRect(-1,-1,2,2); maskCtx.restore();
  }
  function resize() {
    width = Math.max(1, Math.round(host.clientWidth)); height = Math.max(1, Math.round(host.clientHeight));
    const budget = mobile.matches ? 850000 : 1600000;
    dpr = Math.min(devicePixelRatio || 1,1.5,Math.sqrt(budget/(width*height)));
    for (const item of [canvas,ink,mask,treatment]) {
      item.width = Math.max(1,Math.round(width*dpr)); item.height = Math.max(1,Math.round(height*dpr));
    }
    for (const context of [ctx,inkCtx,maskCtx,treatmentCtx]) context.setTransform(dpr,0,0,dpr,0,0);
    cell = mobile.matches ? bounded(body.dataset.asciiCellMobile,4.8,isStudy16?3.4:3.8,9) : bounded(body.dataset.asciiCell,7.2,isStudy16?4.5:5,14);
    row = cell*1.4; columns = Math.ceil(width/cell); rows = Math.ceil(height/row);
    const sub = isStudy16 ? 2 : 1;
    sample.width = columns*sub; sample.height = rows*sub;
    if (isStudy16) {
      matte.width=sample.width; matte.height=sample.height;
      calibrateMarks();
    }
    // Prepare glyphs before the3.00s local hint, so initial image/text paint
    // does not compete with invisible glyph rendering.
    if (!isStudy16 || media?.videoWidth && (media.currentTime>=2.74 || idleReady)) paintGlyphs(media || image);
    makeMask();
  }

  // The final frame keeps its geometry and luminance. Characters hold briefly
  // and change in short, asynchronous steps with matched ink coverage.
  function beginLivingCode() {
    if (!isStudy16 || idleReady || idlePreparing || !ready || disposed) return;
    idlePreparing = true;
    try {
      // Native-ended recovery can arrive without the controller's final frame.
      if (media?.videoWidth && (!sourceLuma || sampledFilmTime!==media.currentTime)) paintGlyphs(media);
      prepareLivingCode();
      idleElapsed = 0;
      idleReady = true;
    } catch (error) {
      host.dataset.materialRecovery = 'unavailable';
      fallback();
    } finally {
      idlePreparing = false;
    }
  }
  function prepareLivingCode() {
    try { cacheLivingCode(); }
    catch (error) {
      host.dataset.materialRecovery = 'simple-atlas';
      // Avoid another pixel readback and use a smaller atlas if a browser
      // cannot prepare measured variants. This fallback is attempted only once.
      cacheLivingCode(true);
    }
  }
  // Event-local deterministic randomness changes rhythm, never light or position.
  function livingRandom(tile) {
    let value=tile.seed;value^=value<<13;value^=value>>>17;value^=value<<5;
    tile.seed=value>>>0;return tile.seed/4294967296;
  }
  function scheduleLivingEvent(tile) {
    const viable=tile.masks.filter(bits=>(tile.from^bits)!==tile.previousState);
    const choices=viable.length?viable:tile.masks;
    const double=livingRandom(tile)<.14;
    const preferred=choices.filter(bits=>((bits&(bits-1))!==0)===double);
    const masks=preferred.length?preferred:choices;
    tile.to=tile.from^masks[Math.floor(livingRandom(tile)*masks.length)];
    if(tile.burstRemaining>0){
      tile.hold=.12+livingRandom(tile)*.12;tile.burstRemaining--;
    }else{
      const pace=livingRandom(tile);
      if(pace<.16){tile.burstRemaining=1+Math.floor(livingRandom(tile)*3);tile.hold=.12+livingRandom(tile)*.12;}
      else if(pace>.80)tile.hold=.80+livingRandom(tile)*.80;
      else tile.hold=.22+livingRandom(tile)*.43;
    }
    tile.fade=.08+livingRandom(tile)*.03;
    tile.eventEnd=tile.eventStart+tile.hold+tile.fade;tile.event++;
  }
  function cacheLivingCode(simple = false) {
    if (!sourceLuma) throw new Error('Missing ASCII source');
    const chars = ramp, candidates = [];
    const hash = (x,y) => {
      const value = Math.sin(x*127.1+y*311.7)*43758.5453;
      return value-Math.floor(value);
    };
    const sampleAt = (x,y) => sourceLuma[Math.max(0,Math.min(rows-1,y))*columns+Math.max(0,Math.min(columns-1,x))];
    for (let y=0;y<rows;y++) for (let x=0;x<columns;x++) {
      const luma=sourceLuma[y*columns+x], density=materialDensity(luma);
      const glyph=Math.min(chars.length-1,Math.floor(density*chars.length));
      // Edge cells retain their matted source glyph when the atlas changes.
      if (!glyph || !interiorCells[y*columns+x]) continue;
      const original=markAt(glyph,x,y);
      const px=(x+.5)*cell, py=(y+.5)*row;
      candidates.push({x:px,y:py,column:x,row:y,glyph,original,luma,alpha:markAlpha(density,original)});
    }
    const budget=simple ? 2400 : 7500;
    const font='500 '+(row*.96)+'px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

    // Rasterise each glyph once inside its owned cell. Atlas states reuse these pixels.
    const families=[' ','.,:',',;:',':;!',';:!i','csov','xnuk','il!rjtf','tfjry','ITL7FJ','HNKMEXZ','0ODQ8BCG','#%&8BMW','@WM8B%&'];
    const palette=[...new Set(families.join(''))].filter(c=>c!==' ');
    const gw=cell*dpr,gh=row*dpr,sw=Math.ceil(gw)+4,sh=Math.ceil(gh)+4;
    const sheet=document.createElement('canvas');sheet.width=sw*palette.length;sheet.height=sh;
    const sc=sheet.getContext('2d',{willReadFrequently:true});if(!sc)throw new Error('Glyph raster unavailable');
    sc.font=font;sc.textAlign='center';sc.textBaseline='middle';sc.fillStyle=foreground;
    for(let i=0;i<palette.length;i++){
      sc.save();sc.setTransform(dpr,0,0,dpr,0,0);sc.beginPath();sc.rect((i*sw+2)/dpr,2/dpr,cell,row);sc.clip();
      sc.font=font;sc.fillText(palette[i],(i*sw+2)/dpr+cell*.5,2/dpr+row*.5,cell*1.08);sc.restore();
    }
    const pixels=sc.getImageData(0,0,sheet.width,sheet.height).data,info=new Map(),distances=new Map();
    for(let i=0;i<palette.length;i++){
      const mask=new Uint8Array(Math.ceil(gw)*Math.ceil(gh));let coverage=0;
      for(let y=0;y<Math.ceil(gh);y++)for(let x=0;x<Math.ceil(gw);x++){
        const alpha=pixels[((y+2)*sheet.width+i*sw+x+2)*4+3];mask[y*Math.ceil(gw)+x]=alpha;coverage+=alpha;
      }
      info.set(palette[i],{id:i,sx:i*sw+2,sy:2,coverage:simple?1:coverage,mask});
    }
    const distance=(a,b)=>{
      if(a===b)return 0;if(simple)return 1;
      const x=info.get(a),y=info.get(b),key=Math.min(x.id,y.id)*256+Math.max(x.id,y.id);
      if(distances.has(key))return distances.get(key);
      let d=0;const ratio=x.coverage/y.coverage;
      for(let i=0;i<x.mask.length;i++)d+=Math.abs(x.mask[i]-y.mask[i]*ratio);
      d/=2*x.coverage;distances.set(key,d);return d;
    };
    const optionsByGlyph=new Map();
    for(let n=1;n<chars.length;n++) for(const original of (shapes[n] || chars[n])){
      const base=info.get(original),family=new Set(families[n]);
      // Favor the same density ramp and nearby stroke families used by the film.
      // Avoid compensating a much heavier glyph into a faint, blurred substitute.
      const options=base.coverage?palette.filter(g=>{
        const candidate=info.get(g),ramp=chars.indexOf(g),ratio=base.coverage/candidate.coverage;
        return g!==original&&candidate.coverage>0&&ratio>=.87&&ratio<=1.15&&
          (family.has(g)||ramp>0&&Math.abs(ramp-n)<=2)&&distance(original,g)>=.18;
      }):[];
      const score=g=>{
        const ramp=chars.indexOf(g),ratio=base.coverage/info.get(g).coverage;
        return (ramp>0?Math.abs(ramp-n)*.10:.28)+Math.abs(Math.log(ratio))*.8-distance(original,g)*.25;
      };
      options.sort((a,b)=>score(a)-score(b));optionsByGlyph.set(original,options);
    }
    let changing=[];
    for(const item of candidates){
      const original=item.original,base=info.get(original);if(!base.coverage)continue;
      const target=item.alpha*base.coverage,pool=[original];
      const neighbors=new Set([
        sampleAt(item.column-1,item.row),sampleAt(item.column+1,item.row),
        sampleAt(item.column,item.row-1),sampleAt(item.column,item.row+1)
      ].map(luma=>chars[Math.min(chars.length-1,Math.floor(materialDensity(luma)*chars.length))]));
      // Actual nearby source tones choose the first alternatives, not random letters.
      const options=[...optionsByGlyph.get(original)].sort((a,b)=>Number(neighbors.has(b))-Number(neighbors.has(a)));
      for(const g of options){
        if(target/info.get(g).coverage<=1&&pool.every(p=>distance(p,g)>=.12))pool.push(g);
        if(pool.length===4)break;
      }
      if(pool.length<2)continue;
      item.forms=pool;item.targetCoverage=target;changing.push(item);
    }
    // A spatial round-robin budget keeps distant occupied parts represented.
    // It never ranks the head above a low-ink hand, outline or scale glyph.
    const eligibleCount=changing.length;
    if(changing.length>budget){
      const bins=new Map();
      for(const item of changing){
        const key=Math.floor(item.column/16)+':'+Math.floor(item.row/12);
        if(!bins.has(key))bins.set(key,[]);bins.get(key).push(item);
      }
      const occupied=[...bins.values()];
      for(const bin of occupied)bin.sort((a,b)=>hash(a.column+19,a.row+43)-hash(b.column+19,b.row+43));
      const selected=[];
      for(let rank=0;selected.length<budget;rank++){
        let found=false;
        for(const bin of occupied)if(rank<bin.length){
          selected.push(bin[rank]);found=true;if(selected.length===budget)break;
        }
        if(!found)break;
      }
      changing=selected;
    }
    if(!changing.length)throw new Error('No distinct ASCII variants');
    // Small disjoint rectangles retain original static neighbors and bound draw calls.
    let tileColumns=6,tileRows=3,groups;
    const groupCells=()=>{
      const map=new Map();
      for(const item of changing){
        const bx=Math.floor(item.column/tileColumns),by=Math.floor(item.row/tileRows),key=bx+':'+by;
        if(!map.has(key))map.set(key,{column:bx*tileColumns,row:by*tileRows,items:[]});map.get(key).items.push(item);
      }
      return [...map.values()];
    };
    groups=groupCells();
    while(groups.length>300){if(tileColumns<=tileRows*2)tileColumns+=4;else tileRows+=2;groups=groupCells();}
    livingStrips=groups;
    const stateCount=8;
    // Pixel-align the tile bounds, then build from one immutable snapshot.
    // This also avoids sampling neighboring states across fractional atlas seams.
    maskCtx.globalAlpha=1; maskCtx.fillStyle=background; maskCtx.fillRect(0,0,width,height);
    maskCtx.drawImage(ink,0,0,ink.width,ink.height,0,0,width,height);
    const base=maskCtx.getImageData(0,0,mask.width,mask.height);
    const basePixels=new Uint32Array(base.data.buffer);
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    const front=rgb(foreground), back=rgb(background);
    const colors=new Uint8ClampedArray(256*4);
    for(let alpha=0;alpha<256;alpha++){
      for(let c=0;c<3;c++) colors[alpha*4+c]=back[c]+(front[c]-back[c])*alpha/255;
      colors[alpha*4+3]=255;
    }
    const tones=new Uint32Array(colors.buffer);
    let atlasBytes=0;
    for(const tile of groups){
      const left=Math.round(tile.column*cell*dpr), top=Math.round(tile.row*row*dpr);
      const right=Math.min(mask.width,Math.round((tile.column+tileColumns)*cell*dpr));
      const bottom=Math.min(mask.height,Math.round((tile.row+tileRows)*row*dpr));
      const tw=right-left, th=bottom-top;
      tile.x=left/dpr; tile.y=top/dpr; tile.width=tw/dpr; tile.height=th/dpr; tile.tiles=[];
      // Three interleaved cohorts make each cached-state change sparse inside
      // the tile. Source-near alternatives differ per cell, without a moving grid.
      tile.items.sort((a,b)=>hash(a.column+73,a.row+11)-hash(b.column+73,b.row+11));
      tile.groupMask=0;
      tile.items.forEach((item,k)=>{
        item.cohort=k%3;tile.groupMask|=1<<item.cohort;
        const original=item.original,choices=item.forms.slice(1);
        const alternate=choices[(item.glyph+Math.round(item.luma*4096))%choices.length];
        item.variants=Array.from({length:stateCount},(_,state)=>(state>>item.cohort)&1?alternate:original);
        item.variantAlpha=item.variants.map(g=>item.targetCoverage/info.get(g).coverage);
      });
      tile.masks=[1,2,4,3,5,6].filter(bits=>(bits&tile.groupMask)===bits);
      tile.seed=(Math.floor(hash(tile.column+17,tile.row+3)*4294967296)>>>0)||1;
      tile.from=Math.floor(livingRandom(tile)*stateCount)&tile.groupMask;
      tile.previousState=-1;tile.event=0;tile.burstRemaining=0;tile.eventStart=idleElapsed;
      scheduleLivingEvent(tile);
      const offset=livingRandom(tile)*(tile.hold+tile.fade);
      tile.eventStart-=offset;tile.eventEnd-=offset;
      // Each strip contains only this tile's eight immutable variants. Fill the
      // pixels in one pass, so software compositors never replay a large display
      // list of nearly identical canvas draws when the native movie ends.
      const sprite=document.createElement('canvas');
      sprite.width=tw*stateCount; sprite.height=th; tile.sprite=sprite;
      const spriteCtx=sprite.getContext('2d'), rgba=spriteCtx.createImageData(sprite.width,th);
      const out=new Uint32Array(rgba.data.buffer);
      atlasBytes+=out.byteLength;
      for(let state=0;state<stateCount;state++){
        const sx=state*tw;
        tile.tiles.push({sx,sy:0});
        for(let y=0;y<th;y++){
          const start=(top+y)*base.width+left;
          out.set(basePixels.subarray(start,start+tw),y*sprite.width+sx);
        }
        for(const item of tile.items){
          if(!(state&(1<<item.cohort))) continue;
          const glyph=info.get(item.variants[state]), alpha=item.variantAlpha[state];
          const x0=Math.max(0,Math.round(item.column*cell*dpr)-left);
          const y0=Math.max(0,Math.round(item.row*row*dpr)-top);
          const x1=Math.min(tw,Math.round((item.column+1)*cell*dpr)-left);
          const y1=Math.min(th,Math.round((item.row+1)*row*dpr)-top);
          const glyphWidth=Math.ceil(gw),glyphHeight=Math.ceil(gh);
          for(let y=y0;y<y1;y++){
            const gy=Math.min(glyphHeight-1,Math.floor((y-y0+.5)*glyphHeight/(y1-y0)));
            for(let x=x0;x<x1;x++){
              const gx=Math.min(glyphWidth-1,Math.floor((x-x0+.5)*glyphWidth/(x1-x0)));
              out[y*sprite.width+sx+x]=tones[Math.min(255,Math.round(glyph.mask[gy*glyphWidth+gx]*alpha))];
            }
          }
        }
      }
      spriteCtx.putImageData(rgba,0,0);
    }
    sheet.width=sheet.height=1;
    host.dataset.materialMode=simple?'glyph-tiles-simple':'glyph-tiles';host.dataset.materialBackend='canvas';
    host.dataset.materialChangingCells=String(changing.length);host.dataset.materialGroups=String(groups.length);
    host.dataset.materialMaxDraws=String(2+groups.length*2);host.dataset.materialAtlasBytes=String(atlasBytes);
    host.dataset.materialTileCells=tileColumns+'x'+tileRows;
    host.dataset.materialEligibleCells=String(eligibleCount);
    host.dataset.materialBudgetedCells=String(changing.length);
    host.dataset.materialCohortLimitedTiles=String(groups.filter(tile=>tile.groupMask!==7).length);
  }
  function renderLivingCode(t) {
    if(!idleReady)return;
    treatmentCtx.globalAlpha=1;treatmentCtx.drawImage(mask,0,0,mask.width,mask.height,0,0,width,height);
    for(const tile of livingStrips){
      // The foreground clock stops while hidden or reduced. The minimum event
      // is at least one capped clock step; the four-event guard bounds catch-up.
      let advances=0;
      while(idleElapsed>=tile.eventEnd&&advances++<4){
        tile.previousState=tile.from;tile.from=tile.to;tile.eventStart=tile.eventEnd;
        scheduleLivingEvent(tile);
      }
      const blend=smooth((idleElapsed-tile.eventStart-tile.hold)/tile.fade);
      const a=tile.tiles[tile.from],b=tile.tiles[tile.to];
      treatmentCtx.globalAlpha=1;treatmentCtx.drawImage(tile.sprite,a.sx,a.sy,tile.width*dpr,tile.height*dpr,tile.x,tile.y,tile.width,tile.height);
      if(blend>0){treatmentCtx.globalAlpha=blend;treatmentCtx.drawImage(tile.sprite,b.sx,b.sy,tile.width*dpr,tile.height*dpr,tile.x,tile.y,tile.width,tile.height);}
    }
    treatmentCtx.globalAlpha=1;
  }
  function transition(t) {
    if (isStudy16) {
      if (preview || reduced.matches && !idleReady || !optedIn) return 0;
      const filmTime = media?.videoWidth ? media.currentTime : 0;
      return fullAsciiPhase(filmTime);
    }
    if (mode === 'direct') return 1;
    const keys = [[0,0],[.11,0],[.23,.88],[.37,.16],[.52,.96],[.67,.34],[1,1]];
    const progress = Math.min(1,t/duration);
    for (let i=1;i<keys.length;i++) {
      if (progress <= keys[i][0]) {
        const a = keys[i-1], b = keys[i];
        return a[1]+(b[1]-a[1])*smooth((progress-a[0])/(b[0]-a[0]));
      }
    }
    return 1;
  }
  function render(t) {
    const living=isStudy16 && idleReady;
    if (!living) ctx.clearRect(0,0,width,height);
    treatmentCtx.globalCompositeOperation = 'source-over'; treatmentCtx.globalAlpha = 1;
    if (living) renderLivingCode(t);
    else {
      treatmentCtx.fillStyle=background; treatmentCtx.fillRect(0,0,width,height);
      treatmentCtx.drawImage(ink,0,0,ink.width,ink.height,0,0,width,height);
    }
    if (!isStudy16) {
    // Quiet illumination is the only ongoing movement without a real video clip.
    treatmentCtx.save();
    const center = width*(.5+.42*Math.sin(t*.12)), band = Math.max(140,width*.23);
    const light = treatmentCtx.createLinearGradient(center-band,0,center+band,height);
    light.addColorStop(0,'#fff0'); light.addColorStop(.5,highlight); light.addColorStop(1,'#fff0');
    treatmentCtx.globalCompositeOperation = 'source-atop'; treatmentCtx.globalAlpha = .055;
    treatmentCtx.fillStyle = light; treatmentCtx.fillRect(0,0,width,height); treatmentCtx.restore();
    }
    if (mode === 'shards') {
      treatmentCtx.globalCompositeOperation = 'destination-in';
      treatmentCtx.drawImage(mask,0,0,mask.width,mask.height,0,0,width,height);
      treatmentCtx.globalCompositeOperation = 'source-over';
      const bands = 7, bandHeight = height/bands, settled = [.94,.42,1,.58,.90,.34,.95];
      for (let i=0;i<bands;i++) {
        const alpha = smooth((t/duration-i*.085)/.40)*settled[i];
        const y = i*bandHeight, slant = width*.045;
        ctx.save(); ctx.beginPath();
        ctx.moveTo(0,y-slant); ctx.lineTo(width,y+slant);
        ctx.lineTo(width,y+bandHeight+slant); ctx.lineTo(0,y+bandHeight-slant);
        ctx.closePath(); ctx.clip(); ctx.globalAlpha = alpha;
        ctx.drawImage(treatment,0,0,treatment.width,treatment.height,0,0,width,height); ctx.restore();
      }
    } else {
      if (isStudy16 && idleReady) {
        // Fade the cached field into the evolving glyph atlas without a
        // rasterisation jump. The material stays opaque throughout the handoff.
        const arrival=smooth(idleElapsed/2.4);
        if (arrival<1) {
          ctx.fillStyle=background; ctx.fillRect(0,0,width,height);
          ctx.drawImage(ink,0,0,ink.width,ink.height,0,0,width,height);
        }
        ctx.globalAlpha=arrival;
      } else {
        const full=transition(t),hint=contactHint();
        if(isStudy16&&hint>0&&full===0){
          treatmentCtx.globalCompositeOperation='destination-in';
          treatmentCtx.drawImage(mask,0,0,mask.width,mask.height,0,0,width,height);
          treatmentCtx.globalCompositeOperation='source-over';
          ctx.globalAlpha=hint;
        }else ctx.globalAlpha=full;
      }
      ctx.drawImage(treatment,0,0,treatment.width,treatment.height,0,0,width,height);
      ctx.globalAlpha = 1;
    }
    // Shares the cover rectangle and film clock with the figure boxes.
    if (isStudy16) host.dispatchEvent(new CustomEvent('figureframe', { detail: {
      cover: { ...cover }, time: media?.videoWidth ? media.currentTime : 0,
      visible: living ? 1 : transition(t), held: living,
    } }));
  }

  function scheduleResize() {
    if (!ready || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0; if (!ready || disposed) return;
      // A system appearance change hides this layer. Keep its last full-size
      // glyph atlas until ResizeObserver reports the visible dimensions again.
      if (!host.clientWidth || !host.clientHeight) return;
      try { resize(); render(elapsed); } catch { fallback(); }
    });
  }

  try {
    if (!ctx || !inkCtx || !maskCtx || !treatmentCtx || !sampleCtx || isStudy16 && !matteCtx) throw new Error('Canvas unavailable');
    image = new Image(); image.decoding = 'async'; image.src = body.dataset.videoPoster || photo?.currentSrc || photo?.src || 'assets/video/gentle-lift-poster.webp';
    await image.decode(); if (disposed) return;
    canvas.setAttribute('aria-hidden','true'); host.append(canvas);
    elapsed = preview || reduced.matches || !optedIn ? duration : 0;
    resize(); render(elapsed); ready = true; host.classList.add('ready');
    host.dataset.renderer = 'living-ascii-'+mode;
    host.dataset.videoSource = hasVideo ? 'configured' : 'none';
    resizeObserver = new ResizeObserver(scheduleResize); resizeObserver.observe(host);
    intersectionObserver = new IntersectionObserver(entries => {
      intersecting = entries[0]?.isIntersecting ?? true; sync();
    }); intersectionObserver.observe(host);
    if (hasVideo) {
      body.dataset.videoRenderer = 'ascii';
      const { createLivingVideo } = await import('./living-video.js');
      if (disposed) return;
      videoController = createLivingVideo({
        root: body, button, visible: true, maxFrameRate: isStudy16 ? 20 : 12,
        onFrame(value) {
          if (!ready || disposed) return;
          try {
            media = value;
            if (!isStudy16 || !idleReady && value.currentTime>=2.74) paintGlyphs(value);
            if (!isStudy16) render(elapsed);
          } catch { fallback(); }
        },
        onState(value) {
          managedPlaying = value.playing || value.state === 'loading';
          if (isStudy16 && value.ended && ready && !disposed && !idleReady) beginLivingCode();
          if (value.failed && ready && !disposed) {
            media = image; paintGlyphs(image); render(elapsed);
          }
          sync();
        },
      });
    }
    sync();
  } catch { fallback(); }

  button?.addEventListener('click', () => {
    if (hasVideo || !ready || failed || preview) return;
    if (permitted()) paused = true;
    else { paused = false; if (reduced.matches && !manualAllowed) elapsed = 0; manualAllowed = true; }
    sync();
  }, events);
  reduced.addEventListener('change', () => {
    if (reduced.matches) { manualAllowed = false;  }
    if (isStudy16 && ready && !disposed) render(elapsed);
    sync();
  }, events);
  document.addEventListener('visibilitychange', sync, events);
  mobile.addEventListener('change', scheduleResize, events);
  window.addEventListener('pagehide', e => { pageSuspended = true; if (e.persisted) sync(); else dispose(); }, events);
  window.addEventListener('pageshow', e => { if (e.persisted && !disposed) { pageSuspended = false; sync(); } }, events);
}

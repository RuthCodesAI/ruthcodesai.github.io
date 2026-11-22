// Authored bounds in the 958 × 540 reference plate. The two poses follow the
// recorded blindfold lift; these are artwork annotations, not model output.
const objects = [
  ['JUSTITIA', [355, 0, 862, 392], [378, 0, 862, 350]],
  ['BLINDFOLD', [358, 65, 806, 227], [380, 63, 806, 198]],
  ['SCALES', [681, 285, 958, 540], [681, 285, 958, 540]],
];
const poses = [[0,0],[2,.15],[3,.43],[4,.88],[5,1],[6.5,1],[8,.45],[9,.12],[10.5,0]];
function liftAt(time) {
  const next = poses.findIndex(([t]) => t > time);
  if (next < 1) return 0;
  const [a,k] = poses[next-1], [b,j] = poses[next];
  return k+(j-k)*(time-a)/(b-a);
}

export function artClasses(host) {
  const svg = (tag, parent, attrs = {}) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    parent.append(el); return el;
  };
  const layer = svg('svg',host.parentElement,{class:'art-classes','aria-hidden':'true',focusable:'false'});
  const mask = svg('mask',svg('defs',layer),{id:'class-clearance',maskUnits:'userSpaceOnUse'});
  svg('rect',mask,{width:'100%',height:'100%',fill:'white'});
  const ui = [...document.querySelectorAll('.masthead,h1,.waitlist')];
  const holes = [...ui, null].map(() => svg('rect',mask,{fill:'black'}));
  const drawing = svg('g',layer,{mask:'url(#class-clearance)'});
  const labels = objects.map(([name]) => {
    const group = svg('g',drawing,{'data-object':name});
    const frame = svg('rect',group,{class:'object-frame'}), text = svg('text',group);
    text.textContent = name; return {group,frame,text};
  });
  const bounds = (el,[x,y,r,b]) => {
    el.setAttribute('x',x); el.setAttribute('y',y);
    el.setAttribute('width',r-x); el.setAttribute('height',b-y);
  };
  const crosses = ([l,t,r,b],[x,y,z,w]) => l<z && r>x && t<w && b>y;
  let last = '', dirty = true;
  const observer = new ResizeObserver(() => { dirty = true; if (previous) draw(...previous); });
  [host,...ui].forEach(el=>observer.observe(el));
  let previous;
  function draw(cover,time) {
    previous = [cover,time];
    // Nothing moves after the film settles, including during the ASCII loop.
    const lift = Math.round(liftAt(time)*80)/80;
    const key = [cover.x,cover.y,cover.width,cover.height,lift].join(':');
    if ((!dirty && last===key) || cover.width<=1) return;
    last = key; dirty = false;
    const art = layer.getBoundingClientRect();
    const view = [4-art.left,4-art.top,Math.min(innerWidth,art.right)-art.left-4,Math.min(innerHeight,art.bottom)-art.top-4];
    const project = ([l,t,r,b]) => [cover.x+l*cover.width/958,cover.y+t*cover.height/540,cover.x+r*cover.width/958,cover.y+b*cover.height/540];
    const keepClear = ui.map(el => {
      const r = el.getBoundingClientRect();
      return [r.left-art.left-8,r.top-art.top-8,r.right-art.left+8,r.bottom-art.top+8];
    });
    keepClear.push(project([427+58*lift,148-6*lift,595+56*lift,217-12*lift]));
    keepClear.forEach((r,i)=>bounds(holes[i],r));
    objects.forEach(([,rest,raised],i) => {
      const {group,frame,text} = labels[i];
      const obj = project(rest.map((n,j)=>n+(raised[j]-n)*lift));
      const [l,t,r,b] = obj.map((n,j)=>j<2?Math.max(view[j],n):Math.min(view[j],n));
      // Do not turn a sliver at the crop edge into a labeled detection.
      const w = objects[i][0].length*7+4, h = 15;
      const enough = r-l>=w+10 && b-t>=h+10 && (r-l)*(b-t)>.12*(obj[2]-obj[0])*(obj[3]-obj[1]);
      const spots = [[l+5,t+4],[r-w-5,t+4],[l+5,b-h-4],[r-w-5,b-h-4]];
      const place = enough && spots.find(([x,y])=>!keepClear.some(q=>crosses([x,y,x+w,y+h],q)));
      group.style.display = place ? '' : 'none';
      if (!place) return;
      bounds(frame,[l,t,r,b]);
      const [x,y] = place; text.setAttribute('x',x); text.setAttribute('y',y+11);
      keepClear.push([x-2,y-2,x+w+2,y+h+2]);
    });
  }
  return {draw, dispose(){ observer.disconnect(); layer.remove(); }};
}

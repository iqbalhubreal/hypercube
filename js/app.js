(() => {
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');

  /* ================= State ================= */
  const PLANES = [ // [key, axisA, axisB]
    ['xw',0,3],['yw',1,3],['zw',2,3],
    ['xy',0,1],['xz',0,2],['yz',1,2]
  ];
  const DEFAULT_SPEEDS = {xw:0.55, yw:0, zw:0.3, xy:0, xz:0, yz:0.12};
  const state = {
    shape:'tesseract', speeds:{...DEFAULT_SPEEDS}, master:1,
    style:'wire', color:'depth', persp:0.6, thick:2, zoom:1,
    showVerts:true, glow:true, fog:true, anaglyph:false, eyeSep:0.4,
    autoOrbit:false, drag4d:false, paused:false
  };
  const view = {yaw:0.55, pitch:0.35};
  let M = identity();

  /* ================= Shapes ================= */
  const SHAPES = {
    tesseract:{
      name:'Hypercube', sub:'tesseract · 8-cell', cells:8, faces:'square',
      desc:'The 4D version of a cube. Its shadow looks like a small cube inside a big one. When it turns in a 4D direction, the inner cube grows and the outer one shrinks, so they seem to pass through each other and swap places.',
      gen(){ const v=[]; for(let i=0;i<16;i++) v.push([i&1?1:-1, i&2?1:-1, i&4?1:-1, i&8?1:-1]); return v; }
    },
    cell5:{
      name:'5-cell', sub:'4D tetrahedron · pentachoron', cells:5, faces:'tri',
      desc:'The simplest 4D shape, like a 4D pyramid. It has 5 corners, and every corner connects to every other one. You can see it as a tetrahedron with one extra point floating "above" it in the 4th dimension.',
      gen(){ const a=1/Math.sqrt(5); return [[1,1,1,-a],[1,-1,-1,-a],[-1,1,-1,-a],[-1,-1,1,-a],[0,0,0,Math.sqrt(5)-a]]; }
    },
    cell16:{
      name:'16-cell', sub:'4D octahedron · hexadecachoron', cells:16, faces:'tri',
      desc:'The 4D version of an octahedron, and the "mirror twin" of the hypercube: it has a corner wherever the hypercube has a cell. It is made of 16 tetrahedra.',
      gen(){ const v=[]; for(let i=0;i<4;i++) for(const s of [1,-1]){ const p=[0,0,0,0]; p[i]=s; v.push(p); } return v; }
    },
    cell24:{
      name:'24-cell', sub:'icositetrachoron', cells:24, faces:'tri',
      desc:'A shape that only exists in 4D, with no 3D equivalent. It is made of 24 octahedra and is its own mirror twin. Of all the shapes here, its rotations look the most hypnotic.',
      gen(){ const v=[]; for(let i=0;i<4;i++) for(let j=i+1;j<4;j++) for(const a of [1,-1]) for(const b of [1,-1]){ const p=[0,0,0,0]; p[i]=a; p[j]=b; v.push(p); } return v; }
    }
  };
  const SHAPE_KEYS = Object.keys(SHAPES);

  function build(key){
    const S = SHAPES[key];
    let V = S.gen();
    const R = Math.max(...V.map(p => Math.hypot(...p)));
    V = V.map(p => p.map(c => c / R));
    const n = V.length;
    const d2 = (a,b) => a.reduce((s,c,i) => s + (c-b[i])**2, 0);
    let min = Infinity;
    for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) min = Math.min(min, d2(V[i],V[j]));
    const E = [], adj = Array.from({length:n}, () => new Set());
    for(let i=0;i<n;i++) for(let j=i+1;j<n;j++)
      if(Math.abs(d2(V[i],V[j]) - min) < 1e-6){ E.push([i,j]); adj[i].add(j); adj[j].add(i); }
    const F = [];
    if(S.faces === 'tri'){
      for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) if(adj[i].has(j))
        for(let k=j+1;k<n;k++) if(adj[i].has(k) && adj[j].has(k)) F.push([i,j,k]);
    } else { // squares
      for(let a=0;a<n;a++){
        const nb = [...adj[a]].filter(x => x > a);
        for(let p=0;p<nb.length;p++) for(let q=p+1;q<nb.length;q++){
          const b = nb[p], c = nb[q];
          for(const d of adj[b]) if(d !== a && d > a && adj[c].has(d)) F.push([a,b,d,c]);
        }
      }
    }
    return {V, E, F, P: V.map(() => ({x:0,y:0,z:0,w:0,f:1}))};
  }
  let shape = build(state.shape);

  /* ================= 4D math ================= */
  function identity(){ return [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]; }
  function rotateM(i,j,t){
    const c = Math.cos(t), s = Math.sin(t);
    for(let k=0;k<4;k++){
      const a = M[i][k], b = M[j][k];
      M[i][k] = c*a - s*b;
      M[j][k] = s*a + c*b;
    }
  }
  function orthonormalize(){
    for(let i=0;i<4;i++){
      for(let j=0;j<i;j++){
        let d=0; for(let k=0;k<4;k++) d += M[i][k]*M[j][k];
        for(let k=0;k<4;k++) M[i][k] -= d*M[j][k];
      }
      const l = Math.hypot(...M[i]); for(let k=0;k<4;k++) M[i][k] /= l;
    }
  }

  /* ================= Canvas ================= */
  let W=0, H=0, DPR=1;
  function resize(){
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W*DPR); cv.height = Math.round(H*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener('resize', resize);

  /* ================= Rendering ================= */
  const CAM_D = 6;
  let timeSec = 0;

  function colorFor(w, t, a, light, eye){
    if(eye === 'L') return `rgba(255,40,40,${a})`;
    if(eye === 'R') return `rgba(0,230,255,${a})`;
    if(state.color === 'mono') return `hsla(200,70%,${Math.min(95,light+16)}%,${a})`;
    const h = state.color === 'depth'
      ? 190 + (Math.max(-1,Math.min(1,w)) + 1) / 2 * 130
      : (t*360 + timeSec*25) % 360;
    return `hsla(${h},90%,${light}%,${a})`;
  }

  function render(){
    const g = ctx;
    g.globalCompositeOperation = 'source-over';
    g.shadowBlur = 0;
    if(state.anaglyph){ g.fillStyle = '#000'; g.fillRect(0,0,W,H); }
    else {
      const gr = g.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.7);
      gr.addColorStop(0,'#151b30'); gr.addColorStop(1,'#05070d');
      g.fillStyle = gr; g.fillRect(0,0,W,H);
    }

    const s = state.persp * 0.6, fmax = 1/(1-s);
    const B = Math.min(W,H) * 0.36 * state.zoom / fmax;
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const P = shape.P;
    let zr = 0.001;

    for(let i=0;i<shape.V.length;i++){
      const v = shape.V[i];
      const x = M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2]+M[0][3]*v[3];
      const y = M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2]+M[1][3]*v[3];
      const z = M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]+M[2][3]*v[3];
      const w = M[3][0]*v[0]+M[3][1]*v[1]+M[3][2]*v[2]+M[3][3]*v[3];
      const f = 1/(1 - s*w);                 // 4D -> 3D perspective
      const X = x*f, Y = y*f, Z = z*f;
      const x1 = X*cy + Z*sy, z1 = -X*sy + Z*cy; // camera orbit
      const y1 = Y*cp - z1*sp, z2 = Y*sp + z1*cp;
      const p = P[i]; p.x = x1; p.y = y1; p.z = z2; p.w = w; p.f = f;
      zr = Math.max(zr, Math.abs(z2));
    }

    // depth-sorted edges & faces (shared by both eyes)
    const edges = shape.E.map((e,i) => {
      const a = P[e[0]], b = P[e[1]];
      return {a:e[0], b:e[1], i, z:(a.z+b.z)/2, w:(a.w+b.w)/2, f:(a.f+b.f)/2};
    }).sort((p,q) => p.z - q.z);
    let faces = null;
    if(state.style === 'glass'){
      faces = shape.F.map((fc,i) => {
        let z=0, w=0; for(const k of fc){ z += P[k].z; w += P[k].w; }
        return {i, z:z/fc.length, w:w/fc.length};
      }).sort((p,q) => p.z - q.z);
    }
    const ctxInfo = {B, fmax, zr, edges, faces};

    if(state.anaglyph){
      const e = state.eyeSep * 0.3;
      g.globalCompositeOperation = 'lighter';
      drawScene(-e/2, 'L', ctxInfo);
      drawScene( e/2, 'R', ctxInfo);
      g.globalCompositeOperation = 'source-over';
    } else drawScene(0, null, ctxInfo);
  }

  function drawScene(eye, eyeName, {B, fmax, zr, edges, faces}){
    const g = ctx, P = shape.P;
    const S2 = P.map(p => {
      const sc = B * CAM_D / Math.max(0.5, CAM_D - p.z);
      return [W/2 + (p.x - eye)*sc + eye*B, H/2 - p.y*sc, sc/B];
    });
    const depthA = z => state.fog ? 0.28 + 0.72 * ((z/zr) + 1) / 2 : 1;
    g.lineCap = 'round'; g.lineJoin = 'round';

    // Glass faces
    if(faces){
      const nF = shape.F.length;
      for(const o of faces){
        const fc = shape.F[o.i];
        g.beginPath();
        fc.forEach((k,j) => { const q = S2[k]; j ? g.lineTo(q[0],q[1]) : g.moveTo(q[0],q[1]); });
        g.closePath();
        const a = (eyeName ? 0.06 : 0.10) * depthA(o.z);
        g.fillStyle = colorFor(o.w, o.i/nF, a, 60, eyeName);
        g.fill();
      }
    }

    // Edges
    const nE = shape.E.length;
    const glow = state.glow && !eyeName;
    for(const e of edges){
      const A = S2[e.a], Bp = S2[e.b];
      const alpha = depthA(e.z) * (state.style === 'glass' ? 0.8 : 1);
      const col = colorFor(e.w, e.i/nE, alpha, 62, eyeName);
      g.strokeStyle = col;
      g.lineWidth = state.thick * (0.55 + 0.45*e.f/fmax) * (A[2]+Bp[2])/2;
      if(glow){ g.shadowColor = col; g.shadowBlur = 10; }
      g.beginPath(); g.moveTo(A[0],A[1]); g.lineTo(Bp[0],Bp[1]); g.stroke();
    }
    g.shadowBlur = 0;

    // Corners
    if(state.showVerts){
      const nV = P.length;
      const order = P.map((p,i) => i).sort((i,j) => P[i].z - P[j].z);
      for(const i of order){
        const p = P[i], q = S2[i];
        const r = (state.thick*1.2 + 1.2) * (0.55 + 0.45*p.f/fmax) * q[2];
        g.fillStyle = colorFor(p.w, i/nV, Math.min(1, depthA(p.z)+0.15), 82, eyeName);
        g.beginPath(); g.arc(q[0], q[1], r, 0, Math.PI*2); g.fill();
      }
    }
  }

  /* ================= Loop ================= */
  let last = performance.now(), frameCount = 0, fpsT = 0, orthoCounter = 0;
  function loop(now){
    const dt = Math.min(0.05, (now - last)/1000); last = now;
    timeSec += dt;
    if(!state.paused){
      for(const [k,i,j] of PLANES){
        const sp = state.speeds[k] * state.master;
        if(sp) rotateM(i, j, sp*dt);
      }
      if(++orthoCounter > 60){ orthonormalize(); orthoCounter = 0; }
    }
    if(state.autoOrbit && !drag.active) view.yaw += 0.15*dt;
    render();

    frameCount++; fpsT += dt;
    if(fpsT >= 0.5){ $('fps').textContent = Math.round(frameCount/fpsT) + ' fps'; frameCount = 0; fpsT = 0; }
    if(rec.recorder){
      const t = Math.floor((performance.now() - rec.start)/1000);
      $('recBadge').textContent = `● REC ${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
    }
    requestAnimationFrame(loop);
  }

  /* ================= UI ================= */
  function toast(msg){
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1600);
  }

  function setShape(k){
    state.shape = k; shape = build(k);
    document.querySelectorAll('[data-shape]').forEach(b => b.classList.toggle('active', b.dataset.shape === k));
    const S = SHAPES[k];
    $('shapeDesc').textContent = S.desc;
    $('hudName').textContent = `${S.name}`;
    $('hudStats').textContent = `${S.sub} — ${shape.V.length} corners · ${shape.E.length} edges · ${shape.F.length} faces · ${S.cells} cells`;
  }
  document.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => setShape(b.dataset.shape)));

  // Plane sliders
  PLANES.forEach(([k]) => {
    const row = document.createElement('div');
    const is4 = k.includes('w');
    row.className = 'row' + (is4 ? ' w4' : '');
    row.innerHTML = `<label>${k.toUpperCase()}</label><input type="range" min="-2" max="2" step="0.05" id="sp_${k}"><output id="o_${k}"></output>`;
    (is4 ? $('planes4') : $('planes3')).appendChild(row);
    const inp = row.querySelector('input');
    inp.addEventListener('input', () => { state.speeds[k] = +inp.value; syncSpeeds(); });
    inp.addEventListener('dblclick', () => { state.speeds[k] = 0; syncSpeeds(); });
  });
  function syncSpeeds(){
    PLANES.forEach(([k]) => {
      $('sp_'+k).value = state.speeds[k];
      $('o_'+k).textContent = (+state.speeds[k]).toFixed(2);
    });
  }

  function bindRange(id, key, fmt = v => v){
    const el = $(id), out = $(id+'Out');
    el.value = state[key];
    const upd = () => { state[key] = +el.value; if(out) out.textContent = fmt(+el.value); };
    el.addEventListener('input', upd); upd();
    return v => { el.value = v; upd(); };
  }
  bindRange('master', 'master', v => v.toFixed(2)+'×');
  bindRange('persp', 'persp', v => Math.round(v*100)+'%');
  bindRange('thick', 'thick', v => v.toFixed(1));
  const setZoom = bindRange('zoom', 'zoom', v => v.toFixed(2)+'×');
  bindRange('eyeSep', 'eyeSep', v => Math.round(v*100)+'%');

  function bindCheck(id, key, cb){
    const el = $(id); el.checked = state[key];
    el.addEventListener('change', () => { state[key] = el.checked; cb && cb(); });
  }
  bindCheck('showVerts','showVerts');
  bindCheck('glow','glow');
  bindCheck('fog','fog');
  bindCheck('autoOrbit','autoOrbit');
  bindCheck('drag4d','drag4d');
  bindCheck('anaglyph','anaglyph', syncAnaglyph);
  function syncAnaglyph(){
    $('anaglyph').checked = state.anaglyph;
    $('eyeRow').classList.toggle('hidden', !state.anaglyph);
    $('anaBadge').classList.toggle('hidden', !state.anaglyph);
    $('legend').classList.toggle('hidden', state.anaglyph || state.color !== 'depth');
  }

  $('colorMode').addEventListener('change', e => { state.color = e.target.value; syncAnaglyph(); });

  function setStyle(s){
    state.style = s;
    document.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === s));
  }
  document.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => setStyle(b.dataset.style)));

  // Actions
  function togglePause(){
    state.paused = !state.paused;
    $('btnPause').textContent = state.paused ? '▶ Play' : '⏸ Pause';
  }
  function reset(){
    M = identity(); view.yaw = 0.55; view.pitch = 0.35; setZoom(1);
    toast('View reset');
  }
  $('btnPause').addEventListener('click', togglePause);
  $('btnReset').addEventListener('click', reset);
  $('btnRandom').addEventListener('click', () => {
    PLANES.forEach(([k]) => {
      const range = k.includes('w') ? 1.2 : 0.5;
      state.speeds[k] = Math.round((Math.random()*2-1)*range*20)/20;
    });
    syncSpeeds(); toast('🎲 New random spin');
  });
  $('btnStop').addEventListener('click', () => {
    PLANES.forEach(([k]) => state.speeds[k] = 0); syncSpeeds();
  });

  const PRESETS = {
    inside:{xw:0.7, yw:0, zw:0, xy:0, xz:0, yz:0},
    double:{xw:0.5, yw:0, zw:0, xy:0, xz:0, yz:0.5},
    tumble:{xw:0.5, yw:0.35, zw:0.25, xy:0.2, xz:0.3, yz:0.15},
    still :{xw:0, yw:0, zw:0, xy:0, xz:0, yz:0}
  };
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    state.speeds = {...PRESETS[b.dataset.preset]}; syncSpeeds();
  }));

  // Mobile menu
  $('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('open'));

  // Don't let clicked buttons keep focus (so Space always means pause)
  document.addEventListener('pointerup', e => {
    if(e.target.closest('button')) setTimeout(() => document.activeElement && document.activeElement.blur(), 0);
  });

  /* ================= Pointer controls ================= */
  const drag = {active:false, x:0, y:0};
  cv.addEventListener('pointerdown', e => {
    drag.active = true; drag.x = e.clientX; drag.y = e.clientY;
    cv.setPointerCapture(e.pointerId); cv.classList.add('drag');
    $('sidebar').classList.remove('open');
  });
  cv.addEventListener('pointermove', e => {
    if(!drag.active) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if(e.shiftKey || state.drag4d){
      rotateM(0, 3, dx*0.01);
      rotateM(1, 3, -dy*0.01);
    } else {
      view.yaw += dx*0.01;
      view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + dy*0.01));
    }
  });
  const endDrag = () => { drag.active = false; cv.classList.remove('drag'); };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(Math.max(0.3, Math.min(3, state.zoom * Math.exp(-e.deltaY*0.001))));
  }, {passive:false});

  /* ================= Recording ================= */
  const rec = {recorder:null, chunks:[], start:0};
  function download(url, name){
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function screenshot(){
    download(cv.toDataURL('image/png'), `${state.shape}-${Date.now()}.png`);
    toast('📷 Screenshot saved');
  }
  function toggleRec(){
    if(rec.recorder){ rec.recorder.stop(); return; }
    if(!cv.captureStream || !window.MediaRecorder){
      $('recStatus').textContent = 'Your browser does not support recording video.'; return;
    }
    const types = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const stream = cv.captureStream(60);
    const r = new MediaRecorder(stream, mime ? {mimeType:mime, videoBitsPerSecond:8e6} : {});
    rec.chunks = [];
    r.ondataavailable = e => { if(e.data && e.data.size) rec.chunks.push(e.data); };
    r.onstop = () => {
      const type = r.mimeType || 'video/webm';
      const blob = new Blob(rec.chunks, {type});
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const url = URL.createObjectURL(blob);
      download(url, `${state.shape}-${Date.now()}.${ext}`);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      rec.recorder = null;
      $('btnRec').textContent = '⏺ Record'; $('btnRec').classList.remove('on');
      $('recBadge').classList.add('hidden');
      $('recStatus').textContent = `Saved ${(blob.size/1048576).toFixed(1)} MB video.`;
      stream.getTracks().forEach(t => t.stop());
    };
    r.start(250);
    rec.recorder = r; rec.start = performance.now();
    $('btnRec').textContent = '⏹ Stop'; $('btnRec').classList.add('on');
    $('recBadge').classList.remove('hidden');
    $('recStatus').textContent = 'Recording… click Stop to save.';
  }
  $('btnShot').addEventListener('click', screenshot);
  $('btnRec').addEventListener('click', toggleRec);

  /* ================= Keyboard ================= */
  window.addEventListener('keydown', e => {
    if(['SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if(k === ' '){ e.preventDefault(); togglePause(); }
    else if(k === 'r') reset();
    else if(k === 'w') setStyle(state.style === 'wire' ? 'glass' : 'wire');
    else if(k === 'g'){ state.anaglyph = !state.anaglyph; syncAnaglyph(); }
    else if(k === 'p') screenshot();
    else if(k === 'v') toggleRec();
    else if(['1','2','3','4'].includes(k)) setShape(SHAPE_KEYS[+k-1]);
  });

  /* ================= Init ================= */
  resize();
  setShape(state.shape);
  syncSpeeds();
  syncAnaglyph();
  requestAnimationFrame(t => { last = t; loop(t); });
})();

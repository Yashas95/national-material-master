/* Three.js scenes. Loaded after three.min.js (r128 UMD). */
(function (root) {
'use strict';
const THREE = root.THREE;
const reduceMotion = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasGL = !!THREE && (() => { try { const c = document.createElement('canvas'); return !!(root.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; } })();

function hexToVec(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* Drag-to-rotate + wheel zoom, shared by both scenes */
function attachOrbit(el, state, opts) {
  let down = false, lx = 0, ly = 0, moved = 0;
  el.addEventListener('pointerdown', e => { down = true; moved = 0; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); state.dragging = true; });
  el.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    state.vy += dx * 0.0035; state.vx += dy * 0.0035;
  });
  const up = e => { if (!down) return; down = false; state.dragging = false; state.lastMoved = moved; try { el.releasePointerCapture(e.pointerId); } catch (_) {} };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  if (opts && opts.zoom) el.addEventListener('wheel', e => { e.preventDefault(); state.zoom = Math.max(opts.zoom[0], Math.min(opts.zoom[1], state.zoom * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
}

/* ---------------- Constellation ---------------- */
const POINT_VS = `
attribute float aSize; attribute vec3 aColor; attribute float aAlpha;
varying vec3 vColor; varying float vAlpha; uniform float uPR;
void main(){ vColor=aColor; vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
gl_PointSize=aSize*uPR*(240.0/-mv.z); gl_Position=projectionMatrix*mv; }`;
const POINT_FS = `
varying vec3 vColor; varying float vAlpha;
void main(){ vec2 c=gl_PointCoord-0.5; float d=length(c); if(d>0.5) discard;
float core=smoothstep(0.5,0.0,d); float a=pow(core,1.5)*vAlpha;
gl_FragColor=vec4(vColor*(0.62+0.42*core),a); }`;

const Constellation = {
  ok: hasGL, renderer: null, running: false, target: 0, p: 0,
  orbit: { vx: 0, vy: 0, rx: 0.32, ry: 0, zoom: 1, dragging: false, lastMoved: 0 },
  init() {
    if (this.renderer || !hasGL) return;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 0, 19);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster(); this.raycaster.params.Points.threshold = 0.22;
    this.mouse = new THREE.Vector2(-9, -9); this.hover = -1; this.hoverNucleus = -1;
    // blueprint rings
    const ringMat = new THREE.LineBasicMaterial({ color: 0x4f7397, transparent: true, opacity: 0.22 });
    const ring = (rad, y, seg) => { const pts = []; for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat); };
    [[5.2, 0], [8.2, 0], [4.5, 2.6], [4.5, -2.6]].forEach(([rad, y]) => this.group.add(ring(rad, y, 160)));
    const meridian = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 161 }, (_, i) => { const a = i / 160 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 5.2, Math.sin(a) * 5.2, 0); })), ringMat);
    this.group.add(meridian);
    const ticks = []; for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, l = i % 6 === 0 ? 0.45 : 0.18; ticks.push(new THREE.Vector3(Math.cos(a) * 8.2, 0, Math.sin(a) * 8.2), new THREE.Vector3(Math.cos(a) * (8.2 + l), 0, Math.sin(a) * (8.2 + l))); }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), ringMat));
    const el = r.domElement; el.className = 'gl-canvas'; el.setAttribute('aria-label', 'Interactive 3D view of material records clustering into national materials');
    attachOrbit(el, this.orbit, { zoom: [0.55, 1.6] });
    el.addEventListener('pointermove', e => { const b = el.getBoundingClientRect(); this.mouse.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1); this.mx = e.clientX - b.left; this.my = e.clientY - b.top; });
    el.addEventListener('pointerleave', () => { this.mouse.set(-9, -9); this.setHover(-1, -1); });
    el.addEventListener('click', () => {
      if (this.orbit.lastMoved > 6) return;
      if (this.hoverNucleus >= 0 && this.onPickCluster) this.onPickCluster(this.nuclei[this.hoverNucleus].key);
      else if (this.hover >= 0 && this.onPickRecord) this.onPickRecord(this.recs[this.hover].id);
    });
    this.ro = new ResizeObserver(() => this.resize());
  },
  setData(res, colorsByCpse, statusOf) {
    if (!hasGL) return;
    this.init();
    if (this.points) { this.group.remove(this.points, this.lines, this.nucleiPts); this.points.geometry.dispose(); this.lines.geometry.dispose(); this.nucleiPts.geometry.dispose(); }
    const recs = this.recs = res.records; const n = recs.length;
    const R = root.NUMMF.rng(77);
    const cpseIdx = { A: 0, B: 1, C: 2, D: 3, E: 4 };
    const raw = new Float32Array(n * 3), fin = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), delay = new Float32Array(n);
    // cluster centres on a fibonacci sphere
    const cl = res.clusters; const centres = new Map();
    cl.forEach((c, i) => {
      const k = cl.length, y = 1 - (i + 0.5) / k * 2, rad = Math.sqrt(1 - y * y), th = i * 2.399963;
      centres.set(c.key, new THREE.Vector3(Math.cos(th) * rad * 5.2, y * 4.3, Math.sin(th) * rad * 5.2));
    });
    this.centres = centres;
    recs.forEach((r, i) => {
      const ci = cpseIdx[r.cpse] ?? 0;
      const th = ci / 5 * Math.PI * 2 + (R() - 0.5) * 0.85, ph = Math.PI * (0.3 + R() * 0.4), rad = 6.0 + R() * 1.7;
      raw[i * 3] = Math.cos(th) * Math.sin(ph) * rad; raw[i * 3 + 1] = Math.cos(ph) * rad * 0.9; raw[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * rad;
      let f;
      const jitter = (s) => new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(s * (0.55 + R() * 0.45));
      if (r.clusterKey && centres.has(r.clusterKey)) f = centres.get(r.clusterKey).clone().add(jitter(0.34));
      else if (r.suggestedCluster && centres.has(r.suggestedCluster)) { const c0 = centres.get(r.suggestedCluster); f = c0.clone().add(c0.clone().normalize().multiplyScalar(0.95)).add(jitter(0.2)); }
      else { const t2 = R() * Math.PI * 2, p2 = Math.acos(2 * R() - 1); f = new THREE.Vector3(Math.cos(t2) * Math.sin(p2), Math.cos(p2), Math.sin(t2) * Math.sin(p2)).multiplyScalar(9.6); }
      fin[i * 3] = f.x; fin[i * 3 + 1] = f.y; fin[i * 3 + 2] = f.z;
      const cc = hexToVec(colorsByCpse[r.cpse] || '#ffffff');
      col.set(r.category === 'UNCLASSIFIED' ? [0.55, 0.6, 0.66] : cc, i * 3);
      size[i] = r.complete ? 1.0 : 0.85; alpha[i] = r.complete ? 0.95 : 0.7;
      delay[i] = ci * 0.07 + R() * 0.25;
    });
    pos.set(raw);
    this.raw = raw; this.fin = fin; this.pos = pos; this.delay = delay; this.baseSize = size.slice(); this.baseAlpha = alpha.slice();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPR: { value: this.renderer.getPixelRatio() } } });
    this.points = new THREE.Points(g, mat);
    // lines member -> centre
    const linePairs = [];
    recs.forEach((r, i) => { const key = r.clusterKey || r.suggestedCluster; if (key && centres.has(key)) { const c = res.clusterByKey.get(key); if (c && (c.members.length > 1 || !r.complete)) linePairs.push([i, key, !r.complete]); } });
    this.linePairs = linePairs;
    const lp = new Float32Array(linePairs.length * 6);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x9fc3e6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    // nuclei
    const nuc = this.nuclei = cl.filter(c => c.members.length > 1).map(c => ({ key: c.key, v: centres.get(c.key), status: statusOf(c.key), n: c.members.length }));
    const np = new Float32Array(nuc.length * 3), nc = new Float32Array(nuc.length * 3), ns = new Float32Array(nuc.length), na = new Float32Array(nuc.length);
    nuc.forEach((x, i) => { np.set([x.v.x, x.v.y, x.v.z], i * 3); nc.set(x.status === 'APPROVED' ? hexToVec('#F2A93B') : hexToVec('#DCE7F2'), i * 3); ns[i] = 1.6 + Math.min(1.6, x.n * 0.18); na[i] = 0; });
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(np, 3)); ng.setAttribute('aColor', new THREE.BufferAttribute(nc, 3));
    ng.setAttribute('aSize', new THREE.BufferAttribute(ns, 1)); ng.setAttribute('aAlpha', new THREE.BufferAttribute(na, 1));
    this.nucleiPts = new THREE.Points(ng, mat.clone()); this.nucBase = ns.slice();
    this.group.add(this.lines, this.points, this.nucleiPts);
    this.applyProgress(this.p, true);
  },
  refreshStatus(statusOf) {
    if (!this.nucleiPts) return;
    const c = this.nucleiPts.geometry.attributes.aColor;
    this.nuclei.forEach((x, i) => { x.status = statusOf(x.key); c.array.set(x.status === 'APPROVED' ? hexToVec('#F2A93B') : hexToVec('#DCE7F2'), i * 3); });
    c.needsUpdate = true;
  },
  mount(container) {
    if (!hasGL) { container.classList.add('no-gl'); return; }
    this.init();
    container.appendChild(this.renderer.domElement);
    this.container = container; this.ro.disconnect(); this.ro.observe(container);
    this.resize(); this.start();
  },
  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.position.x = w > 900 ? -3.2 : 0;
    this.camera.updateProjectionMatrix();
  },
  setTarget(t) { this.target = t; if (reduceMotion()) { this.p = t; this.applyProgress(t, true); } },
  applyProgress(p, force) {
    if (!this.points) return;
    const n = this.recs.length, raw = this.raw, fin = this.fin, pos = this.pos, d = this.delay;
    for (let i = 0; i < n; i++) {
      const lp = ease(Math.max(0, Math.min(1, p * 1.6 - d[i])));
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = raw[i * 3 + k] + (fin[i * 3 + k] - raw[i * 3 + k]) * lp;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    const lp = this.lines.geometry.attributes.position.array;
    this.linePairs.forEach(([i, key], j) => { const c = this.centres.get(key); lp.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], c.x, c.y, c.z], j * 6); });
    this.lines.geometry.attributes.position.needsUpdate = true;
    const vis = Math.max(0, Math.min(1, (p - 0.72) / 0.28));
    this.lineMat.opacity = 0.16 * vis;
    const na = this.nucleiPts.geometry.attributes.aAlpha; for (let i = 0; i < na.count; i++) na.array[i] = vis; na.needsUpdate = true;
  },
  setHover(i, nIdx) {
    if (i === this.hover && nIdx === this.hoverNucleus) return;
    this.hover = i; this.hoverNucleus = nIdx;
    const s = this.points.geometry.attributes.aSize, a = this.points.geometry.attributes.aAlpha;
    s.array.set(this.baseSize); a.array.set(this.baseAlpha);
    let key = null;
    if (nIdx >= 0) key = this.nuclei[nIdx].key; else if (i >= 0) key = this.recs[i].clusterKey || this.recs[i].suggestedCluster;
    if (key && this.p > 0.6) this.recs.forEach((r, j) => { if (r.clusterKey === key || r.suggestedCluster === key) { s.array[j] = 2.0; a.array[j] = 1; } });
    if (i >= 0) s.array[i] = 2.6;
    s.needsUpdate = a.needsUpdate = true;
    const ns = this.nucleiPts.geometry.attributes.aSize; ns.array.set(this.nucBase); if (nIdx >= 0) ns.array[nIdx] *= 1.5; ns.needsUpdate = true;
    if (this.onHover) this.onHover(i >= 0 ? this.recs[i] : null, nIdx >= 0 ? this.nuclei[nIdx].key : null, this.mx, this.my);
  },
  start() { if (this.running) return; this.running = true; const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); }; loop(); },
  stop() { this.running = false; cancelAnimationFrame(this.raf); },
  frame() {
    if (!this.container || !document.body.contains(this.container)) { this.stop(); return; }
    const o = this.orbit, rm = reduceMotion();
    if (!o.dragging && !rm) o.vy += 0.00022;
    o.ry += o.vy; o.rx = Math.max(-1.1, Math.min(1.1, o.rx + o.vx)); o.vx *= 0.9; o.vy *= 0.9;
    this.group.rotation.set(o.rx, o.ry, 0);
    this.camera.position.z += (19 / o.zoom - this.camera.position.z) * 0.12;
    if (Math.abs(this.target - this.p) > 0.0005) { this.p += (this.target > this.p ? 1 : -1) * Math.min(Math.abs(this.target - this.p), 0.0105); this.applyProgress(this.p); }
    if (this.mouse.x > -2) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      let ni = -1;
      if (this.p > 0.75) { const hn = this.raycaster.intersectObject(this.nucleiPts); if (hn.length) ni = hn[0].index; }
      const h = ni >= 0 ? [] : this.raycaster.intersectObject(this.points);
      this.setHover(h.length ? h[0].index : -1, ni);
    }
    this.renderer.render(this.scene, this.camera);
  },
};

/* ---------------- Material model viewer ---------------- */
const METALS = {
  STAINLESS_STEEL: { color: 0xc9d3dc, metalness: 0.55, roughness: 0.28 },
  ALLOY_STEEL: { color: 0x59616a, metalness: 0.55, roughness: 0.45 },
  CARBON_STEEL: { color: 0x737a82, metalness: 0.5, roughness: 0.5 },
  COPPER: { color: 0xc77a48, metalness: 0.6, roughness: 0.3 },
  ALUMINIUM: { color: 0xbcc4cc, metalness: 0.55, roughness: 0.32 },
};
const mat = (m) => new THREE.MeshStandardMaterial(Object.assign({ color: 0x888888, metalness: 0.4, roughness: 0.5 }, m));
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg || 64);

function buildModel(cat, a, material) {
  const g = new THREE.Group();
  const metal = mat(METALS[material] || METALS.CARBON_STEEL);
  const dark = mat({ color: 0x23272c, metalness: 0.2, roughness: 0.8 });
  const add = (geo, m, p, r) => { const o = new THREE.Mesh(geo, m); if (p) o.position.set(p[0], p[1], p[2]); if (r) o.rotation.set(r[0], r[1], r[2]); g.add(o); return o; };
  switch (cat) {
    case 'HEX_BOLT': {
      const d = a.diameter || 16, L = a.length || 50, s = 1 / 28;
      const r = d / 2 * s, Lh = L * s, R = d * 0.92 * s, hh = d * 0.65 * s;
      add(new THREE.CylinderGeometry(R, R, hh, 6), metal, [0, Lh / 2 + hh / 2, 0]);
      add(new THREE.CylinderGeometry(R * 0.9, R * 0.9, 0.02, 32), metal, [0, Lh / 2 + 0.01, 0]);
      add(new THREE.CylinderGeometry(r, r, Lh, 40), metal, [0, 0, 0]);
      const tl = Lh * 0.62, pitch = Math.max(0.045, r * 0.28);
      for (let y = -Lh / 2 + pitch; y < -Lh / 2 + tl; y += pitch) add(new THREE.TorusGeometry(r * 1.0, r * 0.085, 6, 40), metal, [0, y, 0], [Math.PI / 2, 0, 0]);
      add(new THREE.ConeGeometry(r * 0.98, r * 0.35, 40), metal, [0, -Lh / 2 - r * 0.17, 0], [Math.PI, 0, 0]);
      g.rotation.set(0.15, 0.4, -0.5);
      break;
    }
    case 'BALL_BEARING': {
      const w = 0.62;
      add(lathe([[1.12, -w / 2], [1.5, -w / 2], [1.5, w / 2], [1.12, w / 2], [1.12, -w / 2]]), metal);
      add(lathe([[0.52, -w / 2], [0.86, -w / 2], [0.86, w / 2], [0.52, w / 2], [0.52, -w / 2]]), metal);
      const balls = 9; for (let i = 0; i < balls; i++) { const t = i / balls * Math.PI * 2; add(new THREE.SphereGeometry(0.15, 24, 16), metal, [Math.cos(t) * 0.99, 0, Math.sin(t) * 0.99]); }
      add(new THREE.TorusGeometry(0.99, 0.03, 8, 64), mat({ color: 0x9a7b3f, metalness: 0.5, roughness: 0.4 }), [0, 0.04, 0], [Math.PI / 2, 0, 0]);
      const sealM = a.seal === 'ZZ' ? mat({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.35 }) : mat({ color: 0x7b2b24, metalness: 0.05, roughness: 0.75 });
      add(lathe([[0.86, -w / 2 + 0.03], [1.12, -w / 2 + 0.03], [1.12, -w / 2 + 0.06], [0.86, -w / 2 + 0.06], [0.86, -w / 2 + 0.03]]), sealM);
      add(lathe([[0.86, w / 2 - 0.06], [0.95, w / 2 - 0.06], [0.95, w / 2 - 0.03], [0.86, w / 2 - 0.03], [0.86, w / 2 - 0.06]]), sealM);
      add(lathe([[1.03, w / 2 - 0.06], [1.12, w / 2 - 0.06], [1.12, w / 2 - 0.03], [1.03, w / 2 - 0.03], [1.03, w / 2 - 0.06]]), sealM);
      g.rotation.set(1.05, 0, 0.25);
      break;
    }
    case 'GATE_VALVE': {
      const k = ({ 2: 0.82, 4: 1, 6: 1.15 })[a.size_in] || 1;
      const paint = mat({ color: 0xa8332a, metalness: 0.15, roughness: 0.55 });
      const body = add(new THREE.SphereGeometry(0.78 * k, 40, 30), metal); body.scale.set(1, 1.08, 0.82);
      add(new THREE.CylinderGeometry(0.4 * k, 0.4 * k, 2.5 * k, 36), metal, [0, 0, 0], [0, 0, Math.PI / 2]);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.84 * k, 0.84 * k, 0.14 * k, 40), metal, [sx * 1.25 * k, 0, 0], [0, 0, Math.PI / 2]);
        for (let i = 0; i < 8; i++) { const t = i / 8 * Math.PI * 2; add(new THREE.CylinderGeometry(0.05 * k, 0.05 * k, 0.2 * k, 10), dark, [sx * 1.25 * k, Math.cos(t) * 0.66 * k, Math.sin(t) * 0.66 * k], [0, 0, Math.PI / 2]); }
      }
      add(new THREE.CylinderGeometry(0.36 * k, 0.5 * k, 0.85 * k, 32), metal, [0, 0.95 * k, 0]);
      add(new THREE.CylinderGeometry(0.55 * k, 0.55 * k, 0.1 * k, 32), metal, [0, 1.4 * k, 0]);
      add(new THREE.BoxGeometry(0.12 * k, 0.75 * k, 0.12 * k), metal, [-0.3 * k, 1.8 * k, 0]);
      add(new THREE.BoxGeometry(0.12 * k, 0.75 * k, 0.12 * k), metal, [0.3 * k, 1.8 * k, 0]);
      add(new THREE.CylinderGeometry(0.05 * k, 0.05 * k, 1.4 * k, 12), metal, [0, 2.1 * k, 0]);
      add(new THREE.TorusGeometry(0.62 * k, 0.055 * k, 12, 48), paint, [0, 2.3 * k, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.2 * k, 0.05 * k, 0.05 * k), paint, [0, 2.3 * k, 0], [0, i * Math.PI / 4, 0]);
      g.rotation.set(0.35, -0.6, 0);
      break;
    }
    case 'FLANGE': {
      const r0 = 0.45, R = 1.4;
      const prof = a.flange_type === 'SO'
        ? [[r0, 0], [R, 0], [R, 0.3], [0.78, 0.3], [0.72, 0.6], [r0, 0.6], [r0, 0]]
        : [[r0, 0], [R, 0], [R, 0.3], [0.82, 0.3], [0.56, 1.2], [0.56, 1.75], [r0, 1.75], [r0, 0]];
      add(lathe(prof, 72), metal);
      add(lathe([[r0, -0.04], [0.92, -0.04], [0.92, 0], [r0, 0], [r0, -0.04]], 72), metal);
      for (let i = 0; i < 8; i++) { const t = i / 8 * Math.PI * 2; add(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 16), dark, [Math.cos(t) * 1.12, 0.15, Math.sin(t) * 1.12]); }
      g.rotation.set(-0.95, 0.2, 0.15); g.position.y = -0.3;
      break;
    }
    case 'INDUCTION_MOTOR': {
      const k = 0.8 + Math.min(0.45, (a.power_kw || 7.5) / 80);
      const paint = mat({ color: 0x2f5f8a, metalness: 0.25, roughness: 0.55 });
      add(new THREE.CylinderGeometry(0.85 * k, 0.85 * k, 2.0 * k, 48), paint, [0, 0, 0], [0, 0, Math.PI / 2]);
      for (let i = 0; i < 20; i++) { const t = i / 20 * Math.PI * 2; const f = add(new THREE.BoxGeometry(1.8 * k, 0.03, 0.16 * k), paint, [0, Math.cos(t) * 0.9 * k, Math.sin(t) * 0.9 * k]); f.rotation.x = -t; }
      add(new THREE.CylinderGeometry(0.88 * k, 0.88 * k, 0.16 * k, 48), paint, [1.05 * k, 0, 0], [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(0.82 * k, 0.7 * k, 0.5 * k, 48), mat({ color: 0x3a6f9c, metalness: 0.3, roughness: 0.6 }), [-1.25 * k, 0, 0], [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(0.13 * k, 0.13 * k, 0.75 * k, 24), METALS ? mat(METALS.STAINLESS_STEEL) : metal, [1.5 * k, 0, 0], [0, 0, Math.PI / 2]);
      add(new THREE.BoxGeometry(0.55 * k, 0.32 * k, 0.5 * k), paint, [0.15 * k, 1.02 * k, 0]);
      add(new THREE.BoxGeometry(1.7 * k, 0.12 * k, 1.5 * k), paint, [0, -0.92 * k, 0]);
      g.rotation.set(0.3, -0.55, 0);
      break;
    }
    case 'SEAMLESS_PIPE': {
      const ro = 0.62, wall = a.schedule === '80' ? 0.11 : 0.065, L = 1.7;
      add(lathe([[ro - wall, -L], [ro, -L], [ro, L], [ro - wall, L], [ro - wall, -L]], 64), mat(Object.assign({}, METALS.CARBON_STEEL, { side: THREE.DoubleSide })));
      g.rotation.set(0.5, 0.2, 1.15);
      break;
    }
    case 'SPIRAL_WOUND_GASKET': {
      add(lathe([[1.02, -0.05], [1.45, -0.05], [1.45, 0.05], [1.02, 0.05], [1.02, -0.05]], 72), mat({ color: 0x8c9198, metalness: 0.45, roughness: 0.4 }));
      for (let i = 0; i < 9; i++) add(new THREE.TorusGeometry(0.62 + i * 0.045, 0.022, 6, 72), i % 2 ? dark : metal, [0, 0, 0], [Math.PI / 2, 0, 0]);
      add(lathe([[0.5, -0.04], [0.6, -0.04], [0.6, 0.04], [0.5, 0.04], [0.5, -0.04]], 72), metal);
      g.rotation.set(1.0, 0, 0.2);
      break;
    }
    case 'POWER_CABLE': {
      const jacket = mat({ color: 0x1d2228, metalness: 0.05, roughness: 0.85 });
      add(new THREE.CylinderGeometry(0.58, 0.58, 2.2, 40), jacket, [0, -0.5, 0]);
      const cols = [0xb23a2e, 0xd9b532, 0x2f5fb0, 0x202020];
      const n = a.cores || 3; const cond = mat(a.conductor === 'AL' ? METALS.ALUMINIUM : METALS.COPPER);
      for (let i = 0; i < n; i++) {
        const t = i / n * Math.PI * 2, x = Math.cos(t) * 0.25, z = Math.sin(t) * 0.25;
        add(new THREE.CylinderGeometry(0.19, 0.19, 0.55, 24), mat({ color: cols[i], metalness: 0.05, roughness: 0.6 }), [x, 0.85, z]);
        add(new THREE.CylinderGeometry(0.11, 0.11, 0.35, 16), cond, [x, 1.28, z]);
      }
      g.rotation.set(0.35, 0.3, -0.75);
      break;
    }
    case 'WELDING_ELECTRODE': {
      const flux = mat({ color: a.aws_class === 'E6013' ? 0xc9b48a : 0x9fa49a, metalness: 0.05, roughness: 0.85 });
      const r = (a.dia_mm || 3.15) / 3.15 * 0.07;
      for (let i = -1; i <= 1; i++) {
        const sub = new THREE.Group();
        const m1 = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.8, r * 1.8, 2.7, 20), flux); m1.position.y = -0.2; sub.add(m1);
        const m2 = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.45, 16), metal); m2.position.y = 1.37; sub.add(m2);
        sub.rotation.z = i * 0.16; sub.position.x = i * 0.35; g.add(sub);
      }
      g.rotation.set(0.2, 0.3, -0.9);
      break;
    }
    default: {
      add(new THREE.BoxGeometry(1.6, 1.6, 1.6), mat({ color: 0x5c6b7a, wireframe: true }));
    }
  }
  // normalise size to fit the view
  const box = new THREE.Box3().setFromObject(g); const sz = new THREE.Vector3(); box.getSize(sz);
  const sc = 3.1 / Math.max(sz.x, sz.y, sz.z); const wrap = new THREE.Group();
  const c = new THREE.Vector3(); box.getCenter(c); g.position.sub(c);
  wrap.add(g); wrap.scale.setScalar(sc);
  return wrap;
}

const Viewer = {
  ok: hasGL, renderer: null, running: false, orbit: { vx: 0, vy: 0, rx: 0, ry: 0, zoom: 1, dragging: false },
  init() {
    if (this.renderer || !hasGL) return;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    if ('outputEncoding' in r) r.outputEncoding = THREE.sRGBEncoding;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50); this.camera.position.set(0, 0.2, 6.2);
    this.scene.add(new THREE.HemisphereLight(0xe6eeff, 0x1a2633, 1.0));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.25); d1.position.set(3, 5, 4); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x8fb6ff, 0.65); d2.position.set(-4, 1.5, -3); this.scene.add(d2);
    const d3 = new THREE.DirectionalLight(0xffc27a, 0.35); d3.position.set(-2, -3, 3); this.scene.add(d3);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    const grid = new THREE.GridHelper(8, 16, 0x3c5a78, 0x243a52); grid.position.y = -1.9; grid.material.transparent = true; grid.material.opacity = 0.45; this.scene.add(grid);
    const el = r.domElement; el.className = 'gl-canvas'; el.setAttribute('aria-label', 'Rotatable 3D model of the material');
    attachOrbit(el, this.orbit, { zoom: [0.7, 1.6] });
    this.ro = new ResizeObserver(() => this.resize());
  },
  show(container, cat, attrs, material) {
    if (!hasGL) { container.classList.add('no-gl'); return; }
    this.init();
    const sig = cat + JSON.stringify(attrs) + material;
    if (sig !== this.sig) {
      if (this.model) { this.pivot.remove(this.model); this.model.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      this.model = buildModel(cat, attrs, material); this.pivot.add(this.model); this.sig = sig;
      this.orbit.ry = 0; this.orbit.rx = 0;
    }
    container.appendChild(this.renderer.domElement);
    this.container = container; this.ro.disconnect(); this.ro.observe(container);
    this.resize(); this.start();
  },
  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  },
  start() { if (this.running) return; this.running = true; const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); }; loop(); },
  stop() { this.running = false; cancelAnimationFrame(this.raf); },
  frame() {
    if (!this.container || !document.body.contains(this.container)) { this.stop(); return; }
    const o = this.orbit;
    if (!o.dragging && !reduceMotion()) o.vy += 0.0009;
    o.ry += o.vy; o.rx = Math.max(-1.2, Math.min(1.2, o.rx + o.vx)); o.vx *= 0.88; o.vy *= 0.88;
    this.pivot.rotation.set(o.rx, o.ry, 0);
    this.camera.position.z += (6.2 / o.zoom - this.camera.position.z) * 0.15;
    this.renderer.render(this.scene, this.camera);
  },
};

root.NUMMF_3D = { Constellation, Viewer, hasGL };
})(window);

// Headless Navier-Stokes render: GPU compute fluid solve, volumetric raymarch, PNG out.
//
//   node render.mjs --n=128 --steps=220 --jacobi=32 --capture=170,200 --size=1024 --tag=hero
//
import { compute, effect, frame, init, sampler, storage, target, texture, uniforms } from 'vgpu/node';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encodePNG } from './png.mjs';

const opts = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) opts[m[1]] = m[2] ?? 'true';
}
const num = (name, fallback) => (opts[name] === undefined ? fallback : Number(opts[name]));

const N = num('n', 128);
const STEPS = num('steps', 220);
const JACOBI = num('jacobi', 40);
const SIZE = num('size', 1024);
const TAG = opts.tag ?? 'hero';
const CAPTURES = String(opts.capture ?? STEPS).split(',').filter(Boolean).map(Number);
const PAD = num('pad', 1.26);
const PAD2 = num('pad2', num('pad', 1.26));
const FOCUS = opts.focus ?? 'all';
const FOCUS2 = opts.focus2 ?? '';
const SIZES2 = String(opts.sizes2 ?? '').split(',').filter(Boolean).map(Number);
let focus = FOCUS;
const FOCUS_POW = focus === 'head' ? 6 : 3;
const AZ = num('az', -0.3);
const EL = num('el', 0.05);
const FOV = num('fov', 0.32);
const GRAIN = num('grain', 0.016);
const BLOOM = num('bloom', 0.55);
// --sweep="sigma,key,amb,expo,shadowK[;...]" renders several grades of the same frame
const SWEEP = String(opts.sweep ?? '').split(';').filter(Boolean).map((g) => {
  const [sigma, key, amb, expo, shadowK] = g.split(',').map(Number);
  return { sigma, key, amb, expo, shadowK };
});
const SWEEP_SIZE = num('sweepsize', 300);
const RAYS = num('rays', Math.round(N * 2.4));
const SIZES = String(opts.sizes ?? `${SIZE},512,180,48,32,16`).split(',').map(Number).filter((s) => s <= SIZE);

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const gpu = await init();
const CELLS = N * N * N;
const GROUPS = Math.ceil(N / 4);

const field = (bytes) => ({ a: storage(gpu, bytes, 'read-write'), b: storage(gpu, bytes, 'read-write') });
const vel = field(CELLS * 16);
const prs = field(CELLS * 4);
const div = storage(gpu, CELLS * 4, 'read-write');
const curl = storage(gpu, CELLS * 4, 'read-write');
const denBufs = [0, 1, 2, 3].map(() => storage(gpu, CELLS * 4, 'read-write'));
// MacCormack needs four distinct density buffers (source, forward, backward, corrected);
// the roles rotate one slot per step so a pass never reads and writes the same buffer.
let denIdx = 0;
const denSrc = () => denBufs[denIdx];
const denFwd = () => denBufs[(denIdx + 1) % 4];
const denBwd = () => denBufs[(denIdx + 2) % 4];
const denDst = () => denBufs[(denIdx + 3) % 4];
const stats = storage(gpu, 32, 'read-write');

const vol = texture(gpu, { kind: '3d', size: [N, N, N], format: 'rgba16float', usage: ['storage_binding', 'texture_binding'], label: 'density' });
const shd = texture(gpu, { kind: '3d', size: [N, N, N], format: 'rgba16float', usage: ['storage_binding', 'texture_binding'], label: 'shadow' });
const samp = sampler(gpu, {
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
  addressModeW: 'clamp-to-edge',
});

const simConstants = {
  NX: N,
  NY: N,
  NZ: N,
  DT: num('dt', 0.6),
  NU: num('nu', 0.008),
  DAMP: num('damp', 0.9995),
  VMAX: num('vmax', 0.65),
  BUOY: num('buoy', 0.05),
  JET_SPEED: num('jet', 0.0),
  JET_R: num('jetr', 4.5),
  JET_Y: num('jety', 8.0),
  JET_LEN: num('jetlen', 12.0),
  SWIRL: num('swirl', 0.10),
  CONFINE: num('confine', 0.4),
  DRIVE: num('drive', 1.0),
  SPONGE: num('sponge', 0.05),
  SRC_R: num('srcr', 4.2),
  SRC_DEN: num('srcden', 0.0),
  DEN_DISS: num('diss', 0.0005),
  SEED_R: num('seedr', 0.13 * N),
  SEED_Y: num('seedy', 0.20 * N),
  SEED_FLAT: num('seedflat', 1.35),
};
const simPass = (entry) => compute(gpu, read('shaders/sim.wgsl'), { entry, constants: simConstants, label: entry });
const advectVel = simPass('advect_vel');
const advectDenFwd = simPass('advect_den_fwd');
const advectDenBwd = simPass('advect_den_bwd');
const correctDen = simPass('correct_den');
const seed = simPass('seed');
const vorticity = simPass('vorticity');
const diverge = simPass('divergence');
const jacobi = simPass('jacobi');
const project = simPass('project');
const measure = simPass('measure');

const grid = { NX: N, NY: N, NZ: N };
const exportVolume = compute(gpu, read('shaders/export.wgsl'), { entry: 'export_volume', constants: grid, label: 'export' });
const LX = num('lx', -0.42);
const LY = num('ly', 0.8);
const LZ = num('lz', 0.43);
const SHADOW_BASE = { ...grid, SHADOW_STEPS: num('shadowsteps', 96), SHADOW_LEN: num('shadowlen', 1.75), LX, LY, LZ };
const shadowPass = compute(gpu, read('shaders/shadow.wgsl'), { entry: 'shadow', constants: { ...SHADOW_BASE, SHADOW_K: num('shadowk', 8) }, label: 'shadow' });
const shadowByK = new Map([[num('shadowk', 8), shadowPass]]);
const shadowFor = (k) => {
  if (!shadowByK.has(k)) {
    shadowByK.set(k, compute(gpu, read('shaders/shadow.wgsl'), { entry: 'shadow', constants: { ...SHADOW_BASE, SHADOW_K: k }, label: `shadow-k${k}` }));
  }
  return shadowByK.get(k);
};

const f32 = (u) => new Float32Array(Uint32Array.of(u).buffer)[0];

async function measureField() {
  stats.write(new Uint32Array(8));
  measure.set({ velR: vel.a, div, stats });
  measure.dispatch(GROUPS, GROUPS, GROUPS);
  const u = new Uint32Array(await stats.read());
  return { vmax: f32(u[0]), divmax: f32(u[1]), divmean: u[2] / 1024 / u[3] };
}

async function revalidateDivergence() {
  diverge.set({ velR: vel.a, div });
  diverge.dispatch(GROUPS, GROUPS, GROUPS);
  return measureField();
}

async function step(probe = false) {
  vorticity.set({ velR: vel.a, curl });
  vorticity.dispatch(GROUPS, GROUPS, GROUPS);

  advectVel.set({ velR: vel.a, velW: vel.b, denR: denSrc(), curl });
  advectVel.dispatch(GROUPS, GROUPS, GROUPS);
  [vel.a, vel.b] = [vel.b, vel.a];

  diverge.set({ velR: vel.a, div });
  diverge.dispatch(GROUPS, GROUPS, GROUPS);
  const pre = probe ? await measureField() : null;

  for (let k = 0; k < JACOBI; k++) {
    jacobi.set({ prsR: prs.a, prsW: prs.b, div });
    jacobi.dispatch(GROUPS, GROUPS, GROUPS);
    [prs.a, prs.b] = [prs.b, prs.a];
  }

  project.set({ velR: vel.a, velW: vel.b, prsR: prs.a });
  project.dispatch(GROUPS, GROUPS, GROUPS);
  [vel.a, vel.b] = [vel.b, vel.a];
  const post = probe ? await revalidateDivergence() : null;

  // MacCormack smoke advection: forward, backward, then corrected by half the error
  advectDenFwd.set({ denR: denSrc(), denW: denFwd(), velR: vel.a });
  advectDenFwd.dispatch(GROUPS, GROUPS, GROUPS);
  advectDenBwd.set({ denR: denSrc(), denW: denFwd(), denC: denBwd(), velR: vel.a });
  advectDenBwd.dispatch(GROUPS, GROUPS, GROUPS);
  correctDen.set({ denR: denSrc(), denW: denFwd(), denC: denBwd(), denD: denDst() });
  correctDen.dispatch(GROUPS, GROUPS, GROUPS);
  denIdx = (denIdx + 3) % 4;

  return probe ? { pre, post } : null;
}

function densityStats(data) {
  let sum = 0;
  let peak = 0;
  let live = 0;
  let bad = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!Number.isFinite(d)) bad++;
    if (d > peak) peak = d;
    sum += d;
    if (d > 0.08) live++;
  }
  return { peak, mean: sum / data.length, live, bad };
}

// frame the smoke: 'all' fits every live cell, 'cap' fits only the dense body (ignores the thin
// wake, which would otherwise pull the box down), 'head' locks onto the densest core,
// 'box' is a fixed camera looking at the middle of the domain
function cameraFor(data, pad = PAD) {
  if (focus === 'box') {
    const radius = num('radius', 1.9);
    return {
      eye: [radius * Math.cos(EL) * Math.sin(AZ), radius * Math.sin(EL), radius * Math.cos(EL) * Math.cos(AZ)],
      target: [0, 0, 0],
      radius,
    };
  }
  const box = [N, -1, N, -1, N, -1];
  const cut = focus === 'cap' ? 0.3 : 0.05;
  let wsum = 0;
  let wx = 0;
  let wy = 0;
  let wz = 0;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const d = data[(z * N + y) * N + x];
        if (d < cut) continue;
        box[0] = Math.min(box[0], x);
        box[1] = Math.max(box[1], x);
        box[2] = Math.min(box[2], y);
        box[3] = Math.max(box[3], y);
        box[4] = Math.min(box[4], z);
        box[5] = Math.max(box[5], z);
        const w = d ** FOCUS_POW;
        wsum += w;
        wx += w * x;
        wy += w * y;
        wz += w * z;
      }
    }
  }
  const toBox = (v) => v / (N - 1) - 0.5;
  let c;
  let span;
  if (focus === 'head') {
    c = [toBox(wx / wsum), toBox(wy / wsum), toBox(wz / wsum)];
    const dist = [];
    for (let z = 0; z < N; z++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (data[(z * N + y) * N + x] < 0.25) continue;
          dist.push(Math.hypot(toBox(x) - c[0], toBox(y) - c[1], toBox(z) - c[2]));
        }
      }
    }
    dist.sort((a, b) => a - b);
    span = 2 * (dist.length ? dist[Math.floor(dist.length * 0.85)] : 0.2);
  } else {
    c = [(box[0] + box[1]) / 2, (box[2] + box[3]) / 2, (box[4] + box[5]) / 2].map(toBox);
    span = Math.max(box[1] - box[0], box[3] - box[2], box[5] - box[4]) / (N - 1);
  }
  const radius = (span * 0.5 / FOV) * pad;
  return {
    eye: [
      c[0] + radius * Math.cos(EL) * Math.sin(AZ),
      c[1] + radius * Math.sin(EL),
      c[2] + radius * Math.cos(EL) * Math.cos(AZ),
    ],
    target: c,
    radius,
  };
}

const cam = uniforms(gpu, {
  eye: [0, 0.1, 1.6, 0],
  look: [0, 0.05, 0, FOV],
  light: [LX, LY, LZ, 0],
  grade: [num('sigma', 4), num('key', 2.0), num('amb', 0.35), num('exposure', 0.55)],
  tune: [GRAIN, num('vignette', 0.3), num('phase', 0.45), RAYS],
});
const renderer = effect(gpu, read('shaders/volume.wgsl'), { label: 'volume', set: { vol, shd, samp, cam } });

// bloom: the same scene rendered small is already a blurred bright subject, so one low-res pass
// plus a bilinear upsample and a screen blend is enough light bleed for a still
function compositeBloom(beauty, size, glow, glowSize, weight) {
  const px = (x, y) => {
    const cx = Math.min(glowSize - 1, Math.max(0, x));
    const cy = Math.min(glowSize - 1, Math.max(0, y));
    const o = (cy * glowSize + cx) * 4;
    return [glow[o], glow[o + 1], glow[o + 2]];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = ((x + 0.5) / size) * glowSize - 0.5;
      const gy = ((y + 0.5) / size) * glowSize - 0.5;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const c = [0, 1, 2].map((k) => {
        const a = px(x0, y0)[k];
        const b = px(x0 + 1, y0)[k];
        const d = px(x0, y0 + 1)[k];
        const e = px(x0 + 1, y0 + 1)[k];
        return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      });
      const o = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const base = beauty[o + k] / 255;
        const g = (c[k] / 255) * weight;
        beauty[o + k] = Math.round(255 * (1 - (1 - base) * (1 - Math.min(1, g))));
      }
    }
  }
}

async function writeFrame(tag, size) {
  const t = target(gpu, { size: [size, size], format: 'rgba8unorm', clearColor: [0, 0, 0, 1] });
  frame(gpu, (f) => f.pass(t, renderer));
  let pixels = await t.color.read({ mipLevel: 0, region: 'all' });
  if (BLOOM > 0) {
    const gs = Math.max(4, Math.round(size / 8));
    const gt = target(gpu, { size: [gs, gs], format: 'rgba8unorm', clearColor: [0, 0, 0, 1] });
    const beautyGrade = [num('sigma', 3.5), num('key', 3.4), num('amb', 0.6), num('exposure', 1.8)];
    cam.set({ grade: [num('glowsigma', 16), num('glowkey', 1.0), num('glowamb', 0.5), num('glowexposure', 1.0)] });
    frame(gpu, (f) => f.pass(gt, renderer));
    const glow = await gt.color.read({ mipLevel: 0, region: 'all' });
    cam.set({ grade: beautyGrade });
    compositeBloom(pixels, size, glow, gs, BLOOM);
    gt.destroy();
  }
  let luma = 0;
  for (let i = 0; i < pixels.length; i += 4) luma += pixels[i] + pixels[i + 1] + pixels[i + 2];
  luma /= (pixels.length / 4) * 3;
  const path = `out/${tag}-${size}.png`;
  mkdirSync('out', { recursive: true });
  writeFileSync(path, encodePNG(size, size, pixels));
  t.destroy();
  return { path, luma: +luma.toFixed(2) };
}

async function capture(stepIndex) {
  exportVolume.set({ den: denSrc(), vol });
  exportVolume.dispatch(GROUPS, GROUPS, GROUPS);
  shadowPass.set({ vol, samp, shd });
  shadowPass.dispatch(GROUPS, GROUPS, GROUPS);

  const data = new Float32Array(await denSrc().read());
  const d = densityStats(data);
  const shot = cameraFor(data);
  cam.set({ eye: [...shot.eye, 0], look: [...shot.target, FOV] });

  const files = [];
  for (const size of SIZES) files.push(await writeFrame(`${TAG}-s${stepIndex}`, size));

  const iconFiles = [];
  if (FOCUS2 && SIZES2.length) {
    focus = FOCUS2;
    const shot2 = cameraFor(data, PAD2);
    focus = FOCUS;
    cam.set({ eye: [...shot2.eye, 0], look: [...shot2.target, FOV] });
    for (const size of SIZES2) iconFiles.push(await writeFrame(`${TAG}-icon-s${stepIndex}`, size));
    cam.set({ eye: [...shot.eye, 0], look: [...shot.target, FOV] });
  }

  const sweepFiles = [];
  for (const [i, v] of SWEEP.entries()) {
    const sp = shadowFor(v.shadowK);
    sp.set({ vol, samp, shd });
    sp.dispatch(GROUPS, GROUPS, GROUPS);
    cam.set({ grade: [v.sigma, v.key, v.amb, v.expo] });
    const shot = await writeFrame(`${TAG}-sw${i}`, SWEEP_SIZE);
    sweepFiles.push({ i, ...v, luma: shot.luma });
  }
  cam.set({ grade: [num('sigma', 4), num('key', 2.0), num('amb', 0.35), num('exposure', 0.55)] });
  console.log(
    JSON.stringify({
      step: stepIndex,
      density: { peak: +d.peak.toFixed(4), mean: +d.mean.toFixed(6), live: d.live, nonFinite: d.bad },
      framing: { center: shot.target.map((v) => +v.toFixed(3)), radius: +shot.radius.toFixed(3) },
      files,
      ...(iconFiles.length ? { icons: iconFiles } : {}),
      ...(sweepFiles.length ? { sweep: sweepFiles } : {}),
    }),
  );
  return files[0];
}

// seed writes the current density directly, so nothing to swap here
if ((opts.init ?? 'thermal') === 'thermal') {
  seed.set({ denW: denSrc() });
  seed.dispatch(GROUPS, GROUPS, GROUPS);
}

let firstShot = null;
for (let s = 1; s <= STEPS; s++) {
  const probe = s === STEPS || s % 60 === 0;
  const chk = await step(probe);
  if (chk) {
    const drop = chk.pre.divmean / Math.max(chk.post.divmean, 1e-9);
    const ratio = chk.post.divmean / Math.max(chk.post.vmax, 1e-9);
    console.log(`step ${s}  interior mean|div| ${chk.pre.divmean.toFixed(5)} -> ${chk.post.divmean.toFixed(5)} (x${drop.toFixed(1)}), mean|div|/max|v| ${ratio.toFixed(5)}`);
    // tolerance, not a guarantee: the no-slip wall layer and the vorticity-confinement force both
    // leave cell-scale divergence that a floating-point Jacobi projection cannot remove. ~1% is clean.
    if (!Number.isFinite(ratio) || !(ratio < 0.02)) throw new Error(`self-check: flow is not divergence-free (mean|div|/max|v| ${ratio})`);
  }
  if ((opts.analyze ? s % 4 === 0 : s % 10 === 0) || CAPTURES.includes(s)) {
    const m = await measureField();
    if (opts.analyze || s % 10 === 0) {
      const data = new Float32Array(await denSrc().read());
      const vraw = new Float32Array(await vel.a.read());
      let vmaxCpu = 0;
      let mvx = 0;
      let mvy = 0;
      let mvz = 0;
      for (let i = 0; i < CELLS; i++) {
        const vx = vraw[i * 4];
        const vy = vraw[i * 4 + 1];
        const vz = vraw[i * 4 + 2];
        const sp = Math.hypot(vx, vy, vz);
        if (sp > vmaxCpu) vmaxCpu = sp;
        mvx += vx; mvy += vy; mvz += vz;
      }
      console.log(`  cpu  max|v| ${vmaxCpu.toFixed(4)}  momentum ${(mvx / CELLS).toExponential(2)},${(mvy / CELLS).toExponential(2)},${(mvz / CELLS).toExponential(2)}`);
      let top = -1;
      let live = 0;
      for (let z = 0; z < N; z++) {
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            if (data[(z * N + y) * N + x] > 0.1) { live++; if (y > top) top = y; }
          }
        }
      }
      console.log(`step ${s}  max|v| ${m.vmax.toFixed(3)}  plumeTop ${top}/${N}  live ${live}`);
      if (opts.analyze) {
        const rows = [];
        for (let y = 0; y < N; y += Math.max(1, Math.round(N / 8))) {
          let c = 0;
          let sd = 0;
          let sx = 0;
          let sz = 0;
          let mx = 0;
          let xlo = N;
          let xhi = -1;
          let zlo = N;
          let zhi = -1;
          for (let z = 0; z < N; z++) {
            for (let x = 0; x < N; x++) {
              const d = data[(z * N + y) * N + x];
              if (d > 0.02) {
                c++;
                sd += d;
                sx += x * d;
                sz += z * d;
                if (d > mx) mx = d;
                if (x < xlo) xlo = x;
                if (x > xhi) xhi = x;
                if (z < zlo) zlo = z;
                if (z > zhi) zhi = z;
              }
            }
          }
          rows.push(sd > 0 ? `y${y} n${c} c(${(sx / sd).toFixed(1)},${(sz / sd).toFixed(1)}) x[${xlo}-${xhi}] z[${zlo}-${zhi}] max${mx.toFixed(2)}` : `y${y} -`);
        }
        console.log('  ' + rows.join('\n  '));
      }
    }
    if (CAPTURES.includes(s)) {
      const shot = await capture(s);
      if (!firstShot) firstShot = shot;
    }
  }
}

{
  const data = new Float32Array(await denSrc().read());
  const { peak, mean, live, bad } = densityStats(data);
  console.log(`density  peak ${peak.toFixed(4)}  mean ${mean.toFixed(6)}  live ${live}  nonFinite ${bad}`);
  if (bad > 0) throw new Error('self-check: non-finite density');
  if (peak <= 0.05 || live < Math.max(200, CELLS * 0.002)) throw new Error('self-check: smoke field is empty');
  if (firstShot && firstShot.luma < 3) throw new Error(`self-check: render is black (mean luma ${firstShot.luma})`);
  const b = [N, -1, N, -1, N, -1];
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (data[(z * N + y) * N + x] < 0.02) continue;
        b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x);
        b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y);
        b[4] = Math.min(b[4], z); b[5] = Math.max(b[5], z);
      }
    }
  }
  console.log(`bbox x[${b[0]}-${b[1]}] y[${b[2]}-${b[3]}] z[${b[4]}-${b[5]}]  (seedR ${simConstants.SEED_R.toFixed(2)} seedY ${simConstants.SEED_Y.toFixed(2)})`);
  console.log('self-check ok');
}

gpu.dispose();

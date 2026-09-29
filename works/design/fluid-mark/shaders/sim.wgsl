// Incompressible Navier-Stokes on a uniform 3D grid, storage-buffer fields.
// One bind-group layout is shared by every pass, so a single set() bag serves all of them.
//
// ponytail: the velocity clamp at VMAX keeps the semi-Lagrangian backtrace short instead of
// solving with a CFL-limited timestep. Raise VMAX and lower DT together if the flow needs more speed.

override NX: i32 = 128;
override NY: i32 = 128;
override NZ: i32 = 128;

override DT: f32 = 0.6;
override NU: f32 = 0.05;
override DAMP: f32 = 0.999;
override VMAX: f32 = 4.0;

override BUOY: f32 = 0.9;
override JET_SPEED: f32 = 3.4;
override JET_R: f32 = 5.0;
override JET_Y: f32 = 7.0;
override JET_LEN: f32 = 26.0;
override SWIRL: f32 = 0.10;
override CONFINE: f32 = 0.25;
override DRIVE: f32 = 1.0;
override SPONGE: f32 = 0.05;
override SRC_R: f32 = 4.2;
override SEED_R: f32 = 15.0;
override SEED_Y: f32 = 26.0;
override SEED_FLAT: f32 = 1.35;
override SRC_DEN: f32 = 1.0;
override DEN_DISS: f32 = 0.0025;

@group(0) @binding(0) var<storage, read_write> velR: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> velW: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> denR: array<f32>;
@group(0) @binding(3) var<storage, read_write> denW: array<f32>;
@group(0) @binding(4) var<storage, read_write> prsR: array<f32>;
@group(0) @binding(5) var<storage, read_write> prsW: array<f32>;
@group(0) @binding(6) var<storage, read_write> div: array<f32>;
@group(0) @binding(8) var<storage, read_write> curl: array<f32>;
@group(0) @binding(9) var<storage, read_write> denC: array<f32>;
@group(0) @binding(10) var<storage, read_write> denD: array<f32>;

fn cell_index(x: i32, y: i32, z: i32) -> i32 {
  let cx = clamp(x, 0, NX - 1);
  let cy = clamp(y, 0, NY - 1);
  let cz = clamp(z, 0, NZ - 1);
  return (cz * NY + cy) * NX + cx;
}

fn nozzle() -> vec3f {
  return vec3f(f32(NX - 1) * 0.5, JET_Y, f32(NZ - 1) * 0.5);
}

fn v_at(buf: ptr<storage, array<vec4f>, read_write>, x: i32, y: i32, z: i32) -> vec3f {
  return (*buf)[cell_index(x, y, z)].xyz;
}

fn p_at(buf: ptr<storage, array<f32>, read_write>, x: i32, y: i32, z: i32) -> f32 {
  return (*buf)[cell_index(x, y, z)];
}

fn c_at(buf: ptr<storage, array<f32>, read_write>, x: i32, y: i32, z: i32) -> f32 {
  return (*buf)[cell_index(x, y, z)];
}

fn f_at(buf: ptr<storage, array<f32>, read_write>, x: i32, y: i32, z: i32) -> f32 {
  return (*buf)[cell_index(x, y, z)];
}

fn vort_at(x: i32, y: i32, z: i32) -> vec3f {
  let dvz_dy = v_at(&velR, x, y + 1, z).z - v_at(&velR, x, y - 1, z).z;
  let dvy_dz = v_at(&velR, x, y, z + 1).y - v_at(&velR, x, y, z - 1).y;
  let dvx_dz = v_at(&velR, x, y, z + 1).x - v_at(&velR, x, y, z - 1).x;
  let dvz_dx = v_at(&velR, x + 1, y, z).z - v_at(&velR, x - 1, y, z).z;
  let dvy_dx = v_at(&velR, x + 1, y, z).y - v_at(&velR, x - 1, y, z).y;
  let dvx_dy = v_at(&velR, x, y + 1, z).x - v_at(&velR, x, y - 1, z).x;
  return 0.5 * vec3f(dvz_dy - dvy_dz, dvx_dz - dvz_dx, dvy_dx - dvx_dy);
}

// trilinear sample; cell centers sit at integer coordinates, so no half-texel shift here
fn tri_f(buf: ptr<storage, array<f32>, read_write>, p: vec3f) -> f32 {
  let q = p;
  let i0 = vec3f(floor(q));
  let f = q - i0;
  let b = vec3i(i0);
  var acc = 0.0;
  for (var k = 0; k < 2; k = k + 1) {
    for (var j = 0; j < 2; j = j + 1) {
      for (var i = 0; i < 2; i = i + 1) {
        let wx = select(1.0 - f.x, f.x, i == 1);
        let wy = select(1.0 - f.y, f.y, j == 1);
        let wz = select(1.0 - f.z, f.z, k == 1);
        acc = acc + wx * wy * wz * (*buf)[cell_index(b.x + i, b.y + j, b.z + k)];
      }
    }
  }
  return acc;
}

fn tri_v(buf: ptr<storage, array<vec4f>, read_write>, p: vec3f) -> vec3f {
  let q = p;
  let i0 = vec3f(floor(q));
  let f = q - i0;
  let b = vec3i(i0);
  var acc = vec3f(0.0);
  for (var k = 0; k < 2; k = k + 1) {
    for (var j = 0; j < 2; j = j + 1) {
      for (var i = 0; i < 2; i = i + 1) {
        let wx = select(1.0 - f.x, f.x, i == 1);
        let wy = select(1.0 - f.y, f.y, j == 1);
        let wz = select(1.0 - f.z, f.z, k == 1);
        acc = acc + (wx * wy * wz) * (*buf)[cell_index(b.x + i, b.y + j, b.z + k)].xyz;
      }
    }
  }
  return acc;
}

// initial condition: one buoyant blob, released from rest. The roll-up of its cap
// into a vortex ring is the classic rising thermal.
@compute @workgroup_size(4, 4, 4)
fn seed(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let p = vec3f(gid);
  let c = vec3f(f32(NX - 1) * 0.5, SEED_Y, f32(NZ - 1) * 0.5);
  let r = length((p - c) * vec3f(1.0, SEED_FLAT, 1.0)) / SEED_R;
  denW[cell_index(i32(gid.x), i32(gid.y), i32(gid.z))] = 1.0 - smoothstep(0.5, 1.0, r);
}

@compute @workgroup_size(4, 4, 4)
fn vorticity(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  curl[cell_index(i32(gid.x), i32(gid.y), i32(gid.z))] = length(vort_at(i32(gid.x), i32(gid.y), i32(gid.z)));
}

// semi-Lagrangian advection, explicit viscous diffusion, buoyancy, nozzle drive
@compute @workgroup_size(4, 4, 4)
fn advect_vel(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let i = cell_index(x, y, z);
  let p = vec3f(f32(x), f32(y), f32(z));
  let v0 = velR[i].xyz;

  var q = clamp(p - DT * v0, vec3f(0.0), vec3f(f32(NX - 1), f32(NY - 1), f32(NZ - 1)));
  var v = tri_v(&velR, q);

  let lap = v_at(&velR, x + 1, y, z) + v_at(&velR, x - 1, y, z)
          + v_at(&velR, x, y + 1, z) + v_at(&velR, x, y - 1, z)
          + v_at(&velR, x, y, z + 1) + v_at(&velR, x, y, z - 1) - 6.0 * v0;
  v = v + (NU * DT) * lap;

  // vorticity confinement: semi-Lagrangian advection smears the shear layer,
  // this re-injects the small-scale swirl that the roll-up needs
  let om = vort_at(x, y, z);
  let grad_w = 0.5 * vec3f(
    c_at(&curl, x + 1, y, z) - c_at(&curl, x - 1, y, z),
    c_at(&curl, x, y + 1, z) - c_at(&curl, x, y - 1, z),
    c_at(&curl, x, y, z + 1) - c_at(&curl, x, y, z - 1),
  );
  let nrm = grad_w / (length(grad_w) + 1.0e-5);
  v = v + (CONFINE * DT) * cross(nrm, om);

  let d = denR[i];
  v.y = v.y + DT * BUOY * d;

  // submerged nozzle: relax the core toward a target speed instead of pushing it forever
  let rel = p - nozzle();
  let rr = length(vec2f(rel.x, rel.z));
  let radial = 1.0 - smoothstep(JET_R * 0.30, JET_R, rr);
  let axial = (1.0 - smoothstep(JET_LEN, JET_LEN + 20.0, max(rel.y, 0.0)))
            * smoothstep(-14.0, -4.0, rel.y);
  let prof = radial * axial * DRIVE;
  // swirl around the nozzle axis: a helical jet instead of a straight one, with no net
  // lateral impulse (a sideways push drives a box-scale circulation and leans the plume)
  let tang = vec3f(-rel.z, 0.0, rel.x) / max(rr, 1.0e-3);
  let drive = vec3f(tang.x * SWIRL, JET_SPEED, tang.z * SWIRL);
  v = mix(v, drive, min(1.0, 0.22 * prof));

  let top = smoothstep(0.86, 1.0, f32(y) / f32(NY - 1));
  v = v * DAMP * (1.0 - SPONGE * 3.0 * top);
  let speed = length(v);
  if (speed > VMAX) { v = v * (VMAX / speed); }

  let wall = x == 0 || y == 0 || z == 0 || x == NX - 1 || y == NY - 1 || z == NZ - 1;
  if (wall) { v = vec3f(0.0); }

  velW[i] = vec4f(v, 0.0);
}

// smoke advection, MacCormack: forward pass, backward pass, then correct by half the error.
// Plain semi-Lagrangian smears the filaments; the correction is what keeps the fine structure.
@compute @workgroup_size(4, 4, 4)
fn advect_den_fwd(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let i = cell_index(x, y, z);
  let p = vec3f(f32(x), f32(y), f32(z));

  var q = clamp(p - DT * velR[i].xyz, vec3f(0.0), vec3f(f32(NX - 1), f32(NY - 1), f32(NZ - 1)));
  let sponge = smoothstep(0.84, 1.0, f32(y) / f32(NY - 1));
  var d = tri_f(&denR, q) * (1.0 - DEN_DISS - 0.12 * sponge);

  let s = 1.0 - smoothstep(SRC_R * 0.45, SRC_R, length(p - nozzle()));
  d = max(d, SRC_DEN * s * s);

  denW[i] = d;
}

@compute @workgroup_size(4, 4, 4)
fn advect_den_bwd(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let p = vec3f(f32(x), f32(y), f32(z));
  let q = clamp(p + DT * velR[cell_index(x, y, z)].xyz, vec3f(0.0), vec3f(f32(NX - 1), f32(NY - 1), f32(NZ - 1)));
  denC[cell_index(x, y, z)] = tri_f(&denW, q);
}

@compute @workgroup_size(4, 4, 4)
fn correct_den(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let i = cell_index(x, y, z);
  // clamp to the local source range: without it the correction overshoots into ringing
  let lo = min(denR[i], min(min(f_at(&denR, x - 1, y, z), f_at(&denR, x + 1, y, z)),
                            min(min(f_at(&denR, x, y - 1, z), f_at(&denR, x, y + 1, z)),
                                min(f_at(&denR, x, y, z - 1), f_at(&denR, x, y, z + 1)))));
  let hi = max(denR[i], max(max(f_at(&denR, x - 1, y, z), f_at(&denR, x + 1, y, z)),
                            max(max(f_at(&denR, x, y - 1, z), f_at(&denR, x, y + 1, z)),
                                max(f_at(&denR, x, y, z - 1), f_at(&denR, x, y, z + 1)))));
  let d = denW[i] + 0.5 * (denR[i] - denC[i]);
  denD[i] = max(clamp(d, lo, hi), 0.0);
}

@compute @workgroup_size(4, 4, 4)
fn divergence(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let dx = v_at(&velR, x + 1, y, z).x - v_at(&velR, x - 1, y, z).x;
  let dy = v_at(&velR, x, y + 1, z).y - v_at(&velR, x, y - 1, z).y;
  let dz = v_at(&velR, x, y, z + 1).z - v_at(&velR, x, y, z - 1).z;
  div[cell_index(x, y, z)] = 0.5 * (dx + dy + dz);
}

@compute @workgroup_size(4, 4, 4)
fn jacobi(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let sum = p_at(&prsR, x + 1, y, z) + p_at(&prsR, x - 1, y, z)
          + p_at(&prsR, x, y + 1, z) + p_at(&prsR, x, y - 1, z)
          + p_at(&prsR, x, y, z + 1) + p_at(&prsR, x, y, z - 1);
  prsW[cell_index(x, y, z)] = (sum - div[cell_index(x, y, z)]) * (1.0 / 6.0);
}

// subtract the pressure gradient: velR -> velW
@compute @workgroup_size(4, 4, 4)
fn project(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let g = vec3f(
    p_at(&prsR, x + 1, y, z) - p_at(&prsR, x - 1, y, z),
    p_at(&prsR, x, y + 1, z) - p_at(&prsR, x, y - 1, z),
    p_at(&prsR, x, y, z + 1) - p_at(&prsR, x, y, z - 1),
  ) * 0.5;
  var v = velR[cell_index(x, y, z)].xyz - g;
  let wall = x == 0 || y == 0 || z == 0 || x == NX - 1 || y == NY - 1 || z == NZ - 1;
  if (wall) { v = vec3f(0.0); }
  velW[cell_index(x, y, z)] = vec4f(v, 0.0);
}

// physics self-check: peak speed, interior peak/mean divergence.
// Fixed-point atomicAdd (2^10) since WGSL has no float atomics; NaN wins a bitwise max.
@group(0) @binding(7) var<storage, read_write> stats: array<atomic<u32>>;

const DIV_MEAN_SCALE: f32 = 1024.0;
// the no-slip wall zeroing in `project` leaves divergence in the two cell layers next to a wall,
// so the check measures the flow away from them
const DIV_MARGIN: i32 = 6;

@compute @workgroup_size(4, 4, 4)
fn measure(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  let i = cell_index(x, y, z);
  atomicMax(&stats[0], bitcast<u32>(length(velR[i].xyz)));
  if (x >= DIV_MARGIN && y >= DIV_MARGIN && z >= DIV_MARGIN
      && x < NX - DIV_MARGIN && y < NY - DIV_MARGIN && z < NZ - DIV_MARGIN) {
    let a = abs(div[i]);
    atomicMax(&stats[1], bitcast<u32>(a));
    atomicAdd(&stats[2], u32(a * DIV_MEAN_SCALE));
    atomicAdd(&stats[3], 1u);
  }
}

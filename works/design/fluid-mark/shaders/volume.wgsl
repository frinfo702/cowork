// Volumetric single-scattering render of the density field.
// The box is the unit cube; the plume rises in +Y. vgpu's uv is y-down, so ndc.y is flipped.

struct Camera {
  eye: vec4f,     // xyz eye, w unused
  look: vec4f,    // xyz look-at, w = tan(half fov)
  light: vec4f,   // xyz direction toward the key light
  grade: vec4f,   // x sigma, y key, z ambient, w exposure
  tune: vec4f,    // x grain, y vignette, z phase g, w march steps
};

@group(0) @binding(0) var vol: texture_3d<f32>;
@group(0) @binding(1) var shd: texture_3d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> cam: Camera;

const BOX_LO = vec3f(-0.5);
const BOX_HI = vec3f(0.5);

const BG_LO = vec3f(0.010, 0.009, 0.022);
const BG_HI = vec3f(0.030, 0.032, 0.072);
const AMB_COL = vec3f(0.14, 0.12, 0.34);
const KEY_COL = vec3f(1.0, 0.95, 0.88);
const CORE_COL = vec3f(1.0, 0.80, 0.55);
const WARM_COL = vec3f(1.0, 0.55, 0.22);

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

// Henyey-Greenstein: forward scattering is what makes smoke read as lit from one side
fn hg(cos_theta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (12.5663706 * pow(max(1.0 + g2 - 2.0 * g * cos_theta, 1.0e-4), 1.5));
}

fn hash13(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + vec3f(dot(q, q.yzx + vec3f(33.33)));
  return fract((q.x + q.y) * q.z);
}

@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let eye = cam.eye.xyz;
  let fwd = normalize(cam.look.xyz - eye);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let rd = normalize(fwd + (right * ndc.x + up * ndc.y) * cam.look.w);

  let inv = 1.0 / rd;
  let ta = (BOX_LO - eye) * inv;
  let tb = (BOX_HI - eye) * inv;
  let tmin = max(max(min(ta.x, tb.x), min(ta.y, tb.y)), min(ta.z, tb.z));
  let tmax = min(min(max(ta.x, tb.x), max(ta.y, tb.y)), max(ta.z, tb.z));

  let grad = mix(BG_LO, BG_HI, smoothstep(-0.9, 0.9, ndc.y));
  var color = grad;

  if (tmax > max(tmin, 0.0)) {
    let t0 = max(tmin, 0.0);
    let steps = i32(cam.tune.w);
    let dt = (tmax - t0) / f32(steps);
    let sigma = cam.grade.x;
    let key = cam.grade.y;
    let amb = cam.grade.z;
    let ldir = normalize(cam.light.xyz);

    var trans = 1.0;
    var acc = vec3f(0.0);
    var t = t0 + dt * 0.5;

    for (var s = 0; s < steps; s = s + 1) {
      let p = eye + rd * t;
      let uvw = clamp(p + vec3f(0.5), vec3f(0.0), vec3f(1.0));
      let d = textureSampleLevel(vol, samp, uvw, 0.0).r;
      if (d > 0.0015) {
        let sh = textureSampleLevel(shd, samp, uvw, 0.0).r;
        let a = 1.0 - exp(-d * sigma * dt);
        let core = smoothstep(0.35, 0.90, d);
        let ph = hg(dot(rd, ldir), cam.tune.z);
        let lit = amb * AMB_COL + key * sh * mix(KEY_COL, CORE_COL, core) * (ph * 4.0 + 0.45);
        let warm = WARM_COL * core * core * core * sh * 0.55;
        acc = acc + trans * a * (lit + warm);
        trans = trans * (1.0 - a);
        if (trans < 0.004) { break; }
      }
      t = t + dt;
    }
    color = grad * trans + acc;
  }

  // rim: a sliver of light where the view grazes the light direction
  let rim = clamp(dot(rd, normalize(cam.light.xyz)), 0.0, 1.0);
  color = color * (1.0 + 0.10 * rim * rim);

  color = color * cam.grade.w;
  color = aces(color);

  let vig = 1.0 - cam.tune.y * pow(clamp(length(ndc * vec2f(0.62, 0.62)), 0.0, 1.0), 2.6);
  color = color * vig;

  let g = (hash13(vec3f(uv * 4096.0, 7.0)) - 0.5) * cam.tune.x;
  color = color + vec3f(g);

  return vec4f(color, 1.0);
}

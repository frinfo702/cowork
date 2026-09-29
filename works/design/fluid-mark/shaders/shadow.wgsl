// per-cell transmittance toward the key light: one shadow fetch replaces a light march at render time
override NX: i32 = 128;
override NY: i32 = 128;
override NZ: i32 = 128;

override SHADOW_STEPS: i32 = 96;
override SHADOW_LEN: f32 = 1.75;
override SHADOW_K: f32 = 3.4;

override LX: f32 = -0.42;
override LY: f32 = 0.80;
override LZ: f32 = 0.43;

@group(0) @binding(0) var vol: texture_3d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var shd: texture_storage_3d<rgba16float, write>;

fn light_dir() -> vec3f {
  return normalize(vec3f(LX, LY, LZ));
}

@compute @workgroup_size(4, 4, 4)
fn shadow(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let size = vec3f(f32(NX), f32(NY), f32(NZ));
  let uv = (vec3f(gid) + vec3f(0.5)) / size;
  let ldir = light_dir();
  let dl = SHADOW_LEN / f32(SHADOW_STEPS);

  var tau = 0.0;
  var p = uv + ldir * (dl * 0.7);
  for (var s = 0; s < SHADOW_STEPS; s = s + 1) {
    if (any(p < vec3f(0.0)) || any(p > vec3f(1.0))) { break; }
    tau = tau + textureSampleLevel(vol, samp, p, 0.0).r * dl;
    p = p + ldir * dl;
  }
  textureStore(shd, vec3i(gid), vec4f(exp(-SHADOW_K * tau), 0.0, 0.0, 1.0));
}

// publish the simulated density as a sampleable 3D texture
override NX: i32 = 128;
override NY: i32 = 128;
override NZ: i32 = 128;

@group(0) @binding(0) var<storage, read_write> den: array<f32>;
@group(0) @binding(1) var vol: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn export_volume(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(NX) || gid.y >= u32(NY) || gid.z >= u32(NZ)) { return; }
  let i = (i32(gid.z) * NY + i32(gid.y)) * NX + i32(gid.x);
  let d = den[i];
  textureStore(vol, vec3i(gid), vec4f(d, d * d, 0.0, 1.0));
}

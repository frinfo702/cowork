import { init, compute, effect, frame, sampler, storage, target, texture, uniforms } from 'vgpu/node';
import { encodePNG } from './png.mjs';
import { writeFileSync } from 'node:fs';

const gpu = await init();
const N = 16;
const a = storage(gpu, N * N * N * 4, 'read-write');
const vol = texture(gpu, {
  kind: '3d',
  size: [N, N, N],
  format: 'rgba16float',
  usage: ['storage_binding', 'texture_binding', 'copy_src'],
});

const cs = compute(
  gpu,
  `
override N: i32 = 16;
@group(0) @binding(0) var<storage, read_write> a: array<f32>;
@group(0) @binding(1) var vol: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(N) || gid.y >= u32(N) || gid.z >= u32(N)) { return; }
  let i = (i32(gid.z) * N + i32(gid.y)) * N + i32(gid.x);
  a[i] = f32(i) * 0.5;
  let c = vec3f(gid) / f32(N);
  textureStore(vol, vec3i(gid), vec4f(c, 1.0));
}`,
  { constants: { N }, set: {} },
);
cs.set({ a, vol });
cs.dispatch(N / 4, N / 4, N / 4);

const cfg = uniforms(gpu, {
  box: [0, 0, 0, 0],
  params: [1, 1, 1, 1],
});
const fx = effect(
  gpu,
  `
struct Cfg {
  box: vec4f,
  params: vec4f,
};
@group(0) @binding(0) var<uniform> cfg: Cfg;
@group(0) @binding(1) var vol: texture_3d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let s = textureSampleLevel(vol, samp, vec3f(uv.x, 1.0 - uv.y, cfg.box.w), 0.0);
  return vec4f(s.rgb * cfg.params.x, 1.0);
}`,
  { set: { cfg, vol, samp: sampler(gpu, { magFilter: 'linear', minFilter: 'linear' }) } },
);

const t = target(gpu, { size: [64, 64], format: 'rgba8unorm', clearColor: [0, 0, 0, 1] });
frame(gpu, (f) => f.pass(t, fx));

const pixels = await t.color.read({ mipLevel: 0, region: 'all' });
const buf = await a.read();
const floats = new Float32Array(buf);
console.log('storage a[0], a[7], a[last]:', floats[0], floats[7], floats[N * N * N - 1]);
console.log('target px (0,0) rgba:', [...pixels.slice(0, 4)]);
const mid = (32 * 64 + 32) * 4;
console.log('target px (32,32) rgba:', [...pixels.slice(mid, mid + 4)]);
writeFileSync('out-probe.png', encodePNG(64, 64, pixels));
gpu.dispose();
console.log('probe ok');

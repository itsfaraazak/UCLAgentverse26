struct Camera {
  viewProjection: mat4x4f,
}

struct Lighting {
  direction: vec3f,
  ambient: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> lighting: Lighting;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) world0: vec4f,
  @location(4) world1: vec4f,
  @location(5) world2: vec4f,
  @location(6) world3: vec4f,
  @location(7) tint: vec4f,
}

struct VertexOutput {
  @builtin(position) clip: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) tint: vec4f,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let world = mat4x4f(input.world0, input.world1, input.world2, input.world3);
  var out: VertexOutput;
  out.clip = camera.viewProjection * (world * vec4f(input.position, 1.0));
  out.worldNormal = normalize((world * vec4f(input.normal, 0.0)).xyz);
  out.tint = input.tint;
  return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let n = normalize(input.worldNormal);
  let light = normalize(lighting.direction);
  let diff = max(dot(n, light), 0.0);
  let color = input.tint.xyz * (lighting.ambient + (1.0 - lighting.ambient) * diff);
  return vec4f(color, input.tint.w);
}

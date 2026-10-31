import { AdditiveBlending, BackSide, Color, DoubleSide, ShaderMaterial, Vector2, Vector3, type IUniform, type Texture } from 'three';
import type { MaterialKey } from '../core/types';

export const MAX_LIGHTS = 8;

/** Uniforms shared by every material; updated once per render pass. */
export const shared = {
  uTime: { value: 0 } as IUniform<number>,
  uFogColor: { value: new Color('#d8a7c3') } as IUniform<Color>,
  uFogDensity: { value: 0.012 } as IUniform<number>,
  uSkyTop: { value: new Color('#1d1946') } as IUniform<Color>,
  uSkyBottom: { value: new Color('#f4b6c2') } as IUniform<Color>,
  uStars: { value: 0.8 } as IUniform<number>,
  uResolution: { value: new Vector2(1, 1) } as IUniform<Vector2>,
  uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) } as IUniform<Vector3[]>,
  uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) } as IUniform<Vector3[]>,
  uLightCount: { value: 0 } as IUniform<number>,
};

const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
`;

const FOG = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogDensity;
vec3 applyFog(vec3 col, float dist){ float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0)); return mix(col, uFogColor, clamp(f, 0.0, 1.0)); }
`;

export interface MatSpec {
  pattern: number;
  a: string;
  b: string;
  emissive?: number;
}

export const MATERIALS: Record<MaterialKey, MatSpec> = {
  plaster: { pattern: 0, a: '#f3dfe6', b: '#d9bccb' },
  checker: { pattern: 1, a: '#f6efe6', b: '#3a3150' },
  marble: { pattern: 2, a: '#f4f0f5', b: '#9e8fb8' },
  tile: { pattern: 3, a: '#e8f1f2', b: '#a9bfc7' },
  night: { pattern: 4, a: '#151538', b: '#6b4fb0' },
  grid: { pattern: 5, a: '#10223a', b: '#62f0ff', emissive: 1 },
  wood: { pattern: 6, a: '#b98a64', b: '#7e5a43' },
  glow: { pattern: 7, a: '#fff1c4', b: '#ffd27a', emissive: 1 },
  brick: { pattern: 8, a: '#c9776d', b: '#f1d7cf' },
  hedge: { pattern: 9, a: '#4f8a68', b: '#a6d39b' },
  cloud: { pattern: 10, a: '#fff4f8', b: '#e7c6e9' },
  gold: { pattern: 11, a: '#e8b84f', b: '#fff2c8' },
};

const WORLD_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
attribute vec3 aMin;
attribute vec3 aMax;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vMin;
varying vec3 vMax;
varying float vDist;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vMin = (modelMatrix * vec4(aMin, 1.0)).xyz;
  vMax = (modelMatrix * vec4(aMax, 1.0)).xyz;
  vec4 mvPosition = viewMatrix * wp;
  vDist = length(mvPosition.xyz);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const WORLD_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform vec3 uColA; uniform vec3 uColB; uniform int uPattern; uniform float uEmissive; uniform float uTime; uniform float uOpacity;
uniform vec3 uLightPos[${MAX_LIGHTS}]; uniform vec3 uLightCol[${MAX_LIGHTS}]; uniform int uLightCount;
varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vMin; varying vec3 vMax; varying float vDist;
${NOISE}
${FOG}
void main(){
  #include <clipping_planes_fragment>
  vec3 n = normalize(vNormalW);
  vec3 an = abs(n);
  vec2 uv; vec2 lo; vec2 hi;
  if (an.y > 0.5) { uv = vWorld.xz; lo = vWorld.xz - vMin.xz; hi = vMax.xz - vWorld.xz; }
  else if (an.x > 0.5) { uv = vWorld.zy; lo = vWorld.zy - vMin.zy; hi = vMax.zy - vWorld.zy; }
  else { uv = vWorld.xy; lo = vWorld.xy - vMin.xy; hi = vMax.xy - vWorld.xy; }
  float edge = min(min(abs(lo.x), abs(lo.y)), min(abs(hi.x), abs(hi.y)));
  vec3 col = uColA;
  float emit = uEmissive;
  if (uPattern == 0) { // plaster
    float v = fbm(uv * 0.9) * 0.6 + fbm(uv * 6.0) * 0.15;
    col = mix(uColA, uColB, v * 0.55);
    float panel = smoothstep(0.0, 0.03, abs(fract(vWorld.y / 3.0 + 0.001) - 0.5) - 0.48);
    col *= 0.97 + 0.03 * (1.0 - panel);
  } else if (uPattern == 1) { // checker
    vec2 c = floor(uv);
    float k = mod(c.x + c.y, 2.0);
    col = mix(uColA, uColB, k);
    vec2 f = abs(fract(uv) - 0.5);
    col *= 1.0 - 0.08 * smoothstep(0.47, 0.5, max(f.x, f.y));
    col += 0.04 * fbm(uv * 3.0);
  } else if (uPattern == 2) { // marble
    float t = fbm(uv * 0.6) * 6.0;
    float vein = 1.0 - smoothstep(0.0, 0.12, abs(sin(uv.x * 0.9 + uv.y * 0.4 + t)));
    col = mix(uColA, uColB, vein * 0.55 + fbm(uv * 2.0) * 0.1);
  } else if (uPattern == 3) { // tile
    vec2 g = abs(fract(uv * 2.0) - 0.5);
    float grout = smoothstep(0.44, 0.48, max(g.x, g.y));
    col = mix(uColA * (0.95 + 0.08 * hash12(floor(uv * 2.0))), uColB, grout);
  } else if (uPattern == 4) { // night sky walls
    col = mix(uColA, uColB, fbm(uv * 0.25 + uTime * 0.01) * 0.6);
    vec2 cell = floor(uv * 4.0);
    float h = hash12(cell);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 40.0);
    vec2 sp = fract(uv * 4.0) - vec2(hash12(cell + 3.1), hash12(cell + 7.7));
    float star = step(0.93, h) * smoothstep(0.08, 0.0, length(sp)) * tw;
    col += vec3(1.0, 0.95, 0.9) * star * 1.5;
    emit = 0.6;
  } else if (uPattern == 5) { // glowing grid
    vec2 g = abs(fract(uv) - 0.5);
    float line = smoothstep(0.46, 0.5, max(g.x, g.y));
    col = mix(uColA, uColB, line);
    emit = line;
  } else if (uPattern == 6) { // wood planks
    float plank = floor(uv.y * 4.0);
    float grain = fbm(vec2(uv.x * 0.6 + plank * 7.3, uv.y * 14.0));
    col = mix(uColA, uColB, grain * 0.7 + 0.2 * hash12(vec2(plank, 1.0)));
    col *= 1.0 - 0.25 * smoothstep(0.45, 0.5, abs(fract(uv.y * 4.0) - 0.5));
  } else if (uPattern == 7) { // glow
    col = mix(uColA, uColB, 0.5 + 0.5 * sin(uTime * 1.5 + vWorld.x + vWorld.z));
    emit = 1.0;
  } else if (uPattern == 8) { // brick
    vec2 b = uv * vec2(2.0, 4.0);
    b.x += 0.5 * mod(floor(b.y), 2.0);
    vec2 f = abs(fract(b) - 0.5);
    float mortar = smoothstep(0.44, 0.49, max(f.x * 1.0, f.y));
    col = mix(uColA * (0.85 + 0.25 * hash12(floor(b))), uColB, mortar);
  } else if (uPattern == 9) { // hedge
    float l = fbm(uv * 5.0) * 0.7 + fbm(uv * 17.0) * 0.4;
    col = mix(uColA * 0.7, uColB, l);
  } else if (uPattern == 10) { // cloud
    col = mix(uColA, uColB, fbm(uv * 0.15 + uTime * 0.02));
    emit = 0.45;
  } else { // gold
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(v, n), 0.0), 2.0);
    float band = 0.5 + 0.5 * sin(dot(vWorld, vec3(0.7, 1.3, 0.5)) * 1.5 + fbm(uv) * 3.0);
    col = mix(uColA, uColB, fres * 0.8 + band * 0.25);
  }
  // Lighting: soft key light + hemisphere + local glow lights.
  vec3 sun = normalize(vec3(0.45, 0.85, 0.3));
  float diff = 0.58 + 0.30 * max(dot(n, sun), 0.0) + 0.08 * n.y + 0.04 * n.x;
  vec3 light = vec3(diff);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 d = uLightPos[i] - vWorld;
    float r = length(uLightCol[i]) > 0.0 ? 1.0 : 0.0;
    float dist = length(d);
    float range = 9.0;
    float att = pow(clamp(1.0 - dist / range, 0.0, 1.0), 2.0) * r;
    float ndl = max(dot(n, d / max(dist, 1e-3)), 0.0) * 0.7 + 0.3;
    light += uLightCol[i] * att * ndl * 0.55;
  }
  // Bevel highlight and contact shadow from block bounds.
  float bevel = 1.0 - smoothstep(0.0, 0.045, edge);
  float contact = (an.y < 0.5) ? mix(0.72, 1.0, smoothstep(0.0, 0.9, vWorld.y - vMin.y)) : 1.0;
  vec3 lit = col * mix(light * contact, vec3(1.0), emit);
  lit += bevel * 0.10 * (1.0 - emit);
  lit = applyFog(lit, vDist);
  gl_FragColor = vec4(lit, uOpacity);
}
`;

export function createWorldMaterial(key: MaterialKey): ShaderMaterial {
  const spec = MATERIALS[key];
  return new ShaderMaterial({
    name: `world:${key}`,
    vertexShader: WORLD_VERT,
    fragmentShader: WORLD_FRAG,
    clipping: true,
    uniforms: {
      uColA: { value: new Color(spec.a) },
      uColB: { value: new Color(spec.b) },
      uPattern: { value: spec.pattern },
      uEmissive: { value: spec.emissive ?? 0 },
      uOpacity: { value: 1 },
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uLightPos: shared.uLightPos,
      uLightCol: shared.uLightCol,
      uLightCount: shared.uLightCount,
    },
  });
}

const PORTAL_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec2 vLocal;
void main(){
  vLocal = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PORTAL_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform sampler2D map; uniform vec2 uResolution; uniform float uMode; uniform float uTime; uniform vec3 uFogColor; uniform vec3 uTint;
varying vec2 vLocal;
${NOISE}
void main(){
  #include <clipping_planes_fragment>
  if (uMode < 0.5) {
    gl_FragColor = vec4(texture2D(map, gl_FragCoord.xy / uResolution).rgb, 1.0);
  } else if (uMode < 1.5) {
    gl_FragColor = vec4(uFogColor, 1.0);
  } else {
    // Closed portal: swirling dream mist.
    vec2 p = vLocal * 1.6;
    float a = fbm(p + vec2(uTime * 0.15, -uTime * 0.2));
    float b = fbm(p * 2.0 - a * 2.0 + uTime * 0.1);
    vec3 col = mix(uTint * 0.35, vec3(1.0, 0.95, 1.0), b * b * 1.4);
    gl_FragColor = vec4(mix(col, uFogColor, 0.25), 1.0);
  }
}
`;

export function createPortalMaterial(tint = '#c9b8ff'): ShaderMaterial {
  return new ShaderMaterial({
    name: 'portal',
    vertexShader: PORTAL_VERT,
    fragmentShader: PORTAL_FRAG,
    clipping: true,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: {
      map: { value: null as Texture | null },
      uMode: { value: 1 },
      uTint: { value: new Color(tint) },
      uResolution: shared.uResolution,
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
    },
  });
}

const GLOW_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec2 vUv;
varying float vDist;
void main(){
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mvPosition.xyz);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const GLOW_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform vec3 uColor; uniform float uTime; uniform float uIntensity; uniform float uShape;
varying vec2 vUv;
varying float vDist;
${FOG}
void main(){
  #include <clipping_planes_fragment>
  float a;
  if (uShape < 0.5) { // radial sprite
    float d = length(vUv - 0.5) * 2.0;
    a = pow(max(1.0 - d, 0.0), 2.2);
  } else { // frame strip: bright along the centre line
    a = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 1.5) * (0.75 + 0.25 * sin(uTime * 3.0 + vUv.x * 12.0));
  }
  float fog = exp(-pow(vDist * uFogDensity, 2.0));
  gl_FragColor = vec4(uColor * a * uIntensity * fog, 1.0);
}
`;

export function createGlowMaterial(color: string, intensity = 1, shape: 'sprite' | 'strip' = 'sprite'): ShaderMaterial {
  return new ShaderMaterial({
    name: 'glow',
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    clipping: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: {
      uColor: { value: new Color(color) },
      uIntensity: { value: intensity },
      uShape: { value: shape === 'sprite' ? 0 : 1 },
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
    },
  });
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww * vec4(1.0, 1.0, 0.99999, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSkyTop; uniform vec3 uSkyBottom; uniform vec3 uFogColor; uniform float uStars; uniform float uTime;
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  float t = d.y;
  vec3 col = mix(uFogColor, uSkyBottom, smoothstep(-0.08, 0.12, t));
  col = mix(col, uSkyTop, smoothstep(0.08, 0.85, t));
  // Soft cloud bands.
  vec2 cp = d.xz / max(d.y + 0.25, 0.05);
  float cl = fbm(cp * 0.8 + uTime * 0.01);
  col = mix(col, mix(uSkyBottom, vec3(1.0), 0.4), smoothstep(0.55, 0.9, cl) * smoothstep(0.0, 0.25, t) * 0.35);
  // Stars.
  vec3 sp = d * 220.0;
  vec3 cell = floor(sp);
  float h = hash13(cell);
  vec3 off = fract(sp) - vec3(hash13(cell + 1.7), hash13(cell + 5.3), hash13(cell + 9.1));
  float star = step(0.985, h) * smoothstep(0.35, 0.0, length(off)) * (0.6 + 0.4 * sin(uTime * 3.0 + h * 90.0));
  col += vec3(1.0, 0.96, 0.92) * star * uStars * smoothstep(0.05, 0.4, t);
  // A pale moon.
  vec3 moonDir = normalize(vec3(-0.4, 0.55, -0.73));
  float m = dot(d, moonDir);
  col += vec3(1.0, 0.97, 0.9) * (smoothstep(0.9993, 0.9996, m) * 0.9 + pow(max(m, 0.0), 180.0) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSkyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'sky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uSkyTop: shared.uSkyTop,
      uSkyBottom: shared.uSkyBottom,
      uFogColor: shared.uFogColor,
      uStars: shared.uStars,
      uTime: shared.uTime,
    },
  });
}

const SIGN_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform sampler2D map; uniform float uOpacity;
varying vec2 vUv;
varying float vDist;
${FOG}
void main(){
  #include <clipping_planes_fragment>
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.02) discard;
  gl_FragColor = vec4(applyFog(t.rgb, vDist), t.a * uOpacity);
}
`;

export function createSignMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    name: 'sign',
    vertexShader: GLOW_VERT,
    fragmentShader: SIGN_FRAG,
    clipping: true,
    transparent: true,
    side: DoubleSide,
    uniforms: { map: { value: map }, uOpacity: { value: 1 }, uFogColor: shared.uFogColor, uFogDensity: shared.uFogDensity },
  });
}

const CRYSTAL_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec3 vN; varying vec3 vV; varying float vDist;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vec4 mvPosition = viewMatrix * wp;
  vDist = length(mvPosition.xyz);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const CRYSTAL_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform vec3 uColor; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying float vDist;
${FOG}
void main(){
  #include <clipping_planes_fragment>
  float f = pow(1.0 - abs(dot(normalize(vN), vV)), 1.5);
  vec3 col = mix(uColor * 0.8, vec3(1.0), f * 0.9) + 0.15 * sin(uTime * 4.0);
  gl_FragColor = vec4(applyFog(col, vDist * 0.6), 1.0);
}
`;

export function createCrystalMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    name: 'crystal',
    vertexShader: CRYSTAL_VERT,
    fragmentShader: CRYSTAL_FRAG,
    clipping: true,
    uniforms: { uColor: { value: new Color(color) }, uTime: shared.uTime, uFogColor: shared.uFogColor, uFogDensity: shared.uFogDensity },
  });
}

export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const POST_FRAG = /* glsl */ `
uniform sampler2D tScene; uniform vec2 uResolution; uniform float uTime; uniform float uShift; uniform float uFade; uniform vec3 uFadeColor; uniform float uAberration;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  // Reality-shift ripple.
  float r = length(c);
  uv += c * sin(r * 40.0 - uTime * 18.0) * 0.006 * uShift;
  float ab = (0.0015 + 0.006 * uShift) * uAberration;
  vec3 col;
  col.r = texture2D(tScene, uv + c * ab).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - c * ab).b;
  // Dreamy grade: lift shadows towards violet, gentle S-curve.
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
  col = col * 0.94 + vec3(0.03, 0.015, 0.05);
  float vig = smoothstep(0.85, 0.25, r);
  col *= mix(0.72, 1.0, vig);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.025;
  col = mix(col, uFadeColor, uFade);
  gl_FragColor = vec4(col, 1.0);
}
`;

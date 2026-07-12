// Three r171 exposes WebGPU/TSL runtime entry points before their matching
// declaration files. Keep core Three.js types while treating the experimental
// shader-node helpers as dynamic values.
declare module "three/webgpu" {
  export * from "three";
  export type WebGPURenderer = any;
  export const WebGPURenderer: any;
  export const MeshBasicNodeMaterial: any;
  export const PostProcessing: any;
}

declare module "three/tsl" {
  export const texture: any;
  export const uv: any;
  export const attribute: any;
  export const float: any;
  export const vec2: any;
  export const vec3: any;
  export const vec4: any;
  export const mod: any;
  export const floor: any;
  export const uniform: any;
  export const mix: any;
  export const min: any;
  export const step: any;
  export const pass: any;
  export const positionGeometry: any;
  export const modelViewMatrix: any;
  export const cameraProjectionMatrix: any;
  export const positionView: any;
  export const smoothstep: any;
  export const screenUV: any;
  export const sin: any;
  export const length: any;
}

declare module 'three/webgpu' {
  export * from 'three';
  import { WebGLRenderer, WebGLRendererParameters, Material } from 'three';

  export interface WebGPURendererParameters extends WebGLRendererParameters {
    forceWebGL?: boolean;
  }

  export class WebGPURenderer extends WebGLRenderer {
    constructor(parameters?: WebGPURendererParameters);
    init(): Promise<void>;
    setAnimationLoop(callback: ((time: DOMHighResTimeStamp) => void) | null): void;
    renderAsync(scene: any, camera: any): Promise<void>;
  }

  export class MeshLambertNodeMaterial extends Material {
    constructor(parameters?: any);
    colorNode?: any;
    emissiveNode?: any;
    lightsNode?: any;
    positionNode?: any;
  }

  export class MeshBasicNodeMaterial extends Material {
    constructor(parameters?: any);
    colorNode?: any;
    opacityNode?: any;
    positionNode?: any;
  }
}

declare module 'three/tsl' {
  export function uniform(value: any): any;
  export function attribute(name: string, type?: string): any;
  export function color(r?: any, g?: any, b?: any): any;
  export function vec2(x?: any, y?: any): any;
  export function vec3(x?: any, y?: any, z?: any): any;
  export function vec4(x?: any, y?: any, z?: any, w?: any): any;
  export function float(val: any): any;
  export function mix(a: any, b: any, t: any): any;
  export function Fn(fn: (...args: any[]) => any): any;
}

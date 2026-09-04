import * as THREE from 'three';

export class VoxelMaterialManager {
  material: THREE.Material;
  glslUniforms: { uNight: { value: number } } = { uNight: { value: 0.0 } };

  constructor() {
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      reflectivity: 0.1
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = this.glslUniforms.uNight;

      shader.vertexShader = `
        attribute float aEmissive;
        varying float vEmissive;
        ${shader.vertexShader}
      `;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
         vEmissive = aEmissive;`
      );

      shader.fragmentShader = `
        varying float vEmissive;
        uniform float uNight;
        ${shader.fragmentShader}
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         if (vEmissive > 0.5) {
           gl_FragColor.rgb += vec3(0.95, 0.75, 0.25) * (0.6 + uNight * 1.8);
         }
        `
      );
    };

    this.material = mat;
  }

  setNightLevel(val: number): void {
    this.glslUniforms.uNight.value = val;
  }
}

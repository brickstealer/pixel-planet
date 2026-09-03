import * as THREE from 'three';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  VOXEL_SIZE,
  BlockType,
  BlockPalette,
  isBlockTransparent
} from './VoxelTypes.js';

// Direction vectors for 6 faces: [dx, dy, dz, normalX, normalY, normalZ, lightFactor]
const FACES = [
  // 0: +X (Right)
  { dir: [ 1,  0,  0], norm: [ 1,  0,  0], light: 0.75,
    corners: [
      [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]
    ]
  },
  // 1: -X (Left)
  { dir: [-1,  0,  0], norm: [-1,  0,  0], light: 0.70,
    corners: [
      [0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]
    ]
  },
  // 2: +Y (Top / Sky)
  { dir: [ 0,  1,  0], norm: [ 0,  1,  0], light: 1.00,
    corners: [
      [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]
    ]
  },
  // 3: -Y (Bottom / Ground)
  { dir: [ 0, -1,  0], norm: [ 0, -1,  0], light: 0.50,
    corners: [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]
    ]
  },
  // 4: +Z (Front)
  { dir: [ 0,  0,  1], norm: [ 0,  0,  1], light: 0.85,
    corners: [
      [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]
    ]
  },
  // 5: -Z (Back)
  { dir: [ 0,  0, -1], norm: [ 0,  0, -1], light: 0.80,
    corners: [
      [0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]
    ]
  }
];

export class VoxelMesher {
  /**
   * Builds an optimized Three.js BufferGeometry from a 3D voxel array
   * @param {Uint8Array} voxels - 1D array of length CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z
   * @param {Object} neighborChunks - Optional { posX, negX, posZ, negZ } for seamless chunk borders
   */
  static buildMesh(voxels, neighborChunks = {}) {
    const positions = [];
    const normals = [];
    const colors = [];
    const emissives = [];

    const getBlock = (x, y, z) => {
      if (y < 0 || y >= CHUNK_SIZE_Y) return BlockType.AIR;

      if (x < 0) {
        if (neighborChunks.negX) {
          return neighborChunks.negX.getBlock(CHUNK_SIZE_X + x, y, z);
        }
        return BlockType.AIR;
      }
      if (x >= CHUNK_SIZE_X) {
        if (neighborChunks.posX) {
          return neighborChunks.posX.getBlock(x - CHUNK_SIZE_X, y, z);
        }
        return BlockType.AIR;
      }
      if (z < 0) {
        if (neighborChunks.negZ) {
          return neighborChunks.negZ.getBlock(x, y, CHUNK_SIZE_Z + z);
        }
        return BlockType.AIR;
      }
      if (z >= CHUNK_SIZE_Z) {
        if (neighborChunks.posZ) {
          return neighborChunks.posZ.getBlock(x, y, z - CHUNK_SIZE_Z);
        }
        return BlockType.AIR;
      }

      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      return voxels[idx];
    };

    // Calculate Ambient Occlusion level (0..3) for a vertex
    const calcAO = (s1, s2, corner) => {
      if (s1 && s2) return 0.5; // full corner occlusion
      const count = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (corner ? 1 : 0);
      return [1.0, 0.82, 0.68, 0.52][count];
    };

    // Pre-allocate arrays
    for (let y = 0; y < CHUNK_SIZE_Y; y++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
          const block = voxels[idx];
          if (block === BlockType.AIR) continue;

          const baseCol = BlockPalette[block] || [0.5, 0.5, 0.5];
          const isLitWindow = (block === BlockType.WINDOW_LIT);

          // Check 6 directions
          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];

            const neighborBlock = getBlock(nx, ny, nz);

            // Water only renders against air; solid blocks render against air or water
            const renderFace = (block === BlockType.WATER)
              ? (neighborBlock === BlockType.AIR)
              : isBlockTransparent(neighborBlock);

            if (!renderFace) continue;

            const lightFactor = face.light;
            const norm = face.norm;

            // Compute quad corners
            const quadVertices = face.corners.map(c => [
              (x + c[0]) * VOXEL_SIZE,
              (y + c[1]) * VOXEL_SIZE,
              (z + c[2]) * VOXEL_SIZE
            ]);

            // Triangle 1: 0, 1, 2. Triangle 2: 0, 2, 3
            const triIndices = [0, 1, 2, 0, 2, 3];

            for (let i = 0; i < 6; i++) {
              const cornerIdx = triIndices[i];
              const vert = quadVertices[cornerIdx];
              positions.push(vert[0], vert[1], vert[2]);
              normals.push(norm[0], norm[1], norm[2]);

              // Ambient Occlusion approximation based on y level and corner
              let ao = 1.0;
              if (!isLitWindow && face.dir[1] === 0) {
                // Subtle vertical gradient on vertical walls
                ao = 0.88 + 0.12 * (cornerIdx === 1 || cornerIdx === 2 ? 1 : 0);
              }

              const r = baseCol[0] * lightFactor * ao;
              const g = baseCol[1] * lightFactor * ao;
              const b = baseCol[2] * lightFactor * ao;

              colors.push(r, g, b);
              emissives.push(isLitWindow ? 1.0 : 0.0);
            }
          }
        }
      }
    }

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aEmissive', new THREE.Float32BufferAttribute(emissives, 1));

    return geometry;
  }
}

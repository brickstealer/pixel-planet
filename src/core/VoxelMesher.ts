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

interface FastFaceDef {
  dirX: number;
  dirY: number;
  dirZ: number;
  normX: number;
  normY: number;
  normZ: number;
  light: number;
  triVertices: Float32Array; // 18 numbers: 6 vertices * 3 coords
  ao: Float32Array;          // 6 numbers
}

const RAW_FACES = [
  // 0: +X (Right)
  { dir: [1, 0, 0], norm: [1, 0, 0], light: 0.75, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], isWall: true },
  // 1: -X (Left)
  { dir: [-1, 0, 0], norm: [-1, 0, 0], light: 0.70, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], isWall: true },
  // 2: +Y (Top / Sky)
  { dir: [0, 1, 0], norm: [0, 1, 0], light: 1.00, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], isWall: false },
  // 3: -Y (Bottom / Ground)
  { dir: [0, -1, 0], norm: [0, -1, 0], light: 0.50, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], isWall: false },
  // 4: +Z (Front)
  { dir: [0, 0, 1], norm: [0, 0, 1], light: 0.85, corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], isWall: true },
  // 5: -Z (Back)
  { dir: [0, 0, -1], norm: [0, 0, -1], light: 0.80, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], isWall: true }
];

const TRI_INDICES = [0, 1, 2, 0, 2, 3];

const FAST_FACES: FastFaceDef[] = RAW_FACES.map(f => {
  const triVerts = new Float32Array(18);
  const ao = new Float32Array(6);

  for (let i = 0; i < 6; i++) {
    const cIdx = TRI_INDICES[i];
    const corner = f.corners[cIdx];
    triVerts[i * 3 + 0] = corner[0];
    triVerts[i * 3 + 1] = corner[1];
    triVerts[i * 3 + 2] = corner[2];

    if (f.isWall) {
      ao[i] = 0.88 + 0.12 * (cIdx === 1 || cIdx === 2 ? 1.0 : 0.0);
    } else {
      ao[i] = 1.0;
    }
  }

  return {
    dirX: f.dir[0],
    dirY: f.dir[1],
    dirZ: f.dir[2],
    normX: f.norm[0],
    normY: f.norm[1],
    normZ: f.norm[2],
    light: f.light,
    triVertices: triVerts,
    ao
  };
});

export interface NeighborChunkProvider {
  getBlock(x: number, y: number, z: number): BlockType;
}

export interface NeighborChunks {
  posX?: NeighborChunkProvider;
  negX?: NeighborChunkProvider;
  posZ?: NeighborChunkProvider;
  negZ?: NeighborChunkProvider;
}

export class VoxelMesher {
  /**
   * Builds an optimized Three.js BufferGeometry from a 3D voxel array with zero-allocation inner loops
   */
  static buildMesh(voxels: Uint8Array, neighborChunks: NeighborChunks = {}): THREE.BufferGeometry | null {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const emissives: number[] = [];

    const getBlock = (x: number, y: number, z: number): BlockType => {
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
      return (voxels[idx] as BlockType) || BlockType.AIR;
    };

    for (let y = 0; y < CHUNK_SIZE_Y; y++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
          const block = voxels[idx] as BlockType;
          if (block === BlockType.AIR) continue;

          const baseCol = BlockPalette[block] || [0.5, 0.5, 0.5];
          const baseR = baseCol[0];
          const baseG = baseCol[1];
          const baseB = baseCol[2];
          const isLitWindow = (block === BlockType.WINDOW_LIT);

          // Check 6 directions
          for (let f = 0; f < 6; f++) {
            const face = FAST_FACES[f];
            const nx = x + face.dirX;
            const ny = y + face.dirY;
            const nz = z + face.dirZ;

            const neighborBlock = getBlock(nx, ny, nz);

            // Water only renders against air; solid blocks render against air or water
            const renderFace = (block === BlockType.WATER)
              ? (neighborBlock === BlockType.AIR)
              : isBlockTransparent(neighborBlock);

            if (!renderFace) continue;

            const fVerts = face.triVertices;
            const fAo = face.ao;
            const normX = face.normX;
            const normY = face.normY;
            const normZ = face.normZ;
            const light = face.light;

            // Direct zero-allocation loop
            for (let i = 0, v = 0; i < 6; i++, v += 3) {
              positions.push(
                (x + fVerts[v]) * VOXEL_SIZE,
                (y + fVerts[v + 1]) * VOXEL_SIZE,
                (z + fVerts[v + 2]) * VOXEL_SIZE
              );
              normals.push(normX, normY, normZ);

              const ao = isLitWindow ? 1.0 : fAo[i];
              colors.push(baseR * light * ao, baseG * light * ao, baseB * light * ao);
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

import { createNoise2D, createNoise3D, NoiseFunction2D, NoiseFunction3D } from 'simplex-noise';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  BlockType
} from '../core/VoxelTypes.js';

export class TerrainGenerator {
  seed: number;
  noise2D_continent: NoiseFunction2D;
  noise2D_detail: NoiseFunction2D;
  noise2D_biome: NoiseFunction2D;
  noise2D_city: NoiseFunction2D;
  noise3D_caves: NoiseFunction3D;
  WATER_LEVEL: number = 14;

  constructor(seed: number = 42) {
    this.seed = seed;
    // Simple PRNG for reproducible noise
    let s = seed;
    const random = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    this.noise2D_continent = createNoise2D(random);
    this.noise2D_detail = createNoise2D(random);
    this.noise2D_biome = createNoise2D(random);
    this.noise2D_city = createNoise2D(random);
    this.noise3D_caves = createNoise3D(random);
  }

  /**
   * Generates a 3D voxel array for a given chunk coordinate (chunkX, chunkZ)
   */
  generateChunk(chunkX: number, chunkZ: number): Uint8Array {
    const voxels = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);

    const setBlock = (x: number, y: number, z: number, type: BlockType) => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      voxels[idx] = type;
    };

    const getBlock = (x: number, y: number, z: number): BlockType => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return BlockType.AIR;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      return (voxels[idx] as BlockType) || BlockType.AIR;
    };

    // Global world coordinates
    const startWX = chunkX * CHUNK_SIZE_X;
    const startWZ = chunkZ * CHUNK_SIZE_Z;

    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        const wx = startWX + lx;
        const wz = startWZ + lz;

        // Multi-octave terrain height
        const nContinent = this.noise2D_continent(wx * 0.003, wz * 0.003); // macro shape
        const nHills = this.noise2D_detail(wx * 0.015, wz * 0.015); // hills
        const nRough = this.noise2D_detail(wx * 0.06, wz * 0.06); // micro detail

        // Base elevation in voxels
        let baseHeight = 20 + nContinent * 15 + nHills * 8 + nRough * 3;
        baseHeight = Math.max(4, Math.min(CHUNK_SIZE_Y - 20, Math.floor(baseHeight)));

        // Biome and City probability noise
        const nBiome = this.noise2D_biome(wx * 0.004, wz * 0.004);

        // Natural terrain: Water, Sand, Grass, Stone, Snow
        for (let y = 0; y <= baseHeight; y++) {
          if (y === baseHeight) {
            if (baseHeight > 52) {
              setBlock(lx, y, lz, BlockType.SNOW);
            } else if (baseHeight <= this.WATER_LEVEL + 1) {
              setBlock(lx, y, lz, BlockType.SAND);
            } else {
              setBlock(lx, y, lz, BlockType.GRASS);
            }
          } else if (y >= baseHeight - 3) {
            setBlock(lx, y, lz, baseHeight > 50 ? BlockType.STONE : BlockType.DIRT);
          } else {
            setBlock(lx, y, lz, BlockType.STONE);
          }
        }

        // Water body
        if (baseHeight < this.WATER_LEVEL) {
          for (let wy = baseHeight + 1; wy <= this.WATER_LEVEL; wy++) {
            setBlock(lx, wy, lz, BlockType.WATER);
          }
        }

        // Procedural trees on grassy hills
        if (baseHeight > this.WATER_LEVEL + 1 && baseHeight < 48) {
          const treeChance = Math.sin(wx * 12.9898 + wz * 78.233) * 43758.5453;
          const treeRand = Math.abs(treeChance - Math.floor(treeChance));

          // Place tree only in forest biomes (nBiome > 0.1) and spaced out
          if (treeRand > 0.94 && nBiome > -0.1 && lx >= 2 && lx <= CHUNK_SIZE_X - 3 && lz >= 2 && lz <= CHUNK_SIZE_Z - 3) {
            const trunkHeight = 4 + Math.floor(treeRand * 3);
            // Trunk
            for (let ty = baseHeight + 1; ty <= baseHeight + trunkHeight; ty++) {
              setBlock(lx, ty, lz, BlockType.TREE_TRUNK);
            }
            // Foliage leaves box
            const leafBase = baseHeight + trunkHeight - 1;
            for (let dy = 0; dy <= 2; dy++) {
              const radius = (dy === 2) ? 1 : 2;
              for (let ox = -radius; ox <= radius; ox++) {
                for (let oz = -radius; oz <= radius; oz++) {
                  if (Math.abs(ox) === radius && Math.abs(oz) === radius && dy === 2) continue;
                  if (getBlock(lx + ox, leafBase + dy, lz + oz) === BlockType.AIR) {
                    setBlock(lx + ox, leafBase + dy, lz + oz, BlockType.TREE_LEAVES);
                  }
                }
              }
            }
          }
        }
      }
    }

    return voxels;
  }
}

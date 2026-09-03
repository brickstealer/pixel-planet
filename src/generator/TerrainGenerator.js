import { createNoise2D, createNoise3D } from 'simplex-noise';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  BlockType
} from '../core/VoxelTypes.js';

export class TerrainGenerator {
  constructor(seed = 42) {
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

    this.WATER_LEVEL = 14;
  }

  /**
   * Generates a 3D voxel array for a given chunk coordinate (chunkX, chunkZ)
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {Uint8Array}
   */
  generateChunk(chunkX, chunkZ) {
    const voxels = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);

    const setBlock = (x, y, z, type) => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      voxels[idx] = type;
    };

    const getBlock = (x, y, z) => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return BlockType.AIR;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      return voxels[idx];
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
        const nCity = this.noise2D_city(wx * 0.008, wz * 0.008);

        // Check if this location is a procedural urban / settlement zone
        const isUrbanZone = nCity > 0.35 && baseHeight > this.WATER_LEVEL + 2;

        if (isUrbanZone) {
          // Flatten land for urban grid
          const streetGridX = Math.abs(wx) % 18;
          const streetGridZ = Math.abs(wz) % 18;
          const isRoad = (streetGridX < 3) || (streetGridZ < 3);
          const isSidewalk = (!isRoad) && (streetGridX === 3 || streetGridX === 17 || streetGridZ === 3 || streetGridZ === 17);

          const urbanGroundY = 22;

          // Fill ground up to urban plane
          for (let y = 0; y < urbanGroundY; y++) {
            setBlock(lx, y, lz, y < urbanGroundY - 3 ? BlockType.STONE : BlockType.DIRT);
          }

          if (isRoad) {
            // Road surface + occasional lane markings
            const isMarking = (streetGridX === 1 && (Math.abs(wz) % 6 < 3)) || (streetGridZ === 1 && (Math.abs(wx) % 6 < 3));
            setBlock(lx, urbanGroundY, lz, isMarking ? BlockType.ROAD_MARKING : BlockType.ROAD);
          } else if (isSidewalk) {
            setBlock(lx, urbanGroundY, lz, BlockType.SIDEWALK);
          } else {
            // Building lot inside block!
            // Deterministic building height based on block coordinate
            const blockCellX = Math.floor(wx / 18);
            const blockCellZ = Math.floor(wz / 18);
            const buildingHash = Math.sin(blockCellX * 374761393 + blockCellZ * 668265263) * 43758.5453;
            const bRand = Math.abs(buildingHash - Math.floor(buildingHash));

            // Building style and height
            const bHeight = Math.floor(10 + bRand * 45); // up to 55 voxels high!
            const bType = bRand > 0.6 ? BlockType.BUILDING_GLASS : (bRand > 0.3 ? BlockType.BUILDING_CONCRETE : BlockType.BUILDING_BRICK);

            const isBorder = (lx === 4 || lx === 16 || lz === 4 || lz === 16 || streetGridX === 4 || streetGridX === 16 || streetGridZ === 4 || streetGridZ === 16);

            for (let by = urbanGroundY; by < urbanGroundY + bHeight && by < CHUNK_SIZE_Y - 2; by++) {
              // Roof on top
              if (by === urbanGroundY + bHeight - 1) {
                setBlock(lx, by, lz, BlockType.BUILDING_ROOF);
                continue;
              }

              // Window rhythm
              const isFloorWindow = (by % 3 === 1);
              if (isBorder && isFloorWindow && ((wx + wz) % 2 === 0)) {
                // Lit vs dark windows (some glow warm yellow, some dark glass)
                const isLit = (Math.sin(wx * 11 + wz * 17 + by * 23) > 0.1);
                setBlock(lx, by, lz, isLit ? BlockType.WINDOW_LIT : BlockType.WINDOW_DARK);
              } else {
                setBlock(lx, by, lz, bType);
              }
            }
          }
        } else {
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
    }

    return voxels;
  }
}

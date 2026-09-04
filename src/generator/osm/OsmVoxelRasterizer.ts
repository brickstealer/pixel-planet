import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  VOXEL_SIZE,
  BlockType
} from '../../core/VoxelTypes.js';
import {
  OsmFeature,
  OsmBuilding,
  OsmRoad,
  OsmArea,
  OsmPoi,
  OsmTree,
  OsmPeak
} from './OsmTypes.js';
import { GeoCoords } from './GeoCoords.js';

export class OsmVoxelRasterizer {
  static rasterizeChunk(
    chunkX: number,
    chunkZ: number,
    voxels: Uint8Array,
    nearbyFeatures: OsmFeature[],
    isSectorActive: boolean,
    isDesert: boolean,
    groundY: number = 20
  ): boolean {
    const startX = chunkX * CHUNK_SIZE_X * VOXEL_SIZE;
    const endX = startX + CHUNK_SIZE_X * VOXEL_SIZE;
    const startZ = chunkZ * CHUNK_SIZE_Z * VOXEL_SIZE;
    const endZ = startZ + CHUNK_SIZE_Z * VOXEL_SIZE;

    if (!isSectorActive && nearbyFeatures.length === 0) return false;

    let hasFeatures = false;

    const setBlock = (x: number, y: number, z: number, type: BlockType, force: boolean = false) => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      // Protect sacred pyramid blocks (SAND and GOLD above ground) from being overwritten
      if (!force && y > groundY && (voxels[idx] === BlockType.SAND || voxels[idx] === BlockType.GOLD)) {
        return;
      }
      voxels[idx] = type;
    };

    const getBlock = (x: number, y: number, z: number): BlockType => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return BlockType.AIR;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      return (voxels[idx] as BlockType) || BlockType.AIR;
    };

    // 1. Fill ground base (with dynamic mountain peaks and volcanic relief)
    const groundBlock = isDesert ? BlockType.SAND : BlockType.SIDEWALK;
    const subGroundBlock = isDesert ? BlockType.SAND : BlockType.DIRT;

    const peaks = nearbyFeatures.filter(f => f.type === 'peak') as OsmPeak[];

    if (peaks.length > 0) {
      hasFeatures = true;
      const peak = peaks[0];

      // Elevation scaling: Everest (8848m) -> 135 voxels, Vesuvius (1281m) -> 85 voxels
      const maxMountainH = Math.min(135, Math.max(55, Math.round(peak.ele / 50)));

      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
          const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
          const dist = Math.hypot(worldVX - peak.x, worldVZ - peak.z);

          if (dist < peak.radius) {
            const ratio = dist / peak.radius; // 0 at summit -> 1 at base
            const baseSlope = Math.pow(1.0 - ratio, 1.8);

            const ridgeNoise = Math.sin(worldVX * 0.035 + worldVZ * 0.03) * 8 +
              Math.cos(worldVX * 0.07 - worldVZ * 0.065) * 4;

            let mountainH = Math.floor(groundY + (maxMountainH * baseSlope) + ridgeNoise);

            // Caldera crater formation for volcanoes
            if (peak.isVolcano) {
              const craterRadius = 45;
              if (dist < craterRadius) {
                const craterDrop = (1.0 - dist / craterRadius) * 22;
                mountainH = Math.max(groundY + 12, mountainH - craterDrop);
              }
            }

            mountainH = Math.max(groundY, Math.min(CHUNK_SIZE_Y - 4, mountainH));

            for (let y = 0; y <= mountainH; y++) {
              if (y === mountainH) {
                if (peak.ele > 3200 || y > groundY + maxMountainH * 0.55) {
                  setBlock(lx, y, lz, BlockType.SNOW);
                } else if (peak.isVolcano && dist < 50) {
                  setBlock(lx, y, lz, dist < 18 ? BlockType.WARNING_BLACK : BlockType.STONE);
                } else if (y < groundY + 8) {
                  setBlock(lx, y, lz, groundBlock);
                } else {
                  setBlock(lx, y, lz, BlockType.STONE);
                }
              } else if (y > mountainH - 3) {
                if (peak.ele > 3200 || y > groundY + maxMountainH * 0.55) {
                  setBlock(lx, y, lz, BlockType.SNOW);
                } else {
                  setBlock(lx, y, lz, BlockType.STONE);
                }
              } else {
                setBlock(lx, y, lz, BlockType.STONE);
              }
            }
          } else {
            // Outside mountain radius: flat ground base
            for (let y = 0; y <= groundY; y++) {
              setBlock(lx, y, lz, y === groundY ? groundBlock : (y > groundY - 3 ? subGroundBlock : BlockType.STONE));
            }
          }
        }
      }
    } else {
      // Normal flat base ground
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
          for (let y = 0; y <= groundY; y++) {
            setBlock(lx, y, lz, y === groundY ? groundBlock : (y > groundY - 3 ? subGroundBlock : BlockType.STONE));
          }
        }
      }
    }

    // 2. Rasterize Roads, Parks, Parking & Water
    for (const feat of nearbyFeatures) {
      if (feat.type === 'road') {
        const road = feat as OsmRoad;
        for (let i = 0; i < road.points.length - 1; i++) {
          const p1 = road.points[i];
          const p2 = road.points[i + 1];

          const minPX = Math.min(p1[0], p2[0]) - road.width;
          const maxPX = Math.max(p1[0], p2[0]) + road.width;
          const minPZ = Math.min(p1[1], p2[1]) - road.width;
          const maxPZ = Math.max(p1[1], p2[1]) + road.width;

          if (maxPX < startX || minPX > endX || maxPZ < startZ || minPZ > endZ) continue;

          hasFeatures = true;
          const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          const steps = Math.max(1, Math.ceil(dist / 2));

          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const rx = p1[0] + (p2[0] - p1[0]) * t;
            const rz = p1[1] + (p2[1] - p1[1]) * t;

            const lcx = Math.floor((rx - startX) / VOXEL_SIZE);
            const lcz = Math.floor((rz - startZ) / VOXEL_SIZE);
            const radiusVoxels = Math.ceil(road.width / (2 * VOXEL_SIZE));

            for (let ox = -radiusVoxels; ox <= radiusVoxels; ox++) {
              for (let oz = -radiusVoxels; oz <= radiusVoxels; oz++) {
                const vx = lcx + ox;
                const vz = lcz + oz;
                if (vx >= 0 && vx < CHUNK_SIZE_X && vz >= 0 && vz < CHUNK_SIZE_Z) {
                  setBlock(vx, groundY, vz, BlockType.ROAD);
                }
              }
            }
          }
        }
      } else if (feat.type === 'park' || feat.type === 'forest') {
        const area = feat as OsmArea;
        const isForest = (area.type === 'forest');
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (GeoCoords.pointInPolygon(worldVX, worldVZ, area.points)) {
              hasFeatures = true;
              setBlock(lx, groundY, lz, BlockType.GRASS);

              if (isForest) {
                const spacing = 8;
                const cellX = Math.floor(worldVX / spacing);
                const cellZ = Math.floor(worldVZ / spacing);
                const hash = Math.sin(cellX * 12.9898 + cellZ * 78.233) * 43758.5453;
                const rand = Math.abs(hash - Math.floor(hash));

                if (rand > 0.4 && (Math.abs(Math.floor(worldVX)) % spacing === 0) && (Math.abs(Math.floor(worldVZ)) % spacing === 0)) {
                  const trunkH = 3 + Math.floor(rand * 3);
                  for (let ty = groundY + 1; ty <= groundY + trunkH; ty++) {
                    setBlock(lx, ty, lz, BlockType.TREE_TRUNK);
                  }
                  const cY = groundY + trunkH;
                  for (let dy = -1; dy <= 2; dy++) {
                    const r = (dy === -1 || dy === 2) ? 1 : 2;
                    for (let ox = -r; ox <= r; ox++) {
                      for (let oz = -r; oz <= r; oz++) {
                        if (r === 2 && Math.abs(ox) === 2 && Math.abs(oz) === 2) continue;
                        if (getBlock(lx + ox, cY + dy, lz + oz) === BlockType.AIR) {
                          setBlock(lx + ox, cY + dy, lz + oz, BlockType.TREE_LEAVES);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else if (feat.type === 'parking') {
        const area = feat as OsmArea;
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (GeoCoords.pointInPolygon(worldVX, worldVZ, area.points)) {
              hasFeatures = true;
              setBlock(lx, groundY, lz, BlockType.ROAD);
            }
          }
        }
      } else if (feat.type === 'water') {
        const water = feat as any;
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (GeoCoords.pointInPolygon(worldVX, worldVZ, water.points)) {
              hasFeatures = true;
              for (let wy = groundY - 3; wy <= groundY; wy++) {
                setBlock(lx, wy, lz, BlockType.WATER);
              }
            }
          }
        }
      }
    }

    // 3. Rasterize Real Buildings
    for (const feat of nearbyFeatures) {
      if (feat.type !== 'building') continue;
      const b = feat as OsmBuilding;

      const [minBX, minBZ, maxBX, maxBZ] = b.bounds;
      if (maxBX < startX || minBX > endX || maxBZ < startZ || minBZ > endZ) continue;

      hasFeatures = true;
      const bHeightVoxels = Math.min(CHUNK_SIZE_Y - groundY - 2, Math.max(3, Math.floor(b.height / VOXEL_SIZE)));
      const bCenterX = (minBX + maxBX) / 2;
      const bCenterZ = (minBZ + maxBZ) / 2;
      const isSmall = (maxBX - minBX < 6 || maxBZ - minBZ < 6);

      // 3.1 Pyramids
      if (b.isPyramid) {
        const halfWidth = (maxBX - minBX) / 2;
        const halfDepth = (maxBZ - minBZ) / 2;

        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          if (worldVX < minBX - VOXEL_SIZE || worldVX > maxBX + VOXEL_SIZE) continue;

          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (worldVZ < minBZ - VOXEL_SIZE || worldVZ > maxBZ + VOXEL_SIZE) continue;

            const dx = Math.abs(worldVX - bCenterX);
            const dz = Math.abs(worldVZ - bCenterZ);

            for (let by = groundY; by <= groundY + bHeightVoxels; by++) {
              const t = (by - groundY) / bHeightVoxels;
              const curLimitX = Math.max(1.0, halfWidth * (1.0 - t));
              const curLimitZ = Math.max(1.0, halfDepth * (1.0 - t));

              if (dx <= curLimitX && dz <= curLimitZ) {
                const isApex = (by >= groundY + bHeightVoxels - 2);
                setBlock(lx, by, lz, isApex ? BlockType.GOLD : BlockType.SAND, true);
              }
            }
          }
        }
        continue;
      }

      // 3.2 Cathedrals & Russian Orthodox Domes
      if (b.isCathedral) {
        const halfWidth = (maxBX - minBX) / 2;
        const halfDepth = (maxBZ - minBZ) / 2;
        const domeHeight = Math.min(12, Math.max(5, Math.floor(bHeightVoxels * 0.35)));
        const wallHeight = bHeightVoxels - domeHeight;

        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          if (worldVX < minBX - VOXEL_SIZE || worldVX > maxBX + VOXEL_SIZE) continue;

          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (worldVZ < minBZ - VOXEL_SIZE || worldVZ > maxBZ + VOXEL_SIZE) continue;

            const isInside = GeoCoords.pointInPolygon(worldVX, worldVZ, b.points) ||
              (isSmall && Math.abs(worldVX - bCenterX) <= VOXEL_SIZE && Math.abs(worldVZ - bCenterZ) <= VOXEL_SIZE);

            if (isInside) {
              const isPerimeter = isSmall ? true : GeoCoords.isPerimeterVoxel(worldVX, worldVZ, b.points, VOXEL_SIZE);
              const dxRatio = Math.abs(worldVX - bCenterX) / (halfWidth || 1);
              const dzRatio = Math.abs(worldVZ - bCenterZ) / (halfDepth || 1);
              const distFromCenter = Math.hypot(dxRatio, dzRatio);

              for (let by = groundY; by <= groundY + bHeightVoxels; by++) {
                if (by <= groundY + wallHeight) {
                  if (isPerimeter) {
                    const isBelt = (by === groundY + wallHeight || by === groundY + Math.floor(wallHeight / 2));
                    const isArch = ((by - groundY) % 6 >= 2 && (by - groundY) % 6 <= 4 && (lx + lz) % 4 === 0);
                    if (isBelt) {
                      setBlock(lx, by, lz, BlockType.BUILDING_CONCRETE);
                    } else if (isArch) {
                      setBlock(lx, by, lz, BlockType.WINDOW_LIT);
                    } else {
                      setBlock(lx, by, lz, b.blockType);
                    }
                  } else {
                    setBlock(lx, by, lz, b.blockType);
                  }
                } else {
                  const domeY = by - (groundY + wallHeight);
                  const domeT = domeY / domeHeight;
                  const bulbRadius = Math.sin(domeT * Math.PI) * 0.4 + (1.0 - domeT) * 0.75;

                  if (distFromCenter <= bulbRadius) {
                    if (domeY >= domeHeight - 2) {
                      setBlock(lx, by, lz, BlockType.GOLD);
                    } else {
                      const angle = Math.atan2(worldVZ - bCenterZ, worldVX - bCenterX);
                      const stripe = Math.sin(angle * 4 + domeY * 1.5);
                      if (b.isSaintBasils) {
                        if (stripe > 0.25) setBlock(lx, by, lz, BlockType.GOLD);
                        else if (stripe < -0.25) setBlock(lx, by, lz, BlockType.TREE_LEAVES);
                        else setBlock(lx, by, lz, BlockType.BUILDING_BRICK);
                      } else {
                        setBlock(lx, by, lz, BlockType.GOLD);
                      }
                    }
                  }
                }
              }
            }
          }
        }
        continue;
      }

      // 3.3 Eiffel Tower
      if (b.isEiffelTower) {
        const halfWidth = (maxBX - minBX) / 2 || 35;
        const halfDepth = (maxBZ - minBZ) / 2 || 35;
        const towerH = Math.min(CHUNK_SIZE_Y - groundY - 2, Math.max(80, Math.floor(b.height / VOXEL_SIZE)));

        const hP1 = Math.floor(towerH * 0.18);
        const hP2 = Math.floor(towerH * 0.36);
        const hP3 = Math.floor(towerH * 0.84);

        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          if (worldVX < minBX - VOXEL_SIZE || worldVX > maxBX + VOXEL_SIZE) continue;

          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (worldVZ < minBZ - VOXEL_SIZE || worldVZ > maxBZ + VOXEL_SIZE) continue;

            const dx = Math.abs(worldVX - bCenterX);
            const dz = Math.abs(worldVZ - bCenterZ);

            for (let by = groundY; by <= groundY + towerH; by++) {
              const dy = by - groundY;

              if (dy <= hP2) {
                const tLeg = dy / hP2;
                const legCenterDistX = halfWidth * (0.85 - tLeg * 0.52);
                const legCenterDistZ = halfDepth * (0.85 - tLeg * 0.52);
                const legThickness = Math.max(3.0, 7.0 - tLeg * 3.5);

                const dLegX = Math.abs(dx - legCenterDistX);
                const dLegZ = Math.abs(dz - legCenterDistZ);
                const inCornerPillar = (dLegX <= legThickness && dLegZ <= legThickness);

                const isArch1 = (dy >= hP1 - 4 && dy <= hP1 && (dx <= legCenterDistX + legThickness && dz <= legCenterDistZ + legThickness) && (dx >= legCenterDistX - legThickness || dz >= legCenterDistZ - legThickness));
                const isPlatform1 = (dy === hP1 && dx <= legCenterDistX + 3 && dz <= legCenterDistZ + 3 && (dx >= legCenterDistX - 6 || dz >= legCenterDistZ - 6));
                const isPlatform2 = (dy === hP2 && dx <= legCenterDistX + 3 && dz <= legCenterDistZ + 3);

                if (inCornerPillar || isArch1 || isPlatform1 || isPlatform2) {
                  const isCrossBrace = (Math.abs(Math.floor((worldVX + worldVZ + dy * 1.5) / 3)) % 2 === 0);
                  if (isPlatform1 || isPlatform2) {
                    setBlock(lx, by, lz, BlockType.MONUMENT_BRONZE);
                  } else if (isCrossBrace || (dy % 4 === 0)) {
                    setBlock(lx, by, lz, BlockType.METAL);
                  } else {
                    setBlock(lx, by, lz, BlockType.STONE);
                  }
                }
              } else if (dy <= hP3) {
                const tMid = (dy - hP2) / (hP3 - hP2);
                const curTowerW = Math.max(2.5, halfWidth * 0.33 * (1.0 - tMid * 0.7));
                const curTowerD = Math.max(2.5, halfDepth * 0.33 * (1.0 - tMid * 0.7));

                if (dx <= curTowerW && dz <= curTowerD) {
                  const isOuterWall = (dx >= curTowerW - 2.2 || dz >= curTowerD - 2.2);
                  const isCrossGirder = (dy % 3 === 0);
                  if (isOuterWall || isCrossGirder) {
                    setBlock(lx, by, lz, BlockType.METAL);
                  }
                }
              } else {
                const isPlatform3 = (dy === hP3 && dx <= 5 && dz <= 5);
                const isSpire = (dx <= 1.5 && dz <= 1.5);
                const isBeaconTip = (dy >= towerH - 3 && dx <= 1.0 && dz <= 1.0);

                if (isPlatform3) {
                  setBlock(lx, by, lz, BlockType.MONUMENT_BRONZE);
                } else if (isBeaconTip) {
                  setBlock(lx, by, lz, BlockType.WARNING_YELLOW);
                } else if (isSpire) {
                  setBlock(lx, by, lz, BlockType.METAL);
                }
              }
            }
          }
        }
        continue;
      }

      // 3.4 TV & Communication Towers
      if (b.isTower && !b.isEiffelTower) {
        const halfWidth = (maxBX - minBX) / 2 || 12;
        const halfDepth = (maxBZ - minBZ) / 2 || 12;
        const baseRadius = Math.max(6.0, Math.min(halfWidth, halfDepth) || 10);
        const towerH = bHeightVoxels;

        const hBase = Math.floor(towerH * 0.12);
        const hPodStart = Math.floor(towerH * 0.62);
        const hPodEnd = Math.floor(towerH * 0.72);
        const hSpire = towerH;

        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          if (worldVX < minBX - VOXEL_SIZE || worldVX > maxBX + VOXEL_SIZE) continue;

          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (worldVZ < minBZ - VOXEL_SIZE || worldVZ > maxBZ + VOXEL_SIZE) continue;

            const distFromCenter = Math.hypot(worldVX - bCenterX, worldVZ - bCenterZ);

            for (let by = groundY; by <= groundY + towerH; by++) {
              const dy = by - groundY;

              if (dy <= hBase) {
                const tBase = dy / (hBase || 1);
                const curR = baseRadius * (1.0 - tBase * 0.58);
                if (distFromCenter <= curR) {
                  const isArchHole = (dy < hBase * 0.45 && (Math.abs(worldVX - bCenterX) < 2.0 || Math.abs(worldVZ - bCenterZ) < 2.0));
                  if (!isArchHole) {
                    setBlock(lx, by, lz, BlockType.BUILDING_CONCRETE);
                  }
                }
              } else if (dy <= hPodStart) {
                const shaftR = Math.max(2.5, baseRadius * 0.38);
                if (distFromCenter <= shaftR) {
                  setBlock(lx, by, lz, BlockType.BUILDING_CONCRETE);
                }
              } else if (dy <= hPodEnd) {
                const shaftR = Math.max(2.5, baseRadius * 0.38);
                const podT = (dy - hPodStart) / (hPodEnd - hPodStart || 1);
                const podExpansion = Math.sin(podT * Math.PI) * 4.5;
                const curPodR = shaftR + podExpansion;

                if (distFromCenter <= curPodR) {
                  const isWindowRow = (dy >= hPodStart + 2 && dy <= hPodEnd - 2);
                  const isOuter = (distFromCenter >= curPodR - 1.8);
                  if (isWindowRow && isOuter) {
                    setBlock(lx, by, lz, BlockType.WINDOW_LIT);
                  } else if (dy === hPodStart || dy === hPodEnd) {
                    setBlock(lx, by, lz, BlockType.METAL);
                  } else {
                    setBlock(lx, by, lz, BlockType.BUILDING_CONCRETE);
                  }
                }
              } else {
                const spireT = (dy - hPodEnd) / (hSpire - hPodEnd || 1);
                const curSpireR = Math.max(1.0, 2.2 * (1.0 - spireT * 0.5));

                if (distFromCenter <= curSpireR) {
                  if (dy >= towerH - 3) {
                    setBlock(lx, by, lz, BlockType.WARNING_YELLOW);
                  } else {
                    const isRedBand = (Math.floor(dy / 5) % 2 === 0);
                    setBlock(lx, by, lz, isRedBand ? BlockType.BUILDING_BRICK : BlockType.BUILDING_CONCRETE);
                  }
                }
              }
            }
          }
        }
        continue;
      }

      // 3.5 Standard buildings
      // Double defense: Skip any standard building if inside or overlapping a pyramid's sanctuary (+35m buffer)
      let insidePyramid = false;
      const pad = 35;
      for (const feat of nearbyFeatures) {
        if (feat.type === 'building' && (feat as OsmBuilding).isPyramid) {
          const [pMinX, pMinZ, pMaxX, pMaxZ] = feat.bounds;
          if (minBX <= pMaxX + pad && maxBX >= pMinX - pad && minBZ <= pMaxZ + pad && maxBZ >= pMinZ - pad) {
            insidePyramid = true;
            break;
          }
        }
      }
      if (insidePyramid) {
        continue;
      }

      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
        if (worldVX < minBX - VOXEL_SIZE || worldVX > maxBX + VOXEL_SIZE) continue;

        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
          const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
          if (worldVZ < minBZ - VOXEL_SIZE || worldVZ > maxBZ + VOXEL_SIZE) continue;

          const isInside = GeoCoords.pointInPolygon(worldVX, worldVZ, b.points) ||
            (isSmall && Math.abs(worldVX - bCenterX) <= VOXEL_SIZE && Math.abs(worldVZ - bCenterZ) <= VOXEL_SIZE);

          if (isInside) {
            const isPerimeter = isSmall ? true : GeoCoords.isPerimeterVoxel(worldVX, worldVZ, b.points, VOXEL_SIZE);

            for (let by = groundY; by <= groundY + bHeightVoxels; by++) {
              if (by === groundY + bHeightVoxels) {
                setBlock(lx, by, lz, BlockType.BUILDING_ROOF);
              } else if (isPerimeter) {
                const isIndustrial = b.isIndustrial || b.isChimney;
                const isWindowHeight = ((by - groundY) % 2 === 1);
                const isWindowCol = ((lx + lz) % 2 === 0);

                if (!isIndustrial && !isDesert && isWindowHeight && isWindowCol && (by > groundY + 1)) {
                  const isLit = (Math.sin(worldVX * 7.1 + worldVZ * 11.3 + by * 13.7) > 0.0);
                  setBlock(lx, by, lz, isLit ? BlockType.WINDOW_LIT : BlockType.WINDOW_DARK);
                } else if (!isIndustrial && isDesert && isWindowHeight && isWindowCol && (by > groundY + 1)) {
                  // Desert dwellings have dark recessed windows, no skyscraper lit windows
                  setBlock(lx, by, lz, BlockType.WINDOW_DARK);
                } else {
                  setBlock(lx, by, lz, b.blockType);
                }
              } else {
                setBlock(lx, by, lz, b.blockType);
              }
            }
          }
        }
      }
    }

    // 4. Rasterize Standalone POIs (Monuments, Statues, Fountains, Food Kiosks, Metro)
    for (const feat of nearbyFeatures) {
      if (feat.type !== 'poi') continue;
      const poi = feat as OsmPoi;

      const lx = Math.floor((poi.x - startX) / VOXEL_SIZE);
      const lz = Math.floor((poi.z - startZ) / VOXEL_SIZE);

      if (lx < -1 || lx > CHUNK_SIZE_X || lz < -1 || lz > CHUNK_SIZE_Z) continue;

      hasFeatures = true;
      const cat = (poi.category || '').toLowerCase();
      const name = (poi.name || '').toLowerCase();

      // Monument / Statue (exclude wall plaques)
      const isPlaque = cat.includes('plaque') || name.includes('доска');
      if (!isPlaque && (cat.includes('monument') || cat.includes('memorial') || cat.includes('statue') || cat.includes('artwork') || name.includes('памятник') || name.includes('монумент') || name.includes('обелиск'))) {
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            setBlock(lx + ox, groundY + 1, lz + oz, BlockType.STONE);
          }
        }
        setBlock(lx, groundY + 2, lz, BlockType.BUILDING_CONCRETE);
        for (let y = groundY + 3; y <= groundY + 5; y++) {
          setBlock(lx, y, lz, BlockType.MONUMENT_BRONZE);
        }
        setBlock(lx - 1, groundY + 4, lz, BlockType.MONUMENT_BRONZE);
        setBlock(lx + 1, groundY + 4, lz, BlockType.MONUMENT_BRONZE);
        setBlock(lx, groundY + 6, lz, BlockType.GOLD);

      } else if (cat.includes('fountain')) {
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const isEdge = (Math.abs(ox) === 1 || Math.abs(oz) === 1);
            setBlock(lx + ox, groundY + 1, lz + oz, isEdge ? BlockType.STONE : BlockType.WATER);
          }
        }
        setBlock(lx, groundY + 2, lz, BlockType.WATER);

      } else if (cat.includes('kiosk') || cat.includes('fast_food')) {
        for (let ox = 0; ox <= 1; ox++) {
          for (let oz = 0; oz <= 1; oz++) {
            setBlock(lx + ox, groundY + 1, lz + oz, BlockType.BUILDING_BRICK);
            setBlock(lx + ox, groundY + 2, lz + oz, BlockType.WINDOW_LIT);
            setBlock(lx + ox, groundY + 3, lz + oz, BlockType.BUILDING_ROOF);
          }
        }
      } else if (cat.includes('subway') || name.includes('метро') || poi.isSubway) {
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const isRim = (Math.abs(ox) === 1 || oz === -1);
            if (isRim) {
              setBlock(lx + ox, groundY + 1, lz + oz, BlockType.METAL);
            } else {
              setBlock(lx + ox, groundY, lz + oz, BlockType.AIR);
              setBlock(lx + ox, groundY - 1, lz + oz, BlockType.STONE);
            }
            setBlock(lx + ox, groundY + 3, lz + oz, BlockType.BUILDING_GLASS);
          }
        }
        setBlock(lx, groundY + 2, lz + 1, BlockType.WINDOW_LIT);
      }
    }

    // 5. Trees
    for (const feat of nearbyFeatures) {
      if (feat.type !== 'tree') continue;
      const tree = feat as OsmTree;

      const lx = Math.floor((tree.x - startX) / VOXEL_SIZE);
      const lz = Math.floor((tree.z - startZ) / VOXEL_SIZE);

      if (lx < -1 || lx > CHUNK_SIZE_X || lz < -1 || lz > CHUNK_SIZE_Z) continue;

      const currentGround = getBlock(lx, groundY, lz);
      if (currentGround === BlockType.ROAD || currentGround === BlockType.WATER) continue;

      hasFeatures = true;
      const trunkHeight = Math.max(2, Math.min(6, Math.floor(tree.height / VOXEL_SIZE)));
      const canopyY = groundY + trunkHeight;

      for (let ty = groundY + 1; ty <= canopyY; ty++) {
        setBlock(lx, ty, lz, BlockType.TREE_TRUNK);
      }

      const isConifer = (tree.leafType === 'needleleaved');

      if (isConifer) {
        for (let dy = 0; dy <= 3; dy++) {
          const r = (dy === 0) ? 2 : (dy === 1 ? 1 : 0);
          for (let ox = -r; ox <= r; ox++) {
            for (let oz = -r; oz <= r; oz++) {
              if (r === 2 && Math.abs(ox) === 2 && Math.abs(oz) === 2) continue;
              if (getBlock(lx + ox, canopyY + dy, lz + oz) === BlockType.AIR) {
                setBlock(lx + ox, canopyY + dy, lz + oz, BlockType.TREE_LEAVES);
              }
            }
          }
        }
      } else {
        for (let dy = -1; dy <= 2; dy++) {
          const r = (dy === -1 || dy === 2) ? 1 : 2;
          for (let ox = -r; ox <= r; ox++) {
            for (let oz = -r; oz <= r; oz++) {
              if (r === 2 && Math.abs(ox) === 2 && Math.abs(oz) === 2 && dy !== 0) continue;
              if (getBlock(lx + ox, canopyY + dy, lz + oz) === BlockType.AIR) {
                setBlock(lx + ox, canopyY + dy, lz + oz, BlockType.TREE_LEAVES);
              }
            }
          }
        }
      }
    }

    return isSectorActive || hasFeatures;
  }
}

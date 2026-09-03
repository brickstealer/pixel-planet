import * as THREE from 'three';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  VOXEL_SIZE,
  BlockType
} from './VoxelTypes.js';
import { VoxelMesher } from './VoxelMesher.js';

export class ChunkManager {
  constructor(scene, terrainGen, osmProvider, material) {
    this.scene = scene;
    this.terrainGen = terrainGen;
    this.osmProvider = osmProvider;
    this.material = material;

    this.renderDistance = 10; // Chunks radius (default 10, configurable up to 100)
    this.activeChunks = new Map(); // key -> { cx, cz, mesh, voxels, usedOsm }
    this.buildQueue = []; // Chunks queued to be built
    this.lastPlayerChunk = { cx: null, cz: null };

    this.maxChunksPerFrame = 6; // Base chunks built per frame
    this.totalVoxelsRendered = 0;
  }

  /**
   * Clears all active chunks and queues (e.g. when teleporting)
   */
  clearAll() {
    for (const [key, chunk] of this.activeChunks.entries()) {
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
    }
    this.activeChunks.clear();
    this.buildQueue = [];
    this.lastPlayerChunk = { cx: null, cz: null };
  }

  /**
   * Updates streaming chunks based on player camera position
   */
  update(cameraPosition, cameraDirection) {
    const playerCX = Math.floor(cameraPosition.x / (CHUNK_SIZE_X * VOXEL_SIZE));
    const playerCZ = Math.floor(cameraPosition.z / (CHUNK_SIZE_Z * VOXEL_SIZE));

    // If moved to a new chunk or just started
    if (playerCX !== this.lastPlayerChunk.cx || playerCZ !== this.lastPlayerChunk.cz) {
      this.lastPlayerChunk = { cx: playerCX, cz: playerCZ };
      this.updateActiveChunks(playerCX, playerCZ, cameraDirection);
    }

    // Check and stream new geographic sectors along the flight path
    if (this.osmProvider) {
      this.osmProvider.checkStreaming(cameraPosition.x, cameraPosition.z, this.renderDistance);
    }

    // Process queued chunk builds
    this.processQueue();
  }

  updateActiveChunks(playerCX, playerCZ, cameraDirection) {
    const R = this.renderDistance;
    const requiredKeys = new Set();
    const newChunks = [];

    // Direction vector for front-bias prioritizing chunks in flight path
    const dirX = cameraDirection ? cameraDirection.x : 0;
    const dirZ = cameraDirection ? cameraDirection.z : 0;

    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > (R + 0.5) * (R + 0.5)) continue;

        const cx = playerCX + dx;
        const cz = playerCZ + dz;
        const key = `${cx},${cz}`;
        requiredKeys.add(key);

        if (!this.activeChunks.has(key)) {
          // Dot product with look direction to prioritize chunks in front of player
          const dot = (dx * dirX + dz * dirZ);
          // Score: smaller = build sooner
          const priority = distSq - dot * 3;
          newChunks.push({ cx, cz, key, priority });
        }
      }
    }

    // Sort new chunks: chunks directly ahead and closest build first!
    newChunks.sort((a, b) => a.priority - b.priority);

    // Filter queue to remove stale chunks
    this.buildQueue = this.buildQueue.filter(item => requiredKeys.has(item.key));

    // Append new chunks if not already queued
    const queuedKeys = new Set(this.buildQueue.map(item => item.key));
    for (const chunk of newChunks) {
      if (!queuedKeys.has(chunk.key)) {
        this.buildQueue.push(chunk);
      }
    }

    // Always sort entire build queue so chunks in front of player build first
    this.buildQueue.sort((a, b) => a.priority - b.priority);

    // Unload chunks outside render distance + buffer
    const unloadDistSq = (R + 2) * (R + 2);
    for (const [key, chunk] of this.activeChunks.entries()) {
      const dx = chunk.cx - playerCX;
      const dz = chunk.cz - playerCZ;
      if (dx * dx + dz * dz > unloadDistSq) {
        if (chunk.mesh) {
          this.scene.remove(chunk.mesh);
          chunk.mesh.geometry.dispose();
        }
        this.activeChunks.delete(key);
      }
    }
  }

  processQueue() {
    let buildsThisFrame = 0;
    // Adaptive build budget: scale up if queue is large for high render distances
    const batchLimit = Math.min(24, Math.max(this.maxChunksPerFrame, Math.floor(this.buildQueue.length / 25)));

    while (this.buildQueue.length > 0 && buildsThisFrame < batchLimit) {
      const task = this.buildQueue.shift();
      if (this.activeChunks.has(task.key)) continue;

      try {
        this.generateAndBuildChunk(task.cx, task.cz, task.key);
      } catch (err) {
        console.error(`Error generating chunk ${task.key}:`, err);
      }
      buildsThisFrame++;
    }
  }

  generateAndBuildChunk(cx, cz, key) {
    const voxels = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);

    // Try populating with real OSM structures anywhere on Earth!
    let usedOsm = false;
    if (this.osmProvider) {
      usedOsm = this.osmProvider.populateChunk(cx, cz, voxels);
    }

    // If no OSM buildings exist yet, check if this chunk is in an unloaded pending sector
    if (!usedOsm) {
      const startX = cx * CHUNK_SIZE_X * VOXEL_SIZE;
      const startZ = cz * CHUNK_SIZE_Z * VOXEL_SIZE;
      const midX = startX + (CHUNK_SIZE_X * VOXEL_SIZE) / 2;
      const midZ = startZ + (CHUNK_SIZE_Z * VOXEL_SIZE) / 2;

      const isLoadedSector = this.osmProvider ? this.osmProvider.isPointInLoadedSector(midX, midZ) : false;

      if (!isLoadedSector) {
        // PENDING / UNLOADED OSM SECTOR: Yellow & Black Hazard Warning Stripes!
        const groundY = 20;
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;

            // Solid bedrock/dirt base underneath
            for (let y = 0; y < groundY; y++) {
              const idx = (y * CHUNK_SIZE_Z + lz) * CHUNK_SIZE_X + lx;
              voxels[idx] = y > groundY - 3 ? BlockType.DIRT : BlockType.STONE;
            }

            // Diagonal Hazard Warning Stripes (45 degrees, width = 4 meters / 2 voxels)
            const stripeIndex = Math.floor((worldVX + worldVZ) / 4.0);
            const isYellow = Math.abs(stripeIndex) % 2 === 0;

            const topIdx = (groundY * CHUNK_SIZE_Z + lz) * CHUNK_SIZE_X + lx;
            voxels[topIdx] = isYellow ? BlockType.WARNING_YELLOW : BlockType.WARNING_BLACK;
          }
        }
      } else {
        // Loaded sector with naturally no buildings (e.g. countryside, ocean): procedural terrain
        const procVoxels = this.terrainGen.generateChunk(cx, cz);
        voxels.set(procVoxels);
      }
    }

    // Build optimized 3D geometry
    const geometry = VoxelMesher.buildMesh(voxels);

    let mesh = null;
    if (geometry) {
      mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(
        cx * CHUNK_SIZE_X * VOXEL_SIZE,
        0,
        cz * CHUNK_SIZE_Z * VOXEL_SIZE
      );
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    this.activeChunks.set(key, {
      cx,
      cz,
      voxels,
      mesh,
      usedOsm
    });
  }

  /**
   * Rebuilds chunks when newly streamed OSM data arrives
   */
  refreshNonOsmChunks() {
    for (const [key, chunk] of this.activeChunks.entries()) {
      if (!chunk.usedOsm) {
        const testVoxels = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);
        try {
          if (this.osmProvider.populateChunk(chunk.cx, chunk.cz, testVoxels)) {
            // Real OSM data has arrived for this chunk! Rebuild mesh
            if (chunk.mesh) {
              this.scene.remove(chunk.mesh);
              chunk.mesh.geometry.dispose();
            }
            const newGeo = VoxelMesher.buildMesh(testVoxels);
            if (newGeo) {
              const mesh = new THREE.Mesh(newGeo, this.material);
              mesh.position.set(
                chunk.cx * CHUNK_SIZE_X * VOXEL_SIZE,
                0,
                chunk.cz * CHUNK_SIZE_Z * VOXEL_SIZE
              );
              mesh.matrixAutoUpdate = false;
              mesh.updateMatrix();
              this.scene.add(mesh);
              chunk.mesh = mesh;
            }
            chunk.voxels = testVoxels;
            chunk.usedOsm = true;
          }
        } catch (err) {
          console.error(`Error refreshing chunk ${key}:`, err);
        }
      }
    }
  }

  getChunkCount() {
    return this.activeChunks.size;
  }
}

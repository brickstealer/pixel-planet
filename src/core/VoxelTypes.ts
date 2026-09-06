export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_SIZE_Y = 180; // Up to 360 meters tall for real skyscrapers and Eiffel Tower
export const VOXEL_SIZE = 2.0; // 1 voxel = 2.0 meters

export enum BlockType {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  WATER = 4,
  SAND = 5,
  ROAD = 6,
  SIDEWALK = 7,
  BUILDING_BRICK = 8,
  BUILDING_CONCRETE = 9,
  BUILDING_GLASS = 10,
  BUILDING_ROOF = 11,
  WINDOW_LIT = 12,
  WINDOW_DARK = 13,
  TREE_TRUNK = 14,
  TREE_LEAVES = 15,
  SNOW = 16,
  METAL = 17,
  ROAD_MARKING = 18,
  MONUMENT_BRONZE = 19,
  GOLD = 20,
  WARNING_YELLOW = 21,
  WARNING_BLACK = 22,
  RAIL_GRAVEL = 23,
  RAIL_SLEEPER = 24,
  RAIL_STEEL = 25
}

// RGB Colors in [0..1] range for vertex colors
export const BlockPalette: Record<BlockType, [number, number, number]> = {
  [BlockType.AIR]: [0, 0, 0],
  [BlockType.GRASS]: [0.28, 0.58, 0.22],
  [BlockType.DIRT]: [0.45, 0.32, 0.18],
  [BlockType.STONE]: [0.52, 0.54, 0.56],
  [BlockType.WATER]: [0.18, 0.44, 0.72],
  [BlockType.SAND]: [0.86, 0.78, 0.55],
  [BlockType.ROAD]: [0.22, 0.23, 0.25],
  [BlockType.ROAD_MARKING]: [0.92, 0.88, 0.45],
  [BlockType.SIDEWALK]: [0.65, 0.67, 0.68],
  [BlockType.BUILDING_BRICK]: [0.72, 0.38, 0.28],
  [BlockType.BUILDING_CONCRETE]: [0.78, 0.79, 0.82],
  [BlockType.BUILDING_GLASS]: [0.35, 0.65, 0.85],
  [BlockType.BUILDING_ROOF]: [0.32, 0.33, 0.36],
  [BlockType.WINDOW_LIT]: [1.0, 0.88, 0.45], // Glowing amber/warm light
  [BlockType.WINDOW_DARK]: [0.15, 0.22, 0.28],
  [BlockType.TREE_TRUNK]: [0.42, 0.26, 0.15],
  [BlockType.TREE_LEAVES]: [0.18, 0.52, 0.16],
  [BlockType.SNOW]: [0.95, 0.96, 0.98],
  [BlockType.METAL]: [0.45, 0.48, 0.52],
  [BlockType.MONUMENT_BRONZE]: [0.62, 0.46, 0.28],
  [BlockType.GOLD]: [0.95, 0.78, 0.24],
  [BlockType.WARNING_YELLOW]: [0.98, 0.80, 0.08], // Bright industrial warning yellow
  [BlockType.WARNING_BLACK]: [0.10, 0.10, 0.12],  // Industrial hazard black
  [BlockType.RAIL_GRAVEL]: [0.48, 0.49, 0.52],    // Crushed stone railway ballast
  [BlockType.RAIL_SLEEPER]: [0.26, 0.18, 0.12],   // Dark wooden/concrete crossties (шпалы)
  [BlockType.RAIL_STEEL]: [0.84, 0.86, 0.90]      // Polished steel rail tracks (рельсы)
};

// Return whether block is transparent/non-solid to neighbor face culling
export function isBlockTransparent(type: BlockType): boolean {
  return type === BlockType.AIR || type === BlockType.WATER;
}

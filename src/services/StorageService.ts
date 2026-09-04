import { CityConfig } from '../generator/osm/OsmTypes.js';
import { TimeOfDayMode } from '../rendering/AtmosphereManager.js';

export interface SavedPlayerState {
  city: CityConfig;
  pos: { x: number; y: number; z: number };
  rot: { yaw: number; pitch: number };
  time: TimeOfDayMode;
  renderDist: number;
}

const STORAGE_KEY = 'pixel_planet_saved_state';

export class StorageService {
  static saveState(state: SavedPlayerState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors
    }
  }

  static loadState(): SavedPlayerState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.city && parsed.pos) {
        return parsed as SavedPlayerState;
      }
    } catch (err) {
      console.warn('Failed to restore saved player state:', err);
    }
    return null;
  }
}

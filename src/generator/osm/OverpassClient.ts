import { OsmCache } from '../../utils/OsmCache.js';

export interface SectorFetchResult {
  success: boolean;
  fromCache: boolean;
  data?: any;
}

export class OverpassClient {
  private cache: OsmCache;
  private overpassMirrors = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];

  constructor(cache: OsmCache) {
    this.cache = cache;
  }

  private promoteMirror(successfulMirror: string): void {
    const idx = this.overpassMirrors.indexOf(successfulMirror);
    if (idx > 0) {
      this.overpassMirrors.splice(idx, 1);
      this.overpassMirrors.unshift(successfulMirror);
    }
  }

  buildQuery(south: number, west: number, north: number, east: number): string {
    return `
      [out:json][timeout:15];
      (
        way["building"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["building"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["building:part"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["building:part"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["highway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["waterway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["natural"="water"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["natural"="water"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["amenity"="fountain"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["amenity"="fountain"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["leisure"="park"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["leisure"="park"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["landuse"="grass"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["amenity"="parking"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["amenity"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["shop"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["tourism"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["historic"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["natural"="tree"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["natural"="tree_row"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["natural"="wood"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["natural"="wood"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["landuse"="forest"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["landuse"="forest"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["railway"="subway_entrance"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["station"="subway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["station"="subway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["railway"="station"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["railway"="rail"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["railway"="tram"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["railway"="light_rail"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["railway"="subway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["railway"="narrow_gauge"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["natural"="peak"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["natural"="volcano"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
      );
      out geom;
    `.trim();
  }

  async fetchSector(south: number, west: number, north: number, east: number): Promise<SectorFetchResult> {
    const cacheKey = `osm_v10_${south.toFixed(4)}_${west.toFixed(4)}_${north.toFixed(4)}_${east.toFixed(4)}`;

    // 1. Check local IndexedDB disk cache
    const cachedData = await this.cache.get(cacheKey);
    if (cachedData && cachedData.elements && cachedData.elements.length > 0) {
      return { success: true, fromCache: true, data: cachedData };
    }

    // 2. Query network mirrors in priority order (with 7.5s timeout per mirror)
    const query = this.buildQuery(south, west, north, east);
    let emptyResultData: any = null;

    for (const mirror of this.overpassMirrors) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7500);
      const startTime = Date.now();

      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'data=' + encodeURIComponent(query),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.elements)) {
            const count = data.elements.length;
            await this.cache.set(cacheKey, data);
            this.promoteMirror(mirror);
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            if (count > 0) {
              console.log(`[Overpass] Sector loaded via ${new URL(mirror).hostname} (${count} features, ${duration}s)`);
            }
            return { success: true, fromCache: false, data };
          } else {
            console.warn(`[Overpass] Mirror ${new URL(mirror).hostname} returned invalid JSON structure, trying next...`);
          }
        } else {
          console.warn(`[Overpass] Mirror ${new URL(mirror).hostname} responded with HTTP ${res.status}, trying next...`);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        console.warn(`[Overpass] Mirror ${new URL(mirror).hostname} error (${err?.name || 'Error'}), trying next...`);
      }
    }

    if (emptyResultData) {
      return { success: true, fromCache: false, data: emptyResultData };
    }

    return { success: false, fromCache: false };
  }
}

export class GeoCoords {
  /**
   * Converts WGS84 (lat, lon) to local world metric coordinates (x, z) relative to anchor
   */
  static latLonToWorld(lat: number, lon: number, anchorLat: number, anchorLon: number): [number, number] {
    const mx = (lon - anchorLon) * (111320 * Math.cos(anchorLat * Math.PI / 180));
    const mz = -(lat - anchorLat) * 110540;
    return [mx, mz];
  }

  /**
   * Converts local world metric coordinates (x, z) to WGS84 (lat, lon) relative to anchor
   */
  static worldToLatLon(worldX: number, worldZ: number, anchorLat: number, anchorLon: number): [number, number] {
    const latOffset = -worldZ / 110540;
    const lonOffset = worldX / (111320 * Math.cos(anchorLat * Math.PI / 180));
    return [anchorLat + latOffset, anchorLon + lonOffset];
  }

  /**
   * Identifies Middle Eastern / North African desert regions for appropriate palette/materials
   */
  static isDesertRegion(anchorLat: number, anchorLon: number): boolean {
    const lat = anchorLat;
    const lon = anchorLon;
    const isDubai = (lat > 24 && lat < 26 && lon > 54 && lon < 56);
    const isEgypt = (lat > 22 && lat < 32 && lon > 25 && lon < 35);
    const isSahara = (lat > 15 && lat < 33 && lon > -15 && lon < 40);
    const isArabia = (lat > 12 && lat < 32 && lon > 35 && lon < 60);
    return isDubai || isEgypt || isSahara || isArabia;
  }

  /**
   * Fast 2D Ray-Casting Point-in-Polygon test
   */
  static pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1];
      const xj = poly[j][0], zj = poly[j][1];
      const intersect = ((zi > z) !== (zj > z)) &&
        (x < (xj - xi) * (z - zi) / (zj - zi + 0.0000001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Tests if a voxel is on the boundary/perimeter of a polygon
   */
  static isPerimeterVoxel(x: number, z: number, poly: [number, number][], margin: number): boolean {
    const offsets = [[margin, 0], [-margin, 0], [0, margin], [0, -margin]];
    for (const [ox, oz] of offsets) {
      if (!this.pointInPolygon(x + ox, z + oz, poly)) return true;
    }
    return false;
  }
}

import { NominatimResult } from './OsmTypes.js';

export class NominatimService {
  /**
   * Search city or landmark using Nominatim Geocoding with detailed address breakdown
   */
  static async searchLocation(query: string): Promise<NominatimResult[] | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&addressdetails=1&accept-language=ru,en`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'ru,en' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || data.length === 0) {
        return null;
      }

      return data.map((item: any) => {
        const addr = item.address || {};
        const title = addr.road || addr.suburb || item.name || item.display_name.split(',')[0].trim();
        const cityName = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
        const region = addr.state || '';
        const country = addr.country || '';

        const subtitleParts = [cityName, region, country].filter(p => p && p !== title);
        const subtitle = subtitleParts.join(', ') || item.display_name;

        return {
          title: title,
          subtitle: subtitle,
          fullName: item.display_name,
          city: cityName || region || country,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon)
        };
      });
    } catch (err) {
      console.warn('Nominatim error:', err);
      return null;
    }
  }
}

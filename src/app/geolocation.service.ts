import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';

export interface GeoBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

@Injectable({ providedIn: 'root' })
export class GeolocationService {

  async getUserCoords(): Promise<{ lat: number; lng: number } | null> {
    try {
      const perm = await Geolocation.requestPermissions();
      if (perm.location !== 'granted') return null;

      const pos = await Geolocation.getCurrentPosition();
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
    } catch {
      return null;
    }
  }

  isInsideBounds(coords: { lat: number; lng: number }, bounds: GeoBounds): boolean {
    return (
      coords.lat >= bounds.south &&
      coords.lat <= bounds.north &&
      coords.lng >= bounds.west &&
      coords.lng <= bounds.east
    );
  }
}

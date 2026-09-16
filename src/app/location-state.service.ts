import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class LocationStateService {
  private LOCATION_ID_KEY = 'selectedLocationId';

  // Flower Power Maspeth is a single-location app (matches
  // SettingsService.MASPETH_LOCATION_ID in maspeth-shop) — always seed with
  // the Maspeth location id rather than trusting a stale cached value from
  // a previous multi-location build.
  private locationId$ = new BehaviorSubject<string | null>(
    localStorage.getItem(this.LOCATION_ID_KEY) || environment.locationId
  );

  setLocationId(id: string) {
    localStorage.setItem(this.LOCATION_ID_KEY, id);
    this.locationId$.next(id);
  }

  getLocationId(): string | null {
    return this.locationId$.value;
  }

  locationChanges(): Observable<string | null> {
    return this.locationId$.asObservable();
  }
}

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LocationStateService {
  private LOCATION_ID_KEY = 'selectedLocationId';

  private locationId$ = new BehaviorSubject<string | null>(
    localStorage.getItem(this.LOCATION_ID_KEY)
  );

  setLocationId(id: string) {
    console.log(id)
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

import {
  trigger,
  transition,
  style,
  animate,
  state,
} from '@angular/animations';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { AccessibilityService } from '../accessibility.service';
import { SettingsService } from '../settings.service';
import { ProductsService } from '../products.service';

import {
  hoursLabelToday,
  isOpenToday,
  getTodayKeyTZ,
  anyRangeNow,
  rangesLabel,
  storeHoursToHoursMap,
} from '../utils/time-utils';
import { AuthService } from '../auth.service';

type ServiceType = 'pickup' | 'delivery';

export interface DailyHours {
  open: string;
  close: string;
}

export type HoursMap = Record<number, DailyHours>;

export interface LocationItem {
  location_id: string;
  name: string;
  address?: string;

  // ✅ ADD THIS
  deliveryAvailable?: boolean;

  logo?: string;
  services?: ServiceType[];
  storeHours?: HoursMap;
  deliveryHours?: HoursMap;
  happyHour?: Record<number, DailyHours[]>;
  timezone?: string;
  distanceKm?: number | null;
  etaMinutes?: number | null;
  bannerImage?: string;
}


@Component({
  selector: 'app-splash-screen',
  templateUrl: './splash-screen.component.html',
  styleUrls: ['./splash-screen.component.scss'],
  animations: [
    trigger('logoAnimation', [
      state('initial', style({ transform: 'translateY(-100%)', opacity: 0 })),
      state('final', style({ transform: 'translateY(0)', opacity: 1 })),
      transition('initial => final', animate('0.6s ease-out')),
    ]),
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('0.5s ease-in', style({ opacity: 1 })),
      ]),
    ]),
    trigger('fadeOut', [
      transition(':leave', [
        style({ transform: 'scale(1)', opacity: 1 }),
        animate('0.5s ease-in', style({ transform: 'scale(0.8)', opacity: 0 })),
      ]),
    ]),
  ],
})
export class SplashScreenComponent implements OnInit {
  @Output() closeSplash = new EventEmitter<void>();

  logoState: 'initial' | 'final' = 'initial';
  showAgeVerification = false;
  selectedAgeConfirmed = false;
  logoSrc = 'assets/logo.png';

  locations: LocationItem[] = [];

  constructor(
    private accessibilityService: AccessibilityService,
    private settingsService: SettingsService,
    private productsService: ProductsService,
    private authService: AuthService
  ) {}

  async ngOnInit() {
    this.setLogoForTheme();
    this.runIntroSequence();
    await this.loadLocations();
  }

  private setLogoForTheme() {
    const isDark = document.body.classList.contains('dark-mode');
    this.logoSrc = isDark ? 'assets/logo-dark-mode.png' : 'assets/logo.png';
  }

  private runIntroSequence() {
    setTimeout(() => {
      this.logoState = 'final';
      this.accessibilityService.announce('Welcome to the app.', 'polite');
    }, 200);

    setTimeout(() => {
      this.showAgeVerification = true;
      this.accessibilityService.announce(
        'Please confirm if you are 21 years old or older.',
        'assertive'
      );
    }, 1000);
  }

  /* ---------------- Age Gate ---------------- */

  onYesClick() {
    this.selectedAgeConfirmed = true;
    this.showAgeVerification = false;

    this.accessibilityService.announce(
      'Entering location selection.',
      'polite'
    );
  }

  onNoClick() {
    this.accessibilityService.announce(
      'Access denied. You must be over 21 to enter.',
      'assertive'
    );
    alert('Sorry, you must be over 21 to enter.');
  }

  /* ---------------- Locations ---------------- */

  async loadLocations() {
    try {
      const locations = await this.settingsService.fetchLocations();

      console.log(locations)

      this.locations = locations.map((l: any) => ({
        ...l,

        // ✅ CONVERT BACKEND HOURS → UI HOURS
        storeHours: storeHoursToHoursMap(l.storeHours),

        timezone: l.timezone ?? 'America/New_York',
        bannerImage: this.bannerFor(l.name),
      }));


      console.log(this.locations)
    } catch (err) {
      console.error('Failed to load locations', err);
    }
  }

  selectLocation(loc: LocationItem) {
    this.settingsService.selectLocation(loc.location_id, loc.name);

    this.productsService.fetchProducts(loc.location_id).subscribe({
      error: (err) => console.error('Error fetching products:', err),
    });

    this.authService.validateSession();

    this.accessibilityService.announce('Entering the app.', 'polite');
    setTimeout(() => this.closeSplash.emit(), 100);
  }

  /* ---------------- Display Helpers ---------------- */

  todayPickupHours(loc: LocationItem) {
    return hoursLabelToday(loc.storeHours, loc.timezone);
  }

  isOpenPickup(loc: LocationItem) {
    return isOpenToday(loc.storeHours, loc.timezone);
  }

  /* ---------------- Assets ---------------- */

  private bannerFor(name: string): string {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')[0];

    return `assets/${slug}.jpg`;
  }
}

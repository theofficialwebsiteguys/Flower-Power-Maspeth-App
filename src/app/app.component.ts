import {
  trigger,
  transition,
  style,
  animate,
} from '@angular/animations';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { App } from '@capacitor/app';

import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('0.5s ease-in', style({ opacity: 1 })),
      ]),
    ]),
    trigger('fadeOut', [
      transition(':leave', [
        style({ opacity: 1 }),
        animate('0.5s ease-out', style({ opacity: 0 })),
      ]),
    ]),
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  showSplashScreen: boolean = true;

  isLoggedIn: boolean = false;

  private readonly subscriptions = new Subscription();

  constructor(
    private authService: AuthService,
    private settingsService: SettingsService,
    private router: Router
  ) {
    // Listen for app URL open events
    App.addListener('appUrlOpen', (data: any) => {
      const url = new URL(data.url);
      const mode = url.searchParams.get('mode');
      const token = url.searchParams.get('token');

      if (mode === 'reset-password' && token) {
        this.router.navigate(['/auth'], {
          queryParams: { mode, token },
        });
      }
    });
  }

  ngOnInit() {
    this.initializeApp();
  }

  initializeApp() {
    this.authService.validateSession();
    this.settingsService.updateTheme();

    this.subscriptions.add(
      this.authService.isLoggedIn().subscribe((status) => {
        this.isLoggedIn = status;
      })
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  onCloseSplash() {
    setTimeout(() => {
      this.showSplashScreen = false;

      // Move focus to the main content area
      setTimeout(() => {
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
          mainContent.setAttribute('tabindex', '-1'); // Make it focusable
          mainContent.focus(); // Move focus
        }
      }, 0); // Allow time for DOM update
    }, 100); // Matches the fade-out animation duration
  }
}

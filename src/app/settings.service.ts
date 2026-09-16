import { Inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { BehaviorSubject, from, map, Observable } from 'rxjs';

import { AuthService } from './auth.service';
import { environment } from 'src/environments/environment';
import { HttpClient } from '@angular/common/http';
import { CapacitorHttp } from '@capacitor/core';
import { LocationStateService } from './location-state.service';

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  DARK_MODE_ENABLED = 'darkModeEnabled';

  // Flower Power Maspeth is a single-location app — matches
  // SettingsService.MASPETH_LOCATION_ID ('364') in maspeth-shop. There is no
  // multi-location picker; every session is scoped to this location.
  static readonly MASPETH_LOCATION_ID = environment.locationId;

  isLoggedIn: boolean = false;

  private selectedLocationIdSubject = new BehaviorSubject<string>(
    SettingsService.MASPETH_LOCATION_ID
  );
  selectedLocationId$ = this.selectedLocationIdSubject.asObservable();

  constructor(
    @Inject(DOCUMENT) private document: Document,
    private authService: AuthService,
    private http: HttpClient,
    private locationState: LocationStateService
  ) {
    this.locationState.setLocationId(SettingsService.MASPETH_LOCATION_ID);

    this.authService.isLoggedIn().subscribe((isLoggedIn) => {
      this.isLoggedIn = isLoggedIn;
      this.isDarkModeEnabled.next(this.getDarkModeEnabled());
      this.updateTheme();
    });
  }

  getSelectedLocationId(): string {
    return this.selectedLocationIdSubject.value;
  }

  // Guests get the shared db_api_key (same pattern maspeth-shop uses for
  // unauthenticated storefront requests); logged-in users get their session
  // token. Guest checkout must not throw here.
  private getHeaders(): { [key: string]: string } {
    const sessionData = localStorage.getItem('sessionData');
    const token = sessionData ? JSON.parse(sessionData).token : null;

    const headers: { [key: string]: string } = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = token;
    } else {
      headers['x-auth-api-key'] = environment.db_api_key;
    }

    return headers;
  }

  getDarkModeEnabled = (): boolean =>
    localStorage.getItem(this.DARK_MODE_ENABLED) === 'true' && this.isLoggedIn;

  setDarkModeEnabled = (value: boolean): void => {
    localStorage.setItem(this.DARK_MODE_ENABLED, JSON.stringify(value));
    this.isDarkModeEnabled.next(value);
    this.updateTheme();
  };

  updateTheme(): void {
    this.getDarkModeEnabled()
      ? this.document.body.classList.add('dark-mode')
      : this.document.body.classList.remove('dark-mode');
  }

  async getUserNotifications(): Promise<any> {
    try {
      const userId = this.authService.getCurrentUser().id;
      const url = `${environment.apiUrl}/notifications/all?userId=${userId}`;

      const response = await CapacitorHttp.get({
        url,
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching user notifications:', JSON.stringify(error));
      return null;
    }
  }

  async markNotificationAsRead(notificationId: number): Promise<any> {
    try {
      const url = `${environment.apiUrl}/notifications/mark-read/${notificationId}`;

      const response = await CapacitorHttp.put({
        url,
        headers: this.getHeaders(),
        data: {},
      });

      return response.data;
    } catch (error) {
      console.error('Error marking notification as read:', JSON.stringify(error));
      return null;
    }
  }

  async markAllNotificationsAsRead(userId: number): Promise<any> {
    try {
      const url = `${environment.apiUrl}/notifications/mark-all-read`;

      const response = await CapacitorHttp.put({
        url,
        headers: this.getHeaders(),
        data: { userId },
      });

      return response.data;
    } catch (error) {
      console.error('Error marking all notifications as read:', JSON.stringify(error));
      return null;
    }
  }

  async deleteNotification(notificationId: number): Promise<any> {
    try {
      const url = `${environment.apiUrl}/notifications/delete/${notificationId}`;

      const response = await CapacitorHttp.delete({
        url,
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Error deleting notification:', JSON.stringify(error));
      return null;
    }
  }

  async deleteAllNotifications(userId: number): Promise<any> {
    try {
      const url = `${environment.apiUrl}/notifications/delete-all`;

      const response = await CapacitorHttp.delete({
        url,
        headers: this.getHeaders(),
        data: { userId },
      });

      return response.data;
    } catch (error) {
      console.error('Error deleting all notifications:', JSON.stringify(error));
      return null;
    }
  }

  private isDarkModeEnabled = new BehaviorSubject<boolean>(
    this.getDarkModeEnabled()
  );
  isDarkModeEnabled$ = this.isDarkModeEnabled.asObservable();

  // Matches maspeth-shop's SettingsService.getCarouselImages() — the old
  // /notifications/images endpoint is not what the current backend serves banners from.
  getCarouselImages(): Observable<{ images: string[] }> {
    const url = `${environment.apiUrl}/banner/images`;

    const options = {
      method: 'GET',
      url,
      headers: { 'x-auth-api-key': environment.db_api_key }
    };

    return from(CapacitorHttp.request(options)).pipe(
      map((response: any) => response.data)
    );
  }

  async sendMessage(name: string, email: string, message: string) {
    const emailData = {
      subject: `New Message from ${name}`,
      message: `Name: ${name}\nEmail: ${email}\nMessage: ${message}`
    };

    const options = {
      url: `${environment.apiUrl}/businesses/send-email`,
      method: 'POST',
      headers: {
        'x-auth-api-key': environment.db_api_key,
        'Content-Type': 'application/json'
      },
      data: emailData
    };

    try {
      const response = await CapacitorHttp.request(options);
      return response;
    } catch (error) {
      console.error('Error sending email', error);
      throw error;
    }
  }

}

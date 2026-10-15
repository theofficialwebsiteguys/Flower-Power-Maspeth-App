import { Component, ElementRef, Input, OnChanges, OnInit, SimpleChanges, ViewChild } from '@angular/core';

import { AuthService } from '../auth.service';
import { SettingsService } from '../settings.service';
import { AccessibilityService } from '../accessibility.service';
import { AlertController } from '@ionic/angular';
import { CartService, LoyaltyConfig } from '../cart.service';

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss'],
})
export class AccountComponent implements OnInit, OnChanges {
  @Input() user: any;
  allowNotifications = false;
  darkModeEnabled = false;
  userInfo: any = [];
  settings: any = [];

  @ViewChild('liveRegion') liveRegion!: ElementRef;
  
  private loyalty: LoyaltyConfig | null = null;

  constructor(private authService: AuthService, private settingsService: SettingsService, private accessibilityService: AccessibilityService, private alertController: AlertController, private cartService: CartService) {
    this.cartService.getLoyaltyConfig().then(config => {
      this.loyalty = config;
      if (this.user) this.buildUserInfo();
    });
  }

  // The user object is replaced whenever the balance refreshes, so rebuild the rows each time.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['user'] && this.user) this.buildUserInfo();
  }

  private buildUserInfo(): void {
    const points = Number(this.user.points) || 0;
    let pointsLabel = `${points}`;
    if (this.loyalty && this.loyalty.redeemValue > 0) {
      // What the balance can actually take off, in the whole sets checkout allows.
      const usable = Math.floor(points / this.loyalty.redeemStep) * this.loyalty.redeemStep;
      if (usable > 0) {
        pointsLabel += ` (up to ${(usable * this.loyalty.redeemValue).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} off)`;
      }
    }
    this.userInfo = [
      { icon: 'person-outline', label: 'Name', value: `${this.user.fname} ${this.user.lname}` },
      { icon: 'mail-outline', label: 'Email', value: this.user.email },
      { icon: 'call-outline', label: 'Phone', value: this.user.phone },
      { icon: 'trophy-outline', label: 'Points', value: pointsLabel }
    ];
  }

  ngOnInit(): void {
    if (this.user) {
      this.buildUserInfo();
      this.darkModeEnabled = this.settingsService.getDarkModeEnabled();
      this.settings = [
        { id: 'darkMode', label: 'Dark Mode', value: this.darkModeEnabled, action: (val: boolean) => this.toggleDarkMode(val) }
      ];
    }
  }

  toggleDarkMode(value: boolean): void {
    this.darkModeEnabled = value;
    this.settingsService.setDarkModeEnabled(value);
    this.accessibilityService.announce(`Dark mode has been ${value ? 'enabled' : 'disabled'}`);
  }

  async logout(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to log out?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => {
            this.accessibilityService.announce('Log out canceled');
          },
        },
        {
          text: 'Log Out',
          role: 'destructive',
          handler: () => {
            this.authService.logout();
            this.accessibilityService.announce('You have been logged out');
          },
        },
      ],
    });

    await alert.present();
  }
}

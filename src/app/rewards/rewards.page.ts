import { Component, OnInit, ViewChild } from '@angular/core';
import { AuthService } from '../auth.service';
import { AlertController, IonContent } from '@ionic/angular';

@Component({
  selector: 'app-rewards',
  templateUrl: './rewards.page.html',
  styleUrls: ['./rewards.page.scss'],
})
export class RewardsPage implements OnInit {
  @ViewChild(IonContent, { static: false }) content!: IonContent;

  user: any;

  isLoggedIn: boolean = false;

  showAdvanced = false;
  constructor(private authService: AuthService,   private alertController: AlertController,) {}

  ngOnInit() {
    this.authService.isLoggedIn().subscribe((status) => {
      this.isLoggedIn = status;
      this.authService.getUserInfo().subscribe((userInfo: any) => {
        this.user = userInfo;
      });
    });
  }

  async presentDeleteModal() {
    const alert = await this.alertController.create({
      header: 'Confirm Deletion',
      message: 'Are you sure you want to permanently delete your account? This action cannot be undone.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'cancel-button'
        },
        {
          text: 'Delete',
          role: 'destructive',
          cssClass: 'delete-button',
          handler: () => this.onDeleteAccount()
        }
      ],
      cssClass: 'delete-account-alert'
    });
  
    await alert.present();
  }
  

  ionViewWillEnter(): void {
    // Pick up points earned or spent since the user was last loaded.
    if (this.isLoggedIn) this.authService.updateUserData();
  }

  ionViewDidEnter(): void {
    this.scrollToTop(); // Scroll to top when the page is fully loaded
  }

  scrollToTop() {
    if (this.content) {
      this.content.scrollToTop(300); // Smooth scrolling with animation
    } else {
      console.warn('IonContent is not available.');
    }
  }

  onDeleteAccount() {
    const userId = this.authService.getCurrentUser()?.id;
  
    if (userId) {
        this.authService.deleteAccount(userId).subscribe({
          next: () => {
            alert('Account deleted successfully.');
          },
          error: (err) => {
            alert('Something went wrong. Please try again.');
          }
        });
    }
  }

}

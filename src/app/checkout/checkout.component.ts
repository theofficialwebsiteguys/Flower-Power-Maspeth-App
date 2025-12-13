import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CartService } from '../cart.service';
import { LoadingController, ToastController } from '@ionic/angular';
import { AccessibilityService } from '../accessibility.service';
import { AuthService } from '../auth.service';
import { AeropayService } from '../aeropay.service';
import { openWidget } from 'aerosync-web-sdk';
import { SettingsService } from '../settings.service';
import { FcmService } from '../fcm.service';
import { LocationStateService } from '../location-state.service';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.component.html',
  styleUrls: ['./checkout.component.scss'],
})
export class CheckoutComponent implements OnInit {
  @Input() checkoutInfo: any;

  deliveryAddress = {
    street: '',
    apt: '',
    city: '',
    zip: '',
    state: 'NY' // Default to New York and cannot be changed
  };
  
  minDate: string = '';

 
  isDatePickerOpen = false;
  selectedDate: string | null = null;
  pointsToRedeem: number = 0;

  showTooltip = false;
  applyPoints: boolean = false;

  finalSubtotal: number = 0;
  originalSubtotal: number = 0;
  finalTotal: number = 0;
  finalTax: number = 0;

  pointValue: number = 0.05;

  selectedTime: string = '';

  isLoading: boolean = false;

  timeOptions: { value: string; display: string }[] = [];

  selectedPaymentMethod: string = 'cash';

  selectedOrderType: string = 'pickup';

  aeropayButtonInstance: any;

  enableDelivery: boolean = false;

  aeropayAuthToken: string | null = null;

  verificationRequired: boolean = false;
  verificationCode: string = '';
  existingUserId: string = '';

  aerosyncURL: string | null = null;
  aerosyncToken: string | null = null;
  aerosyncUsername: string | null = null;
  showAerosyncWidget: boolean = false;

  userBankAccounts: any[] = []; // Store user bank accounts
  showBankSelection: boolean = false; // Control UI visibility
  selectedBankId: string | null = null; // Track selected bank

  isFetchingAeroPay: boolean = false; 

  @Output() back: EventEmitter<void> = new EventEmitter<void>();
  @Output() orderPlaced = new EventEmitter<void>();
  bankLinked: boolean = false;
  aeropayUserId: any;

  loadingAerosync = false;
  selectedDeliveryDate: string | null = null;
  selectedDeliveryTime: string = '';

  deliveryHoursByDay: { [key: number]: { start: number; end: number } } = {
    0: { start: 11, end: 21 }, // Sunday
    1: { start: 8, end: 22 },  // Monday
    2: { start: 8, end: 22 },  // Tuesday
    3: { start: 8, end: 22 },  // Wednesday
    4: { start: 8, end: 22 },  // Thursday
    5: { start: 8, end: 23 },  // Friday
    6: { start: 10, end: 23 }, // Saturday
  };

  premiumDiscountRate: number = 0.10;
  premiumDiscountApplied: boolean = false;
  premiumDiscountAmount: number = 0;

  employeeDiscountApplied = false;
  employeeDiscountAmount = 0;
  employeeDiscountRate = 0.15; // fallback default
    
  deliverySchedule: { day: string; startTime: string; endTime: string }[] = [];
  validDeliveryDates: string[] = [];

  deliveryAddressValid: boolean = false;

  locationId: any;
  
  constructor(
    private cartService: CartService,
    private loadingController: LoadingController,
    private accessibilityService: AccessibilityService,
    private toastController: ToastController,
    private authService: AuthService,
    private aeropayService: AeropayService,
    private settingsService: SettingsService,
    private fcmService: FcmService,
    private locationStateService: LocationStateService
  ) {}

  async ngOnInit() {
    this.calculateDefaultTotals();
    this.checkDeliveryEligibility();
    this.locationId = this.locationStateService.getLocationId();
  
    try {
      const res: any = await this.settingsService.getDeliveryZone();
  
      if (res.schedule) {
        this.deliverySchedule = res.schedule;
  
        const availableDates = this.getAvailableDeliveryDates(res.schedule);
        this.validDeliveryDates = availableDates;
  
        if (availableDates.length === 0) {
          this.presentToast('No available delivery days found.', 'danger');
          return;
        }
  
        // Set first available date
        this.selectedDeliveryDate = availableDates[0];
  
        const selectedDate = new Date(this.selectedDeliveryDate);
        const dayOfWeek = selectedDate.getDay(); // 0 = Sunday
        this.generateTimeOptionsFromSchedule(dayOfWeek);
        this.selectNearestFutureTime(selectedDate, dayOfWeek);
      }
    } catch (err) {
      console.error('Failed to load delivery zone', err);
      this.presentToast('Unable to load delivery schedule.', 'danger');
    }
  
    // Set min selectable date
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    this.minDate = tomorrow.toISOString().split('T')[0];
  }
  

  isDateValid = (dateIsoString: string) => {
    return this.validDeliveryDates.includes(dateIsoString.split('T')[0]);
  };  

  selectNearestFutureTime(current: Date, dayOfWeek: number) {
    const currentMinutes = current.getHours() * 60 + current.getMinutes() + 30; // add 30-minute buffer
    const hours = this.deliveryHoursByDay[dayOfWeek];
  
    for (let hour = hours.start; hour <= hours.end; hour++) {
      for (let minute of [0, 30]) {
        const timeMinutes = hour * 60 + minute;
        if (timeMinutes >= currentMinutes) {
          const formattedHour = hour < 10 ? `0${hour}` : `${hour}`;
          const formattedMinute = minute === 0 ? '00' : '30';
          this.selectedDeliveryTime = `${formattedHour}:${formattedMinute}`;
          return;
        }
      }
    }
  
    // If no valid slot today, go to next day
    const nextDay = (dayOfWeek + 1) % 7;
    const tomorrow = new Date(current.getTime() + 86400000); // +1 day
    this.selectedDeliveryDate = tomorrow.toISOString().split('T')[0];
    this.generateTimeOptionsForDay(nextDay);
  
    const nextDayHours = this.deliveryHoursByDay[nextDay];
    const fallbackHour = nextDayHours.start;
    this.selectedDeliveryTime = `${fallbackHour < 10 ? '0' + fallbackHour : fallbackHour}:00`;
  }
  

  get maxRedeemablePoints(): number {
    const maxPoints = Math.min(this.checkoutInfo.user_info.points, this.originalSubtotal * 20);
    return Math.ceil(maxPoints);
  }
  
  
  
  checkDeliveryEligibility() {
    this.settingsService.checkDeliveryEligibility().subscribe({
      next: (response) => {
        this.enableDelivery = response.deliveryAvailable;
        console.log('Delivery availability:', this.enableDelivery);
      },
      error: (error) => {
        console.error('Error fetching delivery eligibility:', error);
        this.enableDelivery = false; // Fallback if the request fails
      }
    });
  }

  async startAeroPayProcess() {
    this.isFetchingAeroPay = true;
  
      this.aeropayService.fetchMerchantToken().subscribe({
        next: (response: any) => {
          // **Check for API errors inside the response**
          if (response.data.success === false || !response.data.token) {
            console.error('AeroPay Authentication Failed:', response.error);
            this.presentToast(`Authentication Error: ${response.error.message}`, 'danger');
            this.isFetchingAeroPay = false;
            return; // **Exit function to prevent further execution**
          }
  
          this.createAeroPayUser();
        },
        error: (error: any) => {
          console.error('AeroPay Authentication Request Failed:', error);
          this.presentToast('Authentication request failed. Please try again.', 'danger');
          this.isFetchingAeroPay = false;
        }
      });
  }
  

  async createAeroPayUser() {  
    const userData = {
      first_name: this.checkoutInfo.user_info.fname,
      last_name: this.checkoutInfo.user_info.lname,
      phone_number: this.checkoutInfo.user_info.phone,
      email: this.checkoutInfo.user_info.email
    };
  
    this.aeropayService.createUser(userData).subscribe({
      next: (response: any) => {
        this.isFetchingAeroPay = false;

        if (response.data.displayMessage) {
          this.verificationRequired = true;
          this.existingUserId = response.data.existingUser.userId; // Store userId for verification
          this.presentToast(response.data.displayMessage, 'warning');
        } else  {
          if (response.data.success && response.data.user) {
            this.userBankAccounts = response.data.user.bankAccounts || []; // Store bank accounts
            this.aeropayUserId = response.data.user.userId;
    
            if (this.userBankAccounts.length > 0) {
              console.log('User has linked bank accounts:', this.userBankAccounts);
              this.showBankSelection = true; // Show bank selection UI
              this.selectedBankId = this.userBankAccounts[0].bankAccountId;
            } else {
              console.log('No linked bank accounts. Opening AeroSync widget...');
              this.retrieveAerosyncCredentials();
            }
          }

        }
      },
      error: (error: any) => {
        console.error('Error Creating AeroPay User:', error);
        this.presentToast('Error creating user. Please try again.', 'danger');
        this.isFetchingAeroPay = false;
      }
    });
  }

  async verifyAeroPayUser() {
    if (!this.verificationCode.trim()) {
      this.presentToast('Please enter the verification code.', 'danger');
      return;
    }
  
    this.aeropayService.verifyUser(this.existingUserId, this.verificationCode).subscribe({
      next: (response: any) => {
        this.verificationRequired = false; // Hide verification input
        this.presentToast('Verification successful!', 'success');
        this.createAeroPayUser();
      },
      error: (error: any) => {
        console.error('Verification Failed:', error);
        this.presentToast('Invalid verification code. Please try again.', 'danger');
      }
    });
  }

  async retrieveAerosyncCredentials() {
    this.loadingAerosync = true;
    this.aeropayService.fetchUsedForMerchantToken(this.aeropayUserId).subscribe({
      next: (response: any) => {

        // **Check for API errors inside the response**
        if (response.data.success === false || !response.data.token) {
          console.error('AeroPay Authentication Failed:', response.data.error);
          this.presentToast(`Authentication Error: ${response.data.error.message}`, 'danger');
          this.loadingAerosync = false;
          return; // **Exit function to prevent further execution**
        }

        this.aeropayService.getAerosyncCredentials().subscribe({
          next: (response: any) => {
            if (response.data.success) {
              this.aerosyncURL = response.data.fastlinkURL;
              this.aerosyncToken = response.data.token;
              this.aerosyncUsername = response.data.username;
    
              // Open the Aerosync Widget in an in-app browser
              this.openAerosyncWidget();
            } else {
              console.error('Failed to retrieve Aerosync widget.');
            }
            this.loadingAerosync = false;
          },
          error: (error: any) => {
            console.error('Error Retrieving Aerosync Widget:', error);
            this.loadingAerosync = false;
          }
        });
      },
      error: (error: any) => {
        console.error('AeroPay Authentication Request Failed:', error);
        this.presentToast('Authentication request failed. Please try again.', 'danger');
        this.loadingAerosync = false;
      }
    });
   
  }

  openAerosyncWidget() {
    if (!this.aerosyncToken) {
      console.error('Missing AeroSync Token');
      return;
    }

    let widgetRef = openWidget({
      id: "widget",
      iframeTitle: 'Connect',
      environment: 'production', // 'production' for live
      token: this.aerosyncToken,
      style: {
        width: '375px',
        height: '688px',
        bgColor: '#000000',
        opacity: 0.7
      },
      deeplink: "", // Leave empty if not needed
      consumerId: "", // Optional: Merchant customization

      onLoad: function () {
        console.log("AeroSync Widget Loaded");
      },
      onSuccess: (event: any) => {
        if (event.user_id && event.user_password) {
          this.linkBankToAeropay(event.user_id, event.user_password);
        } else {
          console.error("Missing user credentials in event:", event);
        }
      },
      onError: function (event) {
        console.error("AeroSync Error:", event);
      },
      onClose: function () {
        console.log("AeroSync Widget Closed");
      },
      onEvent: function (event: object, type: string): void {
        console.log(event, type)
      }
    });

    widgetRef.launch();
  }

  linkBankToAeropay(userId: string, userPassword: string) {  
    this.aeropayService.linkBankAccount(userId, userPassword).subscribe({
      next: (response: any) => {
        if (response.data.success) {
          this.presentToast('Bank account linked successfully!', 'success');
  
          this.createAeroPayUser();
        } else {
          console.error('Failed to link bank:', response.data);
          this.presentToast('Failed to link your bank. Please try again.', 'danger');
        }
      },
      error: (error: any) => {
        console.error('Error linking bank account:', error);
        this.presentToast('An error occurred while linking your bank.', 'danger');
      }
    });
  }
  
  
  selectBank(bankId: string) {
    this.selectedBankId = bankId;
  }

  generateTimeOptionsForDay(dayOfWeek: number) {
    this.timeOptions = [];
  
    const hours = this.deliveryHoursByDay[dayOfWeek];
    const startHour = hours.start;
    const endHour = hours.end;
  
    for (let hour = startHour; hour <= endHour; hour++) {
      for (let minute of [0, 30]) {
        // Don't exceed endHour if it's the last half-hour
        if (hour === endHour && minute === 30) break;
  
        const displayHour = hour % 12 === 0 ? 12 : hour % 12;
        const amPm = hour < 12 ? 'AM' : 'PM';
        const formattedHour = hour < 10 ? `0${hour}` : `${hour}`;
        const formattedMinute = minute === 0 ? '00' : '30';
  
        this.timeOptions.push({
          value: `${formattedHour}:${formattedMinute}`,
          display: `${displayHour}:${formattedMinute} ${amPm}`,
        });
      }
    }
  }
  
  
  calculateDefaultTotals() {
    this.finalSubtotal = this.checkoutInfo.cart.reduce(
      (total: number, item: any) => total + (item.price * item.quantity),
      0
    );
    this.finalTax = this.finalSubtotal * 0.13;
    this.finalTotal = this.finalSubtotal + this.finalTax;
    this.updateTotals();
  }

  updateTotals() {
    const pointsValue = this.pointsToRedeem * this.pointValue;
    this.originalSubtotal = this.checkoutInfo.cart.reduce(
      (total: number, item: any) => total + (item.price * item.quantity),
      0
    );
  
    // Reset premium discount
    this.premiumDiscountApplied = false;
    this.premiumDiscountAmount = 0;
    this.employeeDiscountApplied = false;
    this.employeeDiscountAmount = 0;
  
    let subtotalAfterPoints = this.originalSubtotal - pointsValue;
    if (subtotalAfterPoints < 0) subtotalAfterPoints = 0;
  
    // ✅ Apply 10% premium discount if eligible
    if (this.checkoutInfo.user_info.premium && this.originalSubtotal > 100) {
      this.premiumDiscountAmount = subtotalAfterPoints * this.premiumDiscountRate;
      this.premiumDiscountApplied = true;
      subtotalAfterPoints -= this.premiumDiscountAmount;
    }

    if (this.checkoutInfo.user_info.role === 'employee' || this.checkoutInfo.user_info.role === 'admin') {
      this.employeeDiscountAmount = subtotalAfterPoints * this.employeeDiscountRate;
      this.employeeDiscountApplied = true;
      subtotalAfterPoints -= this.employeeDiscountAmount;
    }
  
    this.finalTax = subtotalAfterPoints * 0.13;
    this.finalTotal = subtotalAfterPoints + this.finalTax;
  
    this.accessibilityService.announce(
      `Subtotal updated to ${subtotalAfterPoints.toFixed(2)} dollars.`,
      'polite'
    );
  }
  

  goBack() {
    this.back.emit();
    this.accessibilityService.announce(
      'Returned to the previous page.',
      'polite'
    );
  }

  toggleDatePicker() {
    this.isDatePickerOpen = !this.isDatePickerOpen;
    const message = this.isDatePickerOpen
      ? 'Date picker opened.'
      : 'Date picker closed.';
    this.accessibilityService.announce(message, 'polite');
  }

  toggleTooltip() {
    this.showTooltip = !this.showTooltip;
  }

  onDateSelected(event: any) {
    const isoString = event.detail.value; // "YYYY-MM-DDTHH:mm:ss.sssZ"
  
    if (!isoString) return; // Exit early if event has no value
  
    this.selectedDeliveryDate = isoString.split('T')[0]; // "YYYY-MM-DD"
  
    if (!this.selectedDeliveryDate) return;
  
    const [year, month, day] = this.selectedDeliveryDate.split('-');
    const date = new Date(this.selectedDeliveryDate);
    const dayOfWeek = date.getDay(); // Sunday = 0 ... Saturday = 6
  
    this.generateTimeOptionsForDay(dayOfWeek);
  
    this.accessibilityService.announce(
      `Selected date is ${month}-${day}-${year}.`,
      'polite'
    );
  }
  
  
  
  
  async placeOrder() {
    this.isLoading = true;
    const loading = await this.loadingController.create({
      spinner: 'crescent',
      message: 'Please wait while we process your order...',
      cssClass: 'custom-loading',
    });
    await loading.present();
  
    try {
      const user_id = this.checkoutInfo.user_info.id;
      const points_redeem = this.pointsToRedeem;
      let pos_order_id = 0;
      let points_add = 0;
  
      const deliveryAddress =
        this.selectedOrderType === 'delivery'
          ? {
              address1: this.deliveryAddress.street.trim(),
              address2: this.deliveryAddress.apt ? this.deliveryAddress.apt.trim() : null,
              city: this.deliveryAddress.city.trim(),
              state: this.deliveryAddress.state.trim(),
              zip: this.deliveryAddress.zip.trim(),
              delivery_date: this.selectedDeliveryDate,
              delivery_eta_start: this.selectedDeliveryTime
            }
          : null;

          if (this.selectedPaymentMethod === 'aeropay' && this.selectedBankId) {
            this.aeropayService.fetchUsedForMerchantToken(this.aeropayUserId).subscribe({
              next: async (response: any) => {
                const transactionResponse = await this.aeropayService.createTransaction(
                  this.finalTotal.toFixed(2), // Convert total to string
                  this.selectedBankId
                ).toPromise();
          
                if (!transactionResponse.data || !transactionResponse.data.success) {
                  console.error('AeroPay Transaction Failed:', transactionResponse.data);
                  this.presentToast('Payment failed. Please try again.', 'danger');
                  this.isLoading = false;
                  await loading.dismiss();
                  return;
                }
          
                this.presentToast('Payment successful!', 'success');
              },
              error: (error: any) => {
                console.log('Error:', error);
                this.presentToast('Error', 'danger');
              }
            });
           
          }
  
      const response = await this.cartService.checkout(points_redeem, this.selectedOrderType, deliveryAddress);
  
      pos_order_id = response.id_order;
      points_add = response.subtotal;

      await this.cartService.placeOrder(user_id, pos_order_id, points_redeem ? 0 : points_add, points_redeem, this.finalSubtotal, this.checkoutInfo.cart);
  
      this.orderPlaced.emit();

      const userOrders = await this.authService.getUserOrders(); // ✅ Ensure this is awaited
      
      this.accessibilityService.announce('Your order has been placed successfully.', 'polite');

      const orderTypeMessage =
      this.selectedOrderType === 'delivery'
        ? 'Your delivery order has been placed!'
        : 'Your pickup order has been placed!';

      await this.fcmService.sendPushNotification(
        this.checkoutInfo.user_info.id,
        'Order Confirmed',
        orderTypeMessage
      );

    } catch (error:any) {
      console.error('Error placing order:', error);
      await this.presentToast('Error placing order: ' + JSON.stringify(error.message));
      this.accessibilityService.announce('There was an error placing your order. Please try again.', 'polite');
    } finally {
      this.isLoading = false;
      console.log('Cleanup complete: Destroying subscription');
      await loading.dismiss();
    }
  }

  async presentToast(message: string, color: string = 'danger') {
    const toast = await this.toastController.create({
      message: message,
      duration: 7000,
      color: color,
      position: 'bottom',
    });
    await toast.present();
  }

  onOrderTypeChange(event: any) {
    this.selectedOrderType = event.detail.value;
    if(this.selectedOrderType === 'delivery'){
      this.selectedPaymentMethod = 'aeropay'
      this.startAeroPayProcess();
    }
  }

  onPaymentMethodChange(selectedMethod: string) {
    if (selectedMethod === 'aeropay') {
      this.startAeroPayProcess();
    }else{
      this.showBankSelection = false;
    }
  }
  

  async onAddressInputChange() {
    const { street, city, zip } = this.deliveryAddress;

    this.deliveryAddressValid = false;

    // Basic check to avoid premature calls
    if (street.trim() && city.trim() && zip.trim().length >= 5) {
      const fullAddress = `${street.trim()}, ${city.trim()}, NY ${zip.trim()}`;

      try {
        const result = await this.settingsService.checkAddressInZone(
          this.checkoutInfo.business_id,
          fullAddress
        );

        if (!result.inZone) {
          this.presentToast('This address is outside the delivery zone.', 'danger');
          this.deliveryAddressValid = false;
        } else {
          this.deliveryAddressValid = true;
          console.log('Address is within delivery zone.');
        }

      } catch (err) {
        console.error('Address check error:', err);
        this.presentToast('Failed to verify delivery address.', 'danger');
      }
    }
  }
  getAvailableDeliveryDates(schedule: any[]): string[] {
    const validDates: string[] = [];
    const today = new Date();
  
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(today.getDate() + i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  
      const match = schedule.find(d => d.day === dayName);
      if (match) {
        validDates.push(date.toISOString().split('T')[0]);
      }
    }
    return validDates;
  }
  
  generateTimeOptionsFromSchedule(dayOfWeek: number) {
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
    const scheduleForDay = this.deliverySchedule.find(d => d.day === dayName);
  
    if (!scheduleForDay) {
      this.timeOptions = [];
      return;
    }
  
    const [startHour, startMinute] = scheduleForDay.startTime.split(':').map(Number);
    const [endHour, endMinute] = scheduleForDay.endTime.split(':').map(Number);
  
    const options = [];
    for (let hour = startHour; hour <= endHour; hour++) {
      for (let min of [0, 30]) {
        if (hour === endHour && min >= endMinute) continue;
  
        const displayHour = hour % 12 === 0 ? 12 : hour % 12;
        const amPm = hour < 12 ? 'AM' : 'PM';
        const formattedHour = hour < 10 ? `0${hour}` : `${hour}`;
        const formattedMinute = min === 0 ? '00' : '30';
  
        options.push({
          value: `${formattedHour}:${formattedMinute}`,
          display: `${displayHour}:${formattedMinute} ${amPm}`
        });
      }
    }
  
    this.timeOptions = options;
  }
  

  
}

import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CartService } from '../cart.service';
import { LoadingController, ToastController } from '@ionic/angular';
import { AccessibilityService } from '../accessibility.service';
import { AuthService } from '../auth.service';
import { AeropayService } from '../aeropay.service';
import { openWidget } from 'aerosync-web-sdk';
import { FcmService } from '../fcm.service';
import { LocationStateService } from '../location-state.service';
import { DiscountService } from '../discount.service';
import { EcomDiscount } from '../discount/discount.model';
import { environment } from 'src/environments/environment';

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

  showTooltip = false;

  originalSubtotal: number = 0;
  discountedSubtotal: number = 0;
  finalSubtotal: number = 0;
  finalTotal: number = 0;
  finalTax: number = 0;

  selectedTime: string = '';

  isLoading: boolean = false;

  timeOptions: { value: string; display: string }[] = [];

  selectedPaymentMethod: string = 'cash';

  selectedOrderType: string = 'pickup';

  enableDelivery: boolean = false;

  // Defaults match maspeth-shop's previously-hardcoded values; overridden by the
  // business's actual configured values once GET /businesses/zone resolves.
  deliveryMin: number = 70;
  deliveryFee: number = 0;

  verificationRequired: boolean = false;
  verificationCode: string = '';

  aerosyncURL: string | null = null;
  aerosyncToken: string | null = null;
  aerosyncUsername: string | null = null;

  userBankAccounts: any[] = []; // Always sourced from GET /v2/bankAccounts — never trusted from create/confirm user responses
  showBankSelection: boolean = false;
  selectedBankId: string | null = null;

  // AeroPay rejects a 6th linked account with AP414 — surfacing that only after a customer
  // completes the whole Aerosync flow is a dead end, so hide the option proactively once they're
  // already at the cap. Kept in sync with the reactive AP414 handler in linkBankToAeropay() below
  // in case userBankAccounts is stale (e.g. an account was linked from another device/tab).
  readonly maxBankAccounts = 5;
  get atMaxBankAccounts(): boolean {
    return this.userBankAccounts.length >= this.maxBankAccounts;
  }
  aeropayUserId: string | null = null;

  isFetchingAeroPay: boolean = false;
  isLinkingBank: boolean = false;

  @Output() back: EventEmitter<void> = new EventEmitter<void>();
  @Output() orderPlaced = new EventEmitter<void>();

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

  deliverySchedule: { day: string; startTime: string; endTime: string }[] = [];
  validDeliveryDates: string[] = [];

  deliveryAddressValid: boolean = false;

  locationId: any;

  isGuest: boolean = true;

  activeDiscounts: EcomDiscount[] = [];
  cartDiscounts: { discount: EcomDiscount; estimatedSavings: number | null }[] = [];

  constructor(
    private cartService: CartService,
    private loadingController: LoadingController,
    private accessibilityService: AccessibilityService,
    private toastController: ToastController,
    private authService: AuthService,
    private aeropayService: AeropayService,
    private fcmService: FcmService,
    private locationStateService: LocationStateService,
    private discountService: DiscountService
  ) {}

  async ngOnInit() {
    this.locationId = this.locationStateService.getLocationId();

    // Guest checkout — checkoutInfo.user_info is null when nobody is logged in.
    if (!this.checkoutInfo.user_info) {
      this.isGuest = true;
      this.checkoutInfo.user_info = { fname: '', lname: '', email: '', phone: '', dob: '' };
    }

    this.discountService.fetchDiscounts().subscribe((discounts) => {
      this.activeDiscounts = discounts;
      this.cartDiscounts = this.discountService.getCartDiscounts(this.checkoutInfo.cart, this.activeDiscounts);
      this.updateTotals();
    });

    this.calculateDefaultTotals();
    this.checkDeliveryEligibility();

    try {
      const res: any = await this.cartService.getDeliveryZone();

      // Sequelize returns DECIMAL columns (deliveryFee) as strings, unlike INTEGER columns
      // (deliveryMin) — coerce both explicitly so finalTotal's arithmetic never silently
      // string-concatenates instead of adding.
      this.deliveryMin = res.deliveryMin != null ? Number(res.deliveryMin) : this.deliveryMin;
      this.deliveryFee = res.deliveryFee != null ? Number(res.deliveryFee) : this.deliveryFee;
      this.updateTotals();

      if (res.schedule) {
        this.deliverySchedule = res.schedule;

        const availableDates = this.getAvailableDeliveryDates(res.schedule);
        this.validDeliveryDates = availableDates;

        if (availableDates.length === 0) {
          this.presentToast('No available delivery days found.', 'danger');
          return;
        }

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
      for (const minute of [0, 30]) {
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

  /** Per-unit discounted price for a cart line, or null if no guaranteed (auto_apply) discount applies. */
  getItemDiscountedPrice(item: any): number | null {
    return this.discountService.getDiscountedPrice(item, this.activeDiscounts);
  }

  /** Savings from active deals (auto_apply only) — baked into finalSubtotal/finalTotal, not just informational. */
  get totalEstimatedSavings(): number {
    return this.originalSubtotal - this.discountedSubtotal;
  }

  /** Delivery fee only applies when delivery is the selected order type. */
  get appliedDeliveryFee(): number {
    return this.selectedOrderType === 'delivery' ? this.deliveryFee : 0;
  }

  checkDeliveryEligibility() {
    this.cartService.checkDeliveryEligibility().subscribe({
      next: (response) => {
        this.enableDelivery = response.deliveryAvailable;
      },
      error: (error) => {
        console.error('Error fetching delivery eligibility:', error);
        this.enableDelivery = false;
      }
    });
  }

  //Aeropay
  async startAeroPayProcess() {
    const user = this.checkoutInfo.user_info;
    if (!user.fname || !user.lname || !user.phone || !user.email) {
      this.selectedPaymentMethod = 'cash';
      this.presentToast('Please fill out all contact fields before selecting AeroPay.', 'danger');
      return;
    }

    // Already have a verified user and their real linked accounts — just show them.
    if (this.aeropayUserId && this.userBankAccounts.length > 0) {
      this.showBankSelection = true;
      return;
    }

    this.isFetchingAeroPay = true;

    this.aeropayService.fetchMerchantToken().subscribe({
      next: (response: any) => {
        if (!response.data?.token) {
          console.error('AeroPay Authentication Failed:', response.data?.error);
          this.presentToast(`Authentication Error: ${response.data?.error?.message || 'please try again.'}`, 'danger');
          this.isFetchingAeroPay = false;
          return;
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
    const user = this.checkoutInfo.user_info;
    const userData = {
      firstName: user.fname,
      lastName: user.lname,
      phoneNumber: user.phone,
      email: user.email
    };

    this.aeropayService.createUser(userData).subscribe({
      next: (response: any) => {
        const body = response.data;

        if (body?.error || !body?.user) {
          console.error('Error Creating AeroPay User:', body?.error);
          this.presentToast(`Error creating user: ${body?.error?.message || 'Please try again.'}`, 'danger');
          this.isFetchingAeroPay = false;
          return;
        }

        this.aeropayUserId = body.user.id;

        if (body.mfaType) {
          this.verificationRequired = true;
          this.isFetchingAeroPay = false;
        } else {
          this.verificationRequired = false;
          this.loadLinkedBankAccounts();
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

    if (!this.aeropayUserId) {
      this.presentToast('Something went wrong. Please restart AeroPay checkout.', 'danger');
      return;
    }

    this.aeropayService.confirmUser(this.aeropayUserId, this.verificationCode).subscribe({
      next: (response: any) => {
        const body = response.data;

        if (body?.error) {
          console.error('Verification Failed:', body.error);
          this.presentToast(body.error.message || 'Invalid verification code. Please try again.', 'danger');
          return;
        }

        this.verificationRequired = false;
        this.verificationCode = '';
        this.presentToast('Verification successful!', 'success');

        this.loadLinkedBankAccounts();
      },
      error: (error: any) => {
        console.error('Verification Failed:', error);
        this.presentToast('Invalid verification code. Please try again.', 'danger');
      }
    });
  }

  resendVerificationCode() {
    if (this.isFetchingAeroPay) return;
    this.isFetchingAeroPay = true;
    this.createAeroPayUser();
  }

  // Source of truth for a user's linked accounts — the create/confirm user responses never include bank data.
  async loadLinkedBankAccounts() {
    if (!this.aeropayUserId) return;
    this.isFetchingAeroPay = true;

    this.aeropayService.fetchUsedForMerchantToken(this.aeropayUserId).subscribe({
      next: (response: any) => {
        if (!response.data?.token) {
          console.error('AeroPay Authentication Failed:', response.data?.error);
          this.presentToast(`Authentication Error: ${response.data?.error?.message || 'please try again.'}`, 'danger');
          this.isFetchingAeroPay = false;
          return;
        }

        this.aeropayService.getBankAccounts().subscribe({
          next: (response: any) => {
            this.userBankAccounts = response.data?.bankAccounts || [];
            this.selectedBankId = this.userBankAccounts[0]?.bankAccountId ?? null;
            this.showBankSelection = true;
            this.isFetchingAeroPay = false;
          },
          error: (error: any) => {
            console.error('Error Retrieving Bank Accounts:', error);
            this.presentToast('Unable to load your linked bank accounts.', 'danger');
            this.isFetchingAeroPay = false;
          }
        });
      },
      error: (error: any) => {
        console.error('AeroPay Authentication Request Failed:', error);
        this.presentToast('Authentication request failed. Please try again.', 'danger');
        this.isFetchingAeroPay = false;
      }
    });
  }

  // Explicit user action only — never opened automatically as a fallback (that's what causes the AP414 loop).
  async retrieveAerosyncCredentials() {
    if (!this.aeropayUserId) return;

    if (this.atMaxBankAccounts) {
      this.presentToast(`You've reached the maximum of ${this.maxBankAccounts} linked bank accounts. Please select one of your existing accounts below, or contact us if you need to link a different one.`, 'warning');
      return;
    }

    this.loadingAerosync = true;
    this.aeropayService.fetchUsedForMerchantToken(this.aeropayUserId).subscribe({
      next: (response: any) => {
        if (!response.data?.token) {
          console.error('AeroPay Authentication Failed:', response.data?.error);
          this.presentToast(`Authentication Error: ${response.data?.error?.message || 'please try again.'}`, 'danger');
          this.loadingAerosync = false;
          return;
        }

        this.aeropayService.getAerosyncCredentials().subscribe({
          next: (response: any) => {
            const body = response.data;
            if (!body?.error) {
              this.aerosyncURL = body.fastlinkURL;
              this.aerosyncToken = body.token;
              this.aerosyncUsername = body.username;

              this.openAerosyncWidget();
            } else {
              console.error('Failed to retrieve Aerosync widget:', body.error);
              this.presentToast(body.error.message || 'Failed to retrieve Aerosync widget.', 'danger');
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

    const widgetRef = openWidget({
      id: "widget",
      iframeTitle: 'Connect',
      environment: environment.production ? 'production' : 'sandbox',
      token: this.aerosyncToken,
      style: {
        width: '375px',
        height: '688px',
        bgColor: '#000000',
        opacity: 0.7
      },
      deeplink: "",
      consumerId: "",

      onLoad: function () {
        console.log("AeroSync Widget Loaded");
      },
      onSuccess: (event: any) => {
        // Confirmed against a real widget session: Aerosync's pageSuccess payload carries the
        // connection reference as `user_id` (verified equal to the `connectionId`/`userId` its own
        // internal "create accounts" response logs under those names moments earlier — `user_id`
        // here is that same value, just relabeled in this specific message). `user_password` is
        // also present but isn't part of AeroPay's documented /v2/linkAccountFromAggregator contract
        // ({connectionId, aggregator}), so it's not needed here. Keeping the other key names as
        // fallbacks in case Aerosync's payload shape ever shifts again.
        const connectionId = event?.user_id || event?.connectionId || event?.userId;
        if (connectionId) {
          this.linkBankToAeropay(connectionId);
        } else {
          console.error("Missing connectionId in Aerosync event:", event);
          this.presentToast('Could not complete bank linking. Please try again.', 'danger');
        }
      },
      onError: (event: any) => {
        console.error("AeroSync Error:", event);
        this.presentToast('Something went wrong while connecting to your bank. Please try again.', 'danger');
      },
      onClose: function () {
        console.log("AeroSync Widget Closed");
      },
      onEvent: function (event: object, type: string): void {
        console.log(event, type);
      }
    });

    widgetRef.launch();
  }

  linkBankToAeropay(connectionId: string) {
    this.isLinkingBank = true;
    this.aeropayService.linkBankAccount(connectionId).subscribe({
      next: (response: any) => {
        this.isLinkingBank = false;
        const body = response.data;

        if (body?.userBankInfo) {
          this.presentToast('Bank account linked successfully!', 'success');

          const linkedBank = body.userBankInfo;
          const alreadyExists = this.userBankAccounts.some((b: any) => b.bankAccountId === linkedBank.bankAccountId);
          if (!alreadyExists) {
            this.userBankAccounts = [...this.userBankAccounts, linkedBank];
          }
          this.selectedBankId = linkedBank.bankAccountId;
          this.showBankSelection = true;
        } else if (body?.code === 'AP414') {
          // Max accounts already linked — re-fetch the user's real accounts so they can pick one instead.
          this.presentToast(`You've reached the maximum of ${this.maxBankAccounts} linked bank accounts. Please select one of your existing accounts below, or contact us if you need to link a different one.`, 'warning');
          this.loadLinkedBankAccounts();
        } else {
          this.presentToast(body?.error || 'Failed to link your bank. Please try again.', 'danger');
        }
      },
      error: (error: any) => {
        this.isLinkingBank = false;
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
      for (const minute of [0, 30]) {
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
    this.originalSubtotal = this.checkoutInfo.cart.reduce(
      (total: number, item: any) => total + (parseFloat(item.price) * item.quantity),
      0
    );
    this.discountedSubtotal = this.originalSubtotal;
    this.finalSubtotal = this.discountedSubtotal;
    this.finalTax = this.finalSubtotal * 0.13;
    this.finalTotal = this.finalSubtotal + this.finalTax;
  }

  updateTotals() {
    this.originalSubtotal = this.checkoutInfo.cart.reduce(
      (total: number, item: any) => total + (parseFloat(item.price) * item.quantity),
      0
    );

    this.discountedSubtotal = this.discountService.getDiscountedSubtotal(this.checkoutInfo.cart, this.activeDiscounts);
    this.finalSubtotal = this.discountedSubtotal;
    this.finalTax = this.finalSubtotal * 0.13;
    this.finalTotal = this.finalSubtotal + this.finalTax + this.appliedDeliveryFee;

    this.accessibilityService.announce(
      `Subtotal updated to ${this.finalSubtotal.toFixed(2)} dollars.`,
      'polite'
    );
  }

  goBack() {
    this.back.emit();
    this.accessibilityService.announce('Returned to the previous page.', 'polite');
  }

  toggleDatePicker() {
    this.isDatePickerOpen = !this.isDatePickerOpen;
    const message = this.isDatePickerOpen ? 'Date picker opened.' : 'Date picker closed.';
    this.accessibilityService.announce(message, 'polite');
  }

  toggleTooltip() {
    this.showTooltip = !this.showTooltip;
  }

  onDateSelected(event: any) {
    const isoString = event.detail.value;

    if (!isoString) return;

    this.selectedDeliveryDate = isoString.split('T')[0];

    if (!this.selectedDeliveryDate) return;

    const [year, month, day] = this.selectedDeliveryDate.split('-');
    const date = new Date(this.selectedDeliveryDate);
    const dayOfWeek = date.getDay();

    this.generateTimeOptionsForDay(dayOfWeek);

    this.accessibilityService.announce(`Selected date is ${month}-${day}-${year}.`, 'polite');
  }

  async placeOrder() {
    if (this.isLoading) return;

    this.isLoading = true;
    const loading = await this.loadingController.create({
      spinner: 'crescent',
      message: 'Please wait while we process your order...',
      cssClass: 'custom-loading',
    });
    await loading.present();

    // Tracks whether AeroPay was charged so we can show the right message if order creation fails after payment
    let aeropayPaymentSucceeded = false;

    try {
      const user = this.checkoutInfo.user_info;

      const alleavesResponse = await this.cartService.createAlleavesCustomer({
        fname: user.fname,
        lname: user.lname,
        phone: user.phone,
        email: user.email,
        dob: '1990-01-01',
      });
      let newAllLeavesId = '';
      if (alleavesResponse?.id_customer) {
        newAllLeavesId = alleavesResponse.id_customer;
      } else {
        console.warn('Failed to create Alleaves Customer');
      }

      // Prefer the account's stored Alleaves customer ID when it's actually set, but fall back to
      // the one just created above — a logged-in user whose profile never got an alleaves_customer_id
      // attached (e.g. a signup that predates a working Alleaves integration) would otherwise send
      // id_customer: null to Alleaves here, which fails order creation with a validation error.
      const alleavesCustomerIdForOrder = (!this.isGuest && user.alleaves_customer_id) ? user.alleaves_customer_id : newAllLeavesId;
      if (!alleavesCustomerIdForOrder) {
        await this.presentToast('Unable to prepare your order. Please try again.', 'danger');
        this.isLoading = false;
        await loading.dismiss();
        return;
      }

      // Loyalty points program has been discontinued — never earn or redeem points on new orders.
      const points_redeem = 0;
      const points_add = 0;
      let pos_order_id = 0;

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

      if (this.selectedPaymentMethod === 'aeropay') {
        if (!this.selectedBankId || !this.aeropayUserId) {
          this.presentToast('Please select a bank account to continue with AeroPay.', 'danger');
          this.isLoading = false;
          await loading.dismiss();
          return;
        }

        const tokenResponse = await this.aeropayService.fetchUsedForMerchantToken(this.aeropayUserId).toPromise();
        if (!tokenResponse?.data?.token) {
          console.error('AeroPay Token Failed:', tokenResponse?.data);
          this.presentToast(`Payment authorization failed: ${tokenResponse?.data?.error?.message || 'please try again.'}`, 'danger');
          this.isLoading = false;
          await loading.dismiss();
          return;
        }

        const amountInPennies = Math.round(this.finalTotal * 100);
        const preauthResponse = await this.aeropayService.createPreauthTransaction(
          amountInPennies,
          this.selectedBankId
        ).toPromise();

        const preauthTransactionId = preauthResponse?.data?.transaction?.id;
        if (!preauthTransactionId) {
          console.error('AeroPay Preauth Failed:', preauthResponse?.data);
          const reason = preauthResponse?.data?.error?.message || 'Payment was declined.';
          this.presentToast(`Payment failed: ${reason} Please try again or use a different payment method.`, 'danger');
          this.isLoading = false;
          await loading.dismiss();
          return;
        }

        // Capture uses the merchant-scoped token — a different scope than the preauth call.
        const merchantTokenResponse = await this.aeropayService.fetchMerchantToken().toPromise();
        if (!merchantTokenResponse?.data?.token) {
          console.error('AeroPay Merchant Token Failed:', merchantTokenResponse?.data);
          this.presentToast('Your payment was authorized but could not be captured. Please contact us before retrying.', 'danger');
          this.isLoading = false;
          await loading.dismiss();
          return;
        }

        const captureResponse = await this.aeropayService.capturePreauthTransaction(preauthTransactionId).toPromise();
        if (!captureResponse?.data?.transaction) {
          console.error('AeroPay Capture Failed:', captureResponse?.data);
          const reason = captureResponse?.data?.error?.message || 'Payment could not be captured.';
          this.presentToast(`Payment failed: ${reason} Please try again or use a different payment method.`, 'danger');
          this.isLoading = false;
          await loading.dismiss();
          return;
        }

        aeropayPaymentSucceeded = true;
        this.presentToast('Payment successful!', 'success');
      }

      const response = await this.cartService.checkout(points_redeem, this.selectedOrderType, deliveryAddress, alleavesCustomerIdForOrder);

      pos_order_id = response.id_order;

      await this.cartService.placeOrder(
        user.id,
        pos_order_id,
        points_add,
        points_redeem,
        this.finalSubtotal,
        this.checkoutInfo.cart,
        user.email
      );

      this.orderPlaced.emit();

      this.accessibilityService.announce('Your order has been placed successfully.', 'polite');

      const orderTypeMessage =
        this.selectedOrderType === 'delivery'
          ? 'Your delivery order has been placed!'
          : 'Your pickup order has been placed!';

      if (user.id) {
        await this.fcmService.sendPushNotification(user.id, 'Order Confirmed', orderTypeMessage);
      }
    } catch (error: any) {
      console.error('Error placing order:', error);
      if (aeropayPaymentSucceeded) {
        // Payment went through but order creation failed — do NOT let them retry or they'll be charged again
        await this.presentToast('Your payment was processed but the order could not be submitted. Please contact us immediately and do not place the order again.');
      } else {
        await this.presentToast('Error placing order: ' + (error?.message ?? 'please try again.'));
      }
      this.accessibilityService.announce('There was an error placing your order. Please try again.', 'polite');
    } finally {
      this.isLoading = false;
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
    this.updateTotals(); // delivery fee only applies when order type is 'delivery'

    if (this.selectedOrderType === 'delivery') {
      this.selectedPaymentMethod = 'aeropay';
      this.startAeroPayProcess();
    }
  }

  onPaymentMethodChange(selectedMethod: string) {
    if (selectedMethod === 'aeropay') {
      this.startAeroPayProcess();
    } else {
      this.showBankSelection = false;
    }
  }

  async onAddressInputChange() {
    const { street, city, zip } = this.deliveryAddress;

    this.deliveryAddressValid = false;

    if (street.trim() && city.trim() && zip.trim().length >= 5) {
      const fullAddress = `${street.trim()}, ${city.trim()}, NY ${zip.trim()}`;

      try {
        const result = await this.cartService.checkAddressInZone(fullAddress);

        if (!result.inZone) {
          this.presentToast('This address is outside the delivery zone.', 'danger');
          this.deliveryAddressValid = false;
        } else {
          this.deliveryAddressValid = true;
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

    const [startHour] = scheduleForDay.startTime.split(':').map(Number);
    const [endHour, endMinute] = scheduleForDay.endTime.split(':').map(Number);

    const options = [];
    for (let hour = startHour; hour <= endHour; hour++) {
      for (const min of [0, 30]) {
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

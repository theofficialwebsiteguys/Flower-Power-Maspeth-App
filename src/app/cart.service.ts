import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, from, Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { AuthService } from './auth.service';
import { CapacitorHttp } from '@capacitor/core';
import { LocationStateService } from './location-state.service';
import { SettingsService } from './settings.service';

export interface CartItem {
  id: string;
  posProductId: string;
  id_batch: string;
  image: string;
  brand: string;
  desc: string;
  price: string;
  quantity: number;
  title: string;
  strainType: string;
  thc: string;
  weight: string;
  category: string;
  id_item?: string;
}

/**
 * Thrown by checkout() when Alleaves won't take one or more cart lines (e.g. sold out, or a batch
 * that changed since the item was added to the cart). The partial Alleaves order has already been
 * cancelled by the time this reaches the caller.
 */
export class OrderItemsUnavailableError extends Error {
  constructor(public unavailableItems: CartItem[]) {
    super(`Items unavailable: ${unavailableItems.map(item => item.title).join(', ')}`);
    this.name = 'OrderItemsUnavailableError';
  }
}

/** The API refused or failed to apply a points redemption; `message` is safe to show the customer. */
export class PointsRedemptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PointsRedemptionError';
  }
}

/**
 * The business's points rules, from GET /orders/loyalty-config — the same settings the API enforces
 * (Dispensary-API toolbox/loyalty.js), so nothing here hard-codes its own copy.
 *   earnRate    points per $1 of subtotal
 *   redeemValue dollars off per point
 *   redeemStep  points are redeemed in whole multiples of this (e.g. 100)
 */
export interface LoyaltyConfig {
  earnRate: number;
  redeemValue: number;
  redeemStep: number;
}

@Injectable({
  providedIn: 'root',
})
export class CartService {
  private cartKey = 'cart';
  private cartSubject = new BehaviorSubject<CartItem[]>(this.getCart());
  cart$ = this.cartSubject.asObservable();
  private inactivityTime = 0;
  private inactivityLimit = 24 * 24 * 60; // ~9.6 hours of one-second ticks
  private userId: number | null = null;
  private lastNotificationKey = 'lastCartAbandonmentNotification';

  private inactivityTimer: any;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private locationStateService: LocationStateService,
    private settingsService: SettingsService
  ) {
    if (!sessionStorage.getItem(this.cartKey)) {
      sessionStorage.setItem(this.cartKey, JSON.stringify([]));
    }

    this.authService.isLoggedIn().subscribe((status) => {
      if (status) {
        this.authService.getUserInfo().subscribe((user: any) => {
          if (user) {
            this.userId = user.id;
            sessionStorage.removeItem(this.lastNotificationKey);
            this.setupTracking();
          }
        });
      }
    });
  }

  private setupTracking() {
    document.addEventListener('mousemove', () => this.resetInactivity());
    document.addEventListener('keypress', () => this.resetInactivity());

    const trackInactivity = () => {
      this.inactivityTime += 1;

      if (this.inactivityTime > this.inactivityLimit && this.getCart().length > 0) {
        this.handleAbandonedCart();
      }

      this.inactivityTimer = setTimeout(trackInactivity, 1000);
    };

    trackInactivity();
  }

  ngOnDestroy() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
  }

  private resetInactivity() {
    if (this.getCart().length === 0) {
      sessionStorage.removeItem(this.lastNotificationKey);
    }
    if (this.inactivityTime > 0) {
      this.inactivityTime = 0;
    }
  }

  private handleAbandonedCart() {
    const cartItems = this.getCart();
    const lastNotification = sessionStorage.getItem(this.lastNotificationKey);

    if (cartItems.length > 0 && this.userId && !lastNotification) {
      this.sendCartAbandonmentNotification(this.userId);
      sessionStorage.setItem(this.lastNotificationKey, 'sent');
    }
  }

  private async sendCartAbandonmentNotification(userId: number) {
    const payload = { userId, title: 'Forget To Checkout?', body: 'Come back to checkout and feel the power of the flower!' };

    const sessionData = localStorage.getItem('sessionData');
    const token = sessionData ? JSON.parse(sessionData).token : null;

    const headers = {
      Authorization: token,
      'Content-Type': 'application/json'
    };

    try {
      await CapacitorHttp.post({
        url: `${environment.apiUrl}/notifications/send-push`,
        headers,
        data: payload
      });
    } catch (error) {
      console.error('Error sending notification', error);
    }
  }

  getCart(): CartItem[] {
    const cart = sessionStorage.getItem(this.cartKey);
    return cart ? JSON.parse(cart) : [];
  }

  addToCart(item: CartItem) {
    const cart = this.getCart();
    const existingItemIndex = cart.findIndex(
      (cartItem: CartItem) => cartItem.id === item.id
    );

    if (existingItemIndex !== -1) {
      cart[existingItemIndex].quantity += item.quantity;
    } else {
      cart.push(item);
    }

    this.saveCart(cart);
  }

  updateQuantity(itemId: string, quantity: number) {
    const cart = this.getCart();
    const itemIndex = cart.findIndex((cartItem: CartItem) => cartItem.id === itemId);

    if (itemIndex !== -1) {
      cart[itemIndex].quantity = quantity;
      if (cart[itemIndex].quantity <= 0) {
        cart.splice(itemIndex, 1);
      }
      this.saveCart(cart);
    }
  }

  removeFromCart(itemId: string) {
    const cart = this.getCart();
    const updatedCart = cart.filter((cartItem: CartItem) => cartItem.id !== itemId);
    this.saveCart(updatedCart);
  }

  clearCart() {
    this.saveCart([]);
  }

  private saveCart(cart: CartItem[]) {
    sessionStorage.setItem(this.cartKey, JSON.stringify(cart));
    this.cartSubject.next(cart);
  }

  // Matches maspeth-shop's CartService.getHeaders() exactly — every one of these calls (guest
  // and logged-in alike) is scoped by the business-level x-auth-api-key + location_id, resolved
  // server-side; no user session token is sent here.
  private getHeaders(): { [key: string]: string } {
    return {
      'Content-Type': 'application/json',
      'x-auth-api-key': environment.db_api_key,
    };
  }

  /**
   * Places the real order against the Alleaves POS — routed through our own backend
   * (/orders/alleaves/*) rather than calling app.alleaves.com directly from the client.
   * Calling Alleaves straight from the browser depends on Alleaves sending CORS headers for our
   * origin, which isn't reliable; the backend already resolves Alleaves credentials server-side
   * per business_id + location_id (see Dispensary-API's Credential table / authMiddleware).
   * id_location/id_area 1000 are Alleaves' own internal location/area identifiers for this
   * storefront — not to be confused with our backend's location_id ('364' for Maspeth).
   */
  checkout(points_redeem: number, orderType: string, deliveryAddress: any, allLeavesId: number) {
    const cartItems = this.getCart();
    let id_order = 0;
    let subtotal = 0;
    let user_info: any;
    let checkoutItems = [...cartItems];

    const getUserInfo = async () => {
      user_info = await this.authService.getCurrentUser();
    };

    const createOrder = async () => {
      const orderDetails = {
        id_customer: allLeavesId,
        id_external: null,
        id_location: 1000,
        id_status: 1,
        type: orderType,
        use_type: 'adult',
        auto_apply_discount_exclusions: [],
        delivery_address: orderType === 'delivery' ? deliveryAddress : null,
        complete: false,
        verified: false,
        packed: false,
        scheduled: false,
      };
      const response = await this.createOrder(orderDetails);
      id_order = response.id_order;
    };

    const addItemsToOrder = async () => {
      const responses = await this.addCheckoutItemsToOrder(id_order, checkoutItems);

      let responseIndex = 0;
      checkoutItems = checkoutItems.flatMap((cartItem) => {
        const newItems = [];
        for (let i = 0; i < cartItem.quantity; i++) {
          if (responses[responseIndex]) {
            newItems.push({
              ...cartItem,
              id_item: responses[responseIndex].id_item,
            });
            responseIndex++;
          }
        }
        return newItems;
      });

      subtotal = checkoutItems.reduce((acc: number, item: any) => acc + (item.price || 0), 0);
    };

    // The API checks the balance, takes the points and discounts the Alleaves order in one step,
    // so the discount can never land without the points actually being spent.
    const redeemPoints = async () => {
      if (!points_redeem) return;
      const sessionData = localStorage.getItem('sessionData');
      const token = sessionData ? JSON.parse(sessionData).token : null;
      if (!token) throw new PointsRedemptionError('Please log in again to use your points.');

      const locationId = this.settingsService.getSelectedLocationId();
      const response = await CapacitorHttp.request({
        url: `${environment.apiUrl}/orders/alleaves/order/${id_order}/redeem-points?location_id=${locationId || ''}`,
        method: 'POST',
        headers: { ...this.getHeaders(), Authorization: token },
        data: { points: points_redeem },
      });
      if (response.status < 200 || response.status >= 300) {
        const issue = response.data?.details?.issue || 'please try again';
        throw new PointsRedemptionError(`${issue}.`);
      }
    };

    return (async () => {
      try {
        await getUserInfo();
        await createOrder();
        await addItemsToOrder();
        await redeemPoints();
        return { user_info, id_order, checkoutItems, subtotal };
      } catch (error) {
        console.error('Checkout process failed:', error);
        // Don't leave a half-built order sitting in the store's queue for a checkout that failed.
        if (id_order) await this.cancelAlleavesOrder(id_order, allLeavesId);
        throw error;
      }
    })();
  }

  /**
   * Best-effort cancel of an Alleaves order abandoned mid-checkout. Never throws — the caller is
   * already handling a failure, and a leftover unpaid order is something the store can clean up.
   */
  private loyaltyConfigRequest: Promise<LoyaltyConfig | null> | null = null;

  /** Points rules for this business, fetched once per session. Null if they couldn't be loaded. */
  getLoyaltyConfig(): Promise<LoyaltyConfig | null> {
    if (!this.loyaltyConfigRequest) {
      const locationId = this.settingsService.getSelectedLocationId();
      this.loyaltyConfigRequest = CapacitorHttp.request({
        url: `${environment.apiUrl}/orders/loyalty-config?location_id=${locationId || ''}`,
        method: 'GET',
        headers: this.getHeaders(),
      })
        .then((response) => {
          const d = response.data;
          if (response.status < 200 || response.status >= 300 || !d) throw new Error(`status ${response.status}`);
          return { earnRate: Number(d.earnRate) || 0, redeemValue: Number(d.redeemValue) || 0, redeemStep: Math.max(1, Number(d.redeemStep) || 1) };
        })
        .catch((error) => {
          console.error('Could not load points settings:', error);
          this.loyaltyConfigRequest = null; // try again next time
          return null;
        });
    }
    return this.loyaltyConfigRequest;
  }

  async cancelAlleavesOrder(id_order: number, id_customer: number): Promise<void> {
    const locationId = this.settingsService.getSelectedLocationId();
    const options = {
      url: `${environment.apiUrl}/orders/alleaves/order/${id_order}?location_id=${locationId || ''}`,
      method: 'PUT',
      headers: this.getHeaders(),
      data: { id_order, id_customer, id_location: 1000, cancel: true },
    };

    try {
      const response = await CapacitorHttp.request(options);
      if (response.status < 200 || response.status >= 300) {
        console.error(`Failed to cancel abandoned Alleaves order ${id_order}:`, response.status, response.data);
        return;
      }
      // Hand back any points applied to the order now rather than at the nightly sweep. The API
      // only does this once Alleaves shows the order cancelled.
      await CapacitorHttp.request({
        url: `${environment.apiUrl}/orders/alleaves/order/${id_order}/release-points?location_id=${locationId || ''}`,
        method: 'POST',
        headers: this.getHeaders(),
        data: {},
      });
    } catch (error) {
      console.error(`Failed to cancel abandoned Alleaves order ${id_order}:`, error);
    }
  }

  async createCustomer(userDetails: any) {
    const locationId = this.settingsService.getSelectedLocationId();
    const options = {
      url: `${environment.apiUrl}/orders/alleaves/customer?location_id=${locationId || ''}`,
      method: 'POST',
      headers: this.getHeaders(),
      data: userDetails,
    };

    return CapacitorHttp.request(options)
      .then((response) => response.data)
      .catch((error) => {
        console.error('Error creating User:', error);
        throw error;
      });
  }

  async createOrder(orderDetails: any) {
    const locationId = this.settingsService.getSelectedLocationId();
    const options = {
      url: `${environment.apiUrl}/orders/alleaves/order?location_id=${locationId || ''}`,
      method: 'POST',
      headers: this.getHeaders(),
      data: orderDetails,
    };

    return CapacitorHttp.request(options)
      .then((response) => {
        // CapacitorHttp resolves on 4xx/5xx — a rejected order would otherwise come back as an
        // error body with no id_order and checkout would carry on as if the order existed.
        if (response.status < 200 || response.status >= 300 || !response.data?.id_order) {
          throw new Error(`Alleaves order creation failed (status ${response.status}): ${JSON.stringify(response.data)}`);
        }
        return response.data;
      })
      .catch((error) => {
        console.error('Error creating order:', error);
        throw error;
      });
  }

  /**
   * Alleaves returns the order's lines after each add, one line per unit. When those lines are
   * present, confirm the full requested quantity of this batch is actually on the order.
   */
  private orderHasBatchQuantity(lines: any[], item: any): boolean {
    if (!lines.some((line) => line?.id_batch != null)) return true; // no batch info to check against
    const units = lines
      .filter((line) => String(line.id_batch) === String(item.id_batch))
      .reduce((sum, line) => sum + (Number(line.quantity) || 1), 0);
    return units >= (Number(item.quantity) || 1);
  }

  async addCheckoutItemsToOrder(idOrder: number, checkoutItems: any[]) {
    const headers = this.getHeaders();
    const locationId = this.settingsService.getSelectedLocationId();

    const apiUrl = `${environment.apiUrl}/orders/alleaves/order/${idOrder}/item?location_id=${locationId || ''}`;
    const addedItems: any[] = [];
    const unavailableItems: any[] = [];

    for (const item of checkoutItems) {
      const body = {
        id_batch: item.id_batch,
        id_area: 1000,
        qty: item.quantity,
      };

      const options = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        data: body,
      };

      try {
        const response = await CapacitorHttp.request(options);
        const lines: any[] | null = Array.isArray(response?.data?.items) ? response.data.items : null;

        // The backend forwards Alleaves' own status, so a non-2xx means the item was rejected.
        if (response.status < 200 || response.status >= 300 || (lines && !this.orderHasBatchQuantity(lines, item))) {
          console.error(`Alleaves rejected item (id_batch: ${item.id_batch}):`, response.status, response.data);
          unavailableItems.push(item);
          continue;
        }

        if (lines && lines.length > 0) {
          lines.forEach((resItem: any) => {
            const exists = addedItems.some((added) => added.id_item === resItem.id_item);
            if (!exists) {
              addedItems.push({
                ...item,
                id_item: resItem.id_item,
              });
            }
          });
        } else {
          console.warn(`Unexpected response format for item ${item.id_batch}:`, response);
        }
      } catch (error) {
        console.error(`Error adding item (id_batch: ${item.id_batch}):`, error);
        unavailableItems.push(item);
      }
    }

    // Failed adds used to be logged and skipped, so checkout went on to charge for items that
    // never made it onto the order — an empty order when every item failed.
    if (unavailableItems.length > 0) {
      throw new OrderItemsUnavailableError(unavailableItems);
    }

    return addedItems;
  }

  /** Creates the shop's own backend order record (guest checkout supported via x-auth-api-key). */
  async placeOrder(user_id: number | undefined, pos_order_id: number, points_add: number, points_redeem: number, amount: number, cart: any, email?: string) {
    const payload: any = { user_id, pos_order_id, points_add, points_redeem, amount, cart };

    const locationId = this.settingsService.getSelectedLocationId();
    const headers = this.getHeaders();

    const options = {
      url: `${environment.apiUrl}/orders/create?location_id=${locationId}`,
      method: 'POST',
      headers: headers,
      data: payload,
    };

    return CapacitorHttp.request(options)
      .then((response) => {
        // The order already exists in Alleaves by now, so the customer's email goes out even if
        // our own record fails to save.
        this.sendOrderConfirmation(email, pos_order_id).catch(() => {});
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Order record failed (status ${response.status}): ${JSON.stringify(response.data)}`);
        }
        return response.data;
      })
      .catch((error) => {
        console.error('Error in placeOrder:', error);
        throw error;
      });
  }

  async updateOrder(id_order: number, pickup_date: any, pickup_time: any, subtotal: number, id_customer: number) {
    const payload = { id_order, pickup_date, pickup_time, id_customer, id_location: 1000 };
    const locationId = this.settingsService.getSelectedLocationId();

    const options = {
      url: `${environment.apiUrl}/orders/alleaves/order/${id_order}?location_id=${locationId || ''}`,
      method: 'PUT',
      headers: this.getHeaders(),
      data: payload,
    };

    return CapacitorHttp.request(options)
      .then((response) => response.data)
      .catch((error) => {
        console.error('Error in updateOrder:', error);
        throw error;
      });
  }

  async sendOrderConfirmation(email: string | undefined, order_id: number) {
    const options = {
      url: `${environment.apiUrl}/resend/sendOrderConfirmation`,
      method: 'POST',
      headers: this.getHeaders(),
      data: { email, order_id },
    };

    return CapacitorHttp.request(options)
      .then((response) => response.data)
      .catch((error) => {
        console.error('Error sending order confirmation:', error);
      });
  }

  private getAlleavesCustomerCacheKey(locationId: string | null) {
    return `alleaves_customer_${locationId}`;
  }

  private async getOrCreateAlleavesCustomer(user: any): Promise<number> {
    const locationId = this.settingsService.getSelectedLocationId();
    const cacheKey = this.getAlleavesCustomerCacheKey(locationId);

    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      return Number(cached);
    }

    const customerPayload = {
      name_first: user.fname,
      name_last: user.lname,
      phone: user.phone,
      email: user.email,
      date_of_birth: user.dob,
    };

    const created = await this.createCustomer(customerPayload);

    if (!created?.id_customer) {
      throw new Error('Failed to create Alleaves customer');
    }

    sessionStorage.setItem(cacheKey, created.id_customer);

    return created.id_customer;
  }

  /** Creates (or looks up) an Alleaves customer directly from checkout-form contact info — used for guest checkout. */
  async createAlleavesCustomer(userData: { fname: string; lname: string; phone: string; email: string; dob: string; }): Promise<any> {
    return this.createCustomer({
      name_first: userData.fname,
      name_last: userData.lname,
      phone: userData.phone,
      email: userData.email,
      date_of_birth: userData.dob,
    });
  }

  checkDeliveryEligibility(): Observable<{ deliveryAvailable: boolean }> {
    const options = {
      url: `${environment.apiUrl}/businesses/delivery-eligibility`,
      method: 'GET',
      headers: this.getHeaders()
    };

    return from(CapacitorHttp.request(options).then(response => response.data));
  }

  // Scoped to this storefront's location — without this, delivery eligibility checks
  // against the business-level zone instead of the actual Maspeth-specific one managed
  // in the admin dashboard.
  async getDeliveryZone(): Promise<any> {
    const locationId = this.settingsService.getSelectedLocationId();
    const options = {
      url: `${environment.apiUrl}/businesses/zone${locationId ? `?location_id=${locationId}` : ''}`,
      method: 'GET',
      headers: this.getHeaders()
    };

    try {
      const response = await CapacitorHttp.request(options);
      return response.data;
    } catch (error) {
      console.error('Error fetching delivery zone:', error);
      throw error;
    }
  }

  async checkAddressInZone(address: string): Promise<{ inZone: boolean, lat: number, lng: number }> {
    const locationId = this.settingsService.getSelectedLocationId();
    const options = {
      url: `${environment.apiUrl}/businesses/zone/check${locationId ? `?location_id=${locationId}` : ''}`,
      method: 'POST',
      headers: this.getHeaders(),
      data: { address }
    };

    try {
      const response = await CapacitorHttp.request(options);
      return response.data;
    } catch (error) {
      console.error('Error checking address in zone:', error);
      throw error;
    }
  }
}

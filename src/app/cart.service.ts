import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, catchError, forkJoin, map, Observable, of, switchMap, tap, throwError } from 'rxjs';
import { environment } from 'src/environments/environment';
import { AuthService } from './auth.service';
import { CapacitorHttp } from '@capacitor/core';
import { LocationStateService } from './location-state.service';

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
  price_after_points?: number;
  price_after_premium?: number;
}

@Injectable({
  providedIn: 'root',
})
export class CartService {
  private cartKey = 'cart'; 
  private cartSubject = new BehaviorSubject<CartItem[]>(this.getCart());
  cart$ = this.cartSubject.asObservable(); 
  private inactivityTime = 0;
  private inactivityLimit = 24 * 24 * 60; // 24 hours
  private userId: number | null = null; // Store user ID
  private lastNotificationKey = 'lastCartAbandonmentNotification';

  private inactivityTimer: any;

  constructor(private http: HttpClient, private authService: AuthService, private locationStateService: LocationStateService) {
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
      this.inactivityTime += 1; // Increase by half-second steps
  
      if (this.inactivityTime > this.inactivityLimit && this.getCart().length > 0) {
        this.handleAbandonedCart();
      }
  
      this.inactivityTimer = setTimeout(trackInactivity, 1000); // Schedule next check
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
      this.inactivityTime = 0; // Reset inactivity timer
    }
  }

  private handleAbandonedCart() {
    const cartItems = this.getCart();
    const lastNotification = sessionStorage.getItem(this.lastNotificationKey);

    if (cartItems.length > 0 && this.userId && !lastNotification) {
      this.sendCartAbandonmentNotification(this.userId);
      sessionStorage.setItem(this.lastNotificationKey, 'sent'); // Mark as sent
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
      const response = await CapacitorHttp.post({
        url: `${environment.apiUrl}/notifications/send-push`,
        headers,
        data: payload
      });
      console.log('Cart abandonment notification sent', response);
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

  checkout(points_redeem: number, orderType: string, deliveryAddress: any) {
    const cartItems = this.getCart();
    // const unmatchedItems = [...cartItems];
    // const matchedCart: any[] = [];
    // let skip = 0;
    // const take = 5000;
    let id_order = 0;
    let subtotal = 0;
    let user_info: any;
    // let checkoutItems: any[] = [];
    let checkoutItems = [...cartItems];
    let employeeDiscount: any = null;

    // const fetchAndMatch = async (): Promise<any[]> => {
    //   while (unmatchedItems.length > 0) {
    //     const inventoryResponse = await this.fetchInventory(skip, take);
    //     inventoryResponse.forEach((inventoryItem: any) => {
    //       const matchIndex = unmatchedItems.findIndex(
    //         (cartItem) => +cartItem.posProductId === inventoryItem.id_item
    //       );
    //       if (matchIndex !== -1) {
    //         matchedCart.push({
    //           ...unmatchedItems[matchIndex],
    //           id_batch: inventoryItem.id_batch,
    //         });
    //         unmatchedItems.splice(matchIndex, 1);
    //       }
    //     });
    //     skip += take;
    //     if (inventoryResponse.length === 0) break;
    //   }
    //   return matchedCart;
    // };
  
    const getUserInfo = async () => {
      user_info = await this.authService.getCurrentUser();
    };
  
    const createOrder = async () => {
      const alleavesCustomerId = await this.getOrCreateAlleavesCustomer(user_info);
      const orderDetails = {
        id_customer: alleavesCustomerId,
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
    
      // Assign each response ID to the correct checkout item, considering quantity
      checkoutItems = checkoutItems.flatMap((cartItem) => {
        const newItems = [];
        for (let i = 0; i < cartItem.quantity; i++) {
          if (responses[responseIndex]) {
            newItems.push({
              ...cartItem,
              id_item: responses[responseIndex].id_item, // Assign unique id_item
            });
            responseIndex++; // Move to next response item
          }
        }
        return newItems;
      });
    
      // Recalculate subtotal
      subtotal = checkoutItems.reduce((acc: number, item: any) => acc + (item.price || 0), 0);
    };
  
    // const updateOrderItemPrices = async () => {
    //   let remainingDiscount = points_redeem / 20;
    //   const sortedItems = [...checkoutItems].sort((a: any, b: any) => b.price - a.price);
    //   for (const item of sortedItems) {
    //     console.log(item)
    //     console.log(remainingDiscount)
    //     if (remainingDiscount <= 0) break;
    //     const discountAmount = Math.min(Number(item.price), remainingDiscount);
    //     remainingDiscount -= discountAmount;
    //     const priceOverride = Number(item.price) - discountAmount;
    //     const url = `https://app.alleaves.com/api/order/${id_order}/item/${item.id_item}`;
    //     const headers = {
    //       Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
    //       'Content-Type': 'application/json; charset=utf-8',
    //       Accept: 'application/json; charset=utf-8',
    //     };
    //     const options = {
    //       url: url,
    //       method: 'PUT',
    //       headers: headers,
    //       data: {
    //         price_override: priceOverride,
    //         price_override_reason: 'Points redemption applied',
    //       },
    //     };
    //     await CapacitorHttp.request(options);
    //   }
    // };

    const updateOrderItemPrices = async () => {
      let remainingDiscount = points_redeem / 20;
      const sortedItems = [...checkoutItems].sort((a: any, b: any) => b.price - a.price);
    
      for (const item of sortedItems) {
        if (remainingDiscount <= 0) break;
    
        const discountAmount = Math.min(Number(item.price), remainingDiscount);
        remainingDiscount -= discountAmount;
    
        const priceOverride = Number(item.price) - discountAmount;
    
        // 🔥 Store in local item memory
        item.price_after_points = priceOverride;
    
        const url = `https://app.alleaves.com/api/order/${id_order}/item/${item.id_item}`;
        const headers = {
          Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json; charset=utf-8',
        };
    
        const options = {
          url,
          method: 'PUT',
          headers,
          data: {
            price_override: priceOverride,
            price_override_reason: 'Points redemption applied',
          },
        };
    
        await CapacitorHttp.request(options);
      }
    };
    

    // const updatePremiumDiscounts = async () => {
    //   // Only apply if user is premium AND subtotal is over $100
    //   if (user_info?.premium && subtotal > 100) {
    //     let premiumDiscount = subtotal * 0.10;
    //     let remainingDiscount = premiumDiscount;
    
    //     const sortedItems = [...checkoutItems].sort((a: any, b: any) => b.price - a.price);
    
    //     for (const item of sortedItems) {
    //       if (remainingDiscount <= 0) break;
    
    //       const discountAmount = Math.min(Number(item.price), remainingDiscount);
    //       remainingDiscount -= discountAmount;
    
    //       const priceOverride = Number(item.price) - discountAmount;
    //       const url = `https://app.alleaves.com/api/order/${id_order}/item/${item.id_item}`;
    //       const headers = {
    //         Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
    //         'Content-Type': 'application/json; charset=utf-8',
    //         Accept: 'application/json; charset=utf-8',
    //       };
    
    //       const options = {
    //         url,
    //         method: 'PUT',
    //         headers,
    //         data: {
    //           price_override: priceOverride,
    //           price_override_reason: 'Premium discount applied',
    //         },
    //       };
    
    //       await CapacitorHttp.request(options);
    //     }
    //   }
    // };

    const updatePremiumDiscounts = async () => {
      if (user_info?.premium && subtotal > 100) {
        let premiumDiscount = subtotal * 0.10;
        let remainingDiscount = premiumDiscount;
    
        const sortedItems = [...checkoutItems].sort((a: any, b: any) => {
          const priceA = a.price_after_points ?? Number(a.price);
          const priceB = b.price_after_points ?? Number(b.price);
          return priceB - priceA;
        });
        
        for (const item of sortedItems) {
          if (remainingDiscount <= 0) break;
    
          const basePrice = item.price_after_points ?? Number(item.price);
          const discountAmount = Math.min(basePrice, remainingDiscount);
          remainingDiscount -= discountAmount;
    
          const priceOverride = basePrice - discountAmount;
          item.price_after_premium = priceOverride; // 🔥 Store it for next discount
    
          const url = `https://app.alleaves.com/api/order/${id_order}/item/${item.id_item}`;
          const headers = {
            Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
            'Content-Type': 'application/json; charset=utf-8',
            Accept: 'application/json; charset=utf-8',
          };
    
          const options = {
            url,
            method: 'PUT',
            headers,
            data: {
              price_override: priceOverride,
              price_override_reason: 'Premium discount applied',
            },
          };
    
          await CapacitorHttp.request(options);
        }
      }
    };
    

    // const updateEmployeeDiscount = async () => {
    //   if (!employeeDiscount || !employeeDiscount.cart_adjustments?.value) return;
    
    //   let discountRate = employeeDiscount.cart_adjustments.value / 100;
    //   let totalDiscount = subtotal * discountRate;
    //   let remainingDiscount = totalDiscount;
    
    //   const sortedItems = [...checkoutItems].sort((a: any, b: any) => b.price - a.price);
    //   for (const item of sortedItems) {
    //     if (remainingDiscount <= 0) break;
    //     const discountAmount = Math.min(Number(item.price), remainingDiscount);
    //     remainingDiscount -= discountAmount;
    //     const priceOverride = Number(item.price) - discountAmount;
        
    //     const url = `https://app.alleaves.com/api/order/${id_order}/item/${item.id_item}`;
    //     const headers = {
    //       Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
    //       'Content-Type': 'application/json; charset=utf-8',
    //       Accept: 'application/json; charset=utf-8',
    //     };
    
    //     const options = {
    //       url,
    //       method: 'PUT',
    //       headers,
    //       data: {
    //         price_override: priceOverride,
    //         price_override_reason: 'Staff discount applied',
    //       },
    //     };
    
    //     await CapacitorHttp.request(options);
    //   }
    // };

    const updateEmployeeDiscount = async () => {
      if (!employeeDiscount || !employeeDiscount.cart_adjustments?.value) return;
    
      const discountRate = employeeDiscount.cart_adjustments.value / 100;
    
      for (const item of checkoutItems) {
        const basePrice = item.price_after_premium ?? item.price_after_points ?? Number(item.price);
    
        const staffDiscountAmount = basePrice * discountRate;
        const finalPrice = basePrice - staffDiscountAmount;
    
        const url = `https://app.alleaves.com/api/order/${id_order}/item/${item.id_item}`;
        const headers = {
          Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json; charset=utf-8',
        };
    
        const options = {
          url,
          method: 'PUT',
          headers,
          data: {
            price_override: finalPrice,
            price_override_reason: 'Points + Staff discount applied',
          },
        };
    
        await CapacitorHttp.request(options);
      }
    };
    
    
  
    return (async () => {
      try {
        await getUserInfo();

        if (user_info?.role === 'employee' || user_info?.role === 'admin') {
          employeeDiscount = await this.fetchActiveEmployeeDiscount();
        }

        await createOrder();
        await addItemsToOrder();
        await updateOrderItemPrices();
        await updatePremiumDiscounts();
        await updateEmployeeDiscount();
        return { user_info, id_order, checkoutItems, subtotal };
      } catch (error) {
        console.error('Checkout process failed:', error);
        throw error;
      }
    })();
  }
  

  // checkout(points_redeem: number, orderType: string, deliveryAddress: any): Observable<any> {
  //   const cartItems = this.getCart();
  //   const unmatchedItems = [...cartItems]; 
  //   const matchedCart: any[] = [];
  //   let skip = 0;
  //   const take = 5000;
  
  //   let id_order = 0;
  //   let tax_amount = 0;
  //   let subtotal = 0;
  //   let user_info: any;
  //   let id_customer: any;
  //   let checkoutItems: any[] = [];
  
  // const fetchAndMatch = (): Observable<any[]> => {
  //   return this.fetchInventory(skip, take).pipe(
  //     switchMap((inventoryResponse) => {
  //       // Match items
  //       inventoryResponse.forEach((inventoryItem: any) => {
  //         const matchIndex = unmatchedItems.findIndex(
  //           (cartItem) => +cartItem.posProductId === inventoryItem.id_item
  //         );

  //         if (matchIndex !== -1) {
  //           matchedCart.push({
  //             ...unmatchedItems[matchIndex],
  //             id_batch: inventoryItem.id_batch,
  //           });
  //           unmatchedItems.splice(matchIndex, 1);
  //         }
  //       });

  //       // If there are unmatched items, fetch the next batch
  //       if (unmatchedItems.length > 0 && inventoryResponse.length > 0) {
  //         skip += take;
  //         return fetchAndMatch();
  //       }

  //       // Return the matched cart when all batches are processed
  //       return of(matchedCart);
  //     }),
  //     catchError((error) => {
  //       console.error('Error during inventory matching:', error);
  //       return throwError(() => error);
  //     })
  //   );
  // };


  // const getUserInfo = (): Observable<any> => {
  //   return this.authService.getUserInfo().pipe(
  //     map((info) => {
  //       user_info = info;
  //     }),
  //     catchError((error) => {
  //       console.error('Error fetching user info or creating customer:', error);
  //       return throwError(() => error);
  //     })
  //   );
  // };

  // // Step 2: Create Order
  // const createOrder = (): Observable<any> => {
  //   const orderDetails = {
  //     id_customer: user_info.alleaves_customer_id, // Replace with actual customer ID
  //     id_external: null,
  //     id_location: 1000,
  //     id_status: 1,
  //     type: orderType, 
  //     use_type: 'adult',
  //     auto_apply_discount_exclusions: [],
  //     delivery_address: orderType === 'delivery' ? deliveryAddress : null,
  //     pickup_date: null,
  //     pickup_time: null,
  //     apply_delivery_fee: null,
  //     delivery_fee: 0,
  //     complete: false,
  //     void: false,
  //     void_reason: null,
  //     void_reason_other: null,
  //     verified: false,
  //     verified_by: null,
  //     packed: false,
  //     packed_by: null,
  //     scheduled: false,
  //     scheduled_by: null,
  //     id_user_working: null,
  //   };

  //   return this.createOrder(orderDetails).pipe(
  //     tap((response) => {
  //       id_order = response.id_order;
  //       // console.log('Order Created:', response);
  //     }),
  //     catchError((error) => {
  //       console.error('Error creating order:', error);
  //       return throwError(() => error);
  //     })
  //   );
  // };

  // // Step 3: Add Checkout Items to Order
  // const addItemsToOrder = (orderId: number): Observable<any[]> => {
  //   return this.addCheckoutItemsToOrder(orderId, checkoutItems).pipe(
  //     tap((responses) => {
  //       // console.log("Add Items to order responses", responses)
  //       // Calculate the total subtotal
  //       const totalSubtotal = responses.reduce(
  //         (acc: number, item: any) => {
  //           if (item) {
  //             acc += item.price || 0;
  //           }
  //           return acc;
  //         },
  //         0 // Initial value for subtotal
  //       );

  //       // Set the external subtotal variable
  //       subtotal = totalSubtotal;
  //     }),
  //     catchError((error) => {
  //       console.error('Error adding items to order:', error);
  //       return throwError(() => error);
  //     })
  //   );
  // };

  // const updateOrderItemPrices = (orderId: number, items: any[]): Observable<any> => {
  //   let remainingDiscount = points_redeem / 20;
  //   const sortedItems = [...items].sort((a, b) => b.price - a.price);

  //   const updateRequests = sortedItems.map((item) => {
  //     if (remainingDiscount <= 0) {
  //       return of(null);
  //     }
  //     const discountAmount = Math.min(item.price, remainingDiscount);
  //     remainingDiscount -= discountAmount;
  //     const priceOverride = item.price - discountAmount;

  //     const body = {
  //       price_override: priceOverride,
  //       price_override_reason: 'Points redemption applied'
  //     };

  //     const url = `https://app.alleaves.com/api/order/${orderId}/item/${item.id_item}`;

  //     const headers = new HttpHeaders({
  //       Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
  //       'Content-Type': 'application/json; charset=utf-8',
  //       accept: 'application/json; charset=utf-8',
  //     });

  //     return this.http.put(url, body, { headers }).pipe(
  //       // tap(() => console.log(`Updated item ${item.id_item} price to ${priceOverride}`)),
  //       catchError((error) => {
  //         console.error(`Error updating item ${item.id_item} price:`, error);
  //         return throwError(() => error);
  //       })
  //     );
  //   });

  //   return forkJoin(updateRequests);
  // };


  // return getUserInfo().pipe(
  //   switchMap(() => fetchAndMatch()),
  //   switchMap((matched) => {
  //     checkoutItems = matched;
  //     return createOrder();
  //   }),
  //   switchMap((orderResponse) => 
  //     addItemsToOrder(orderResponse.id_order)
  //   ),
  //   switchMap((addedItemsWithIds) => {
  //     checkoutItems = addedItemsWithIds; // Store items with id_item
  //     return updateOrderItemPrices(id_order, checkoutItems);
  //   }),
  //   map(() => ({
  //     user_info,
  //     id_order,
  //     checkoutItems,
  //     subtotal,
  //   })),
  //   catchError((error) => {
  //     console.error('Checkout process failed:', error);
  //     return throwError(() => error);
  //   })
  // );
  // }
  

  // Save the cart back to sessionStorage and notify subscribers
  private saveCart(cart: CartItem[]) {
    sessionStorage.setItem(this.cartKey, JSON.stringify(cart));
    this.cartSubject.next(cart); // Emit the updated cart
  }



  async fetchInventory(skip: number, take: number) {
    const headers = {
      Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json; charset=utf-8',
    };
  
    const body = { skip, take };
    const apiUrl = 'https://app.alleaves.com/api/inventory/search';
  
    const options = {
      url: apiUrl,
      method: 'POST',
      headers: headers,
      data: body,
    };
  
    return CapacitorHttp.request(options)
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.error('Error fetching inventory:', error);
        throw error;
      });
  }

  async createCustomer(userDetails: any) {
      const headers = {
        Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json; charset=utf-8',
      };
    
      // API URL for creating a customer
      const apiUrl = 'https://app.alleaves.com/api/customer';
    
      const options = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        data: userDetails,
      };
    
      return CapacitorHttp.request(options)
        .then((response) => {
          return response.data;
        })
        .catch((error) => {
          console.error('Error creating User:', error);
          throw error;
        });
    }

    // Function to create an order
    async createOrder(orderDetails: any) {
      const headers = {
        Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json; charset=utf-8',
      };
    
      // API URL for creating an order
      const apiUrl = 'https://app.alleaves.com/api/order';
    
      const options = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        data: orderDetails,
      };
    
      return CapacitorHttp.request(options)
        .then((response) => {
          return response.data;
        })
        .catch((error) => {
          console.error('Error creating order:', error);
          throw error;
        });
    }

    async addCheckoutItemsToOrder(idOrder: number, checkoutItems: any[]) {
      console.log(checkoutItems)
      const headers = {
        Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json; charset=utf-8',
      };
    
      const apiUrl = `https://app.alleaves.com/api/order/${idOrder}/item`;
      const addedItems: any[] = [];
    
      for (const item of checkoutItems) {
        console.log(item)
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
    
          if (response?.data?.items?.length > 0) {
            // Only push unique items based on `id_item`
            response.data.items.forEach((resItem: any) => {
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
          continue;
        }
      }
    
      return addedItems;
    }

  async placeOrder(user_id: number, pos_order_id: number, points_add: number, points_redeem: number, amount: number, cart: any) {
    const payload = { user_id, pos_order_id, points_add, points_redeem, amount, cart };
  
    const locationId = this.locationStateService.getLocationId();

    const sessionData = localStorage.getItem('sessionData');
    const token = sessionData ? JSON.parse(sessionData).token : null;
  
    if (!token) {
      throw new Error("No user logged in");
    }
  
    const headers = {
      Authorization: token,
      'Content-Type': 'application/json', // Ensure it's set
      Accept: 'application/json',
    };
    
    const options = {
      url: `${environment.apiUrl}/orders/create?location_id=${locationId}`,
      method: 'POST',
      headers: headers,
      data: payload,
    };
  
    return CapacitorHttp.request(options)
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.error('Error in placeOrder:', error);
        throw error;
      });
  }
  


  async updateOrder(id_order: number, pickup_date: any, pickup_time: any, subtotal: number, id_customer: number) {
    const payload = { id_order, pickup_date, pickup_time, id_customer, id_location: 1000 };
  
    const headers = {
      Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json; charset=utf-8',
    };
  
    const options = {
      url: `https://app.alleaves.com/api/order/${id_order}`,
      method: 'PUT',
      headers: headers,
      data: payload,
    };
  
    return CapacitorHttp.request(options)
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.error('Error in updateOrder:', error);
        throw error;
      });
  }  

  async fetchActiveEmployeeDiscount(): Promise<any | null> {
    const headers = {
      Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('authTokensAlleaves') || '{}')}`,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json; charset=utf-8',
    };
  
    const options = {
      url: 'https://app.alleaves.com/api/discount',
      method: 'GET',
      headers,
    };
  
    try {
      const response = await CapacitorHttp.request(options);
      const discounts = response.data || [];
  
      const staffDiscount = discounts.find((d: any) =>
        d.enabled &&
        d.cart_adjustments?.label?.toLowerCase() === 'staff' &&
        d.cart_adjustments?.type === 'percentage'
      );
  
      return staffDiscount || null;
    } catch (error) {
      console.error('Failed to fetch employee discounts:', error);
      return null;
    }
  }
  
    private getAlleavesCustomerCacheKey(locationId: string | null) {
        return `alleaves_customer_${locationId}`;
      }

    private async getOrCreateAlleavesCustomer(user: any): Promise<number> {
    const locationId = this.locationStateService.getLocationId();
    const cacheKey = this.getAlleavesCustomerCacheKey(locationId);

    // 1️⃣ Try cache first
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      return Number(cached);
    }

    // 2️⃣ Create customer in Alleaves (location-scoped via token)
    const customerPayload = {
      name_first: user.fname,
      name_last: user.lname,
      phone: user.phone,
      email: user.email,
      date_of_birth: user.dob
      // anything Alleaves requires
    };

    const created = await this.createCustomer(customerPayload);

    if (!created?.id_customer) {
      throw new Error('Failed to create Alleaves customer');
    }

    // 3️⃣ Cache for this session/location
    sessionStorage.setItem(cacheKey, created.id_customer);

    return created.id_customer;
  }


}

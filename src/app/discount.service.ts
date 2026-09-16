import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { CapacitorHttp } from '@capacitor/core';
import { environment } from 'src/environments/environment';
import { EcomDiscount, AlleavesCondition, FilterSet } from './discount/discount.model';
import { CartItem } from './cart.service';
import { Product } from './product/product.model';

@Injectable({
  providedIn: 'root',
})
export class DiscountService {
  private discountsSubject = new BehaviorSubject<EcomDiscount[]>([]);
  discounts$ = this.discountsSubject.asObservable();
  private fetched = false;

  /** Returns the currently cached discounts synchronously (empty array if not yet fetched). */
  getDiscounts(): EcomDiscount[] {
    return this.discountsSubject.value;
  }

  /** Fetch from the backend proxy once per session; returns cached after that. */
  fetchDiscounts(): Observable<EcomDiscount[]> {
    if (this.fetched) {
      return of(this.discountsSubject.value);
    }

    return new Observable<EcomDiscount[]>(observer => {
      CapacitorHttp.get({
        url: `${environment.apiUrl}/discount/alleaves-ecom`,
        headers: { 'x-auth-api-key': environment.db_api_key },
      })
        .then(response => {
          const discounts: EcomDiscount[] = response.data?.discounts || [];
          this.fetched = true;
          this.discountsSubject.next(discounts);
          observer.next(discounts);
          observer.complete();
        })
        .catch(err => {
          console.warn('DiscountService: failed to fetch ecom discounts', err);
          observer.next([]);
          observer.complete();
        });
    });
  }

  /**
   * Returns discounts whose filter_sets match this product.
   *
   * Matching rules:
   * - If admin set filter_brand (string name), it's applied as a global gate first.
   * - If filter_sets is empty: the discount matches all products.
   * - Otherwise: the product must satisfy AT LEAST ONE filter set (OR logic).
   *   Within a set, all defined criteria must match (AND logic):
   *     category → exact match (case-insensitive)
   *     weight   → numeric match after stripping units
   *     brand_ids → match product.brand_id; if brand_id unavailable, exclude
   */
  getProductDiscounts(product: Product, discounts: EcomDiscount[]): EcomDiscount[] {
    return discounts.filter(d => this.productMatchesDiscount(product, d));
  }

  private productMatchesDiscount(product: Product, d: EcomDiscount): boolean {
    // Admin-configured brand name: applied as a global gate
    if (d.filter_brand) {
      const productBrand = (product.brand || '').toUpperCase();
      if (!productBrand.includes(d.filter_brand.toUpperCase())) return false;
    }

    const sets = d.filter_sets;
    if (!sets || sets.length === 0) return true; // No filter sets = all products

    // Product must satisfy AT LEAST ONE filter set
    return sets.some(set => this.productMatchesFilterSet(product, set, d.filter_brand));
  }

  private productMatchesFilterSet(product: Product, set: FilterSet, adminBrand: string | null): boolean {
    return this.categoryMatches(product, set)
      && this.weightMatches(product, set)
      && this.brandIdMatches(product, set, adminBrand)
      && this.productIdMatches(product, set);
  }

  // Category check
  private categoryMatches(product: Product, set: FilterSet): boolean {
    if (!set.category) return true;
    return (product.category || '').toUpperCase() === set.category.toUpperCase();
  }

  // Weight check — strip units ("3.5 G" → "3.5") and compare as strings
  private weightMatches(product: Product, set: FilterSet): boolean {
    if (!set.weight) return true;
    const productWeight = (product.weight || '').replace(/[^\d.]/g, '');
    return productWeight === String(set.weight);
  }

  // Brand ID check (only when no admin filter_brand override handles it)
  private brandIdMatches(product: Product, set: FilterSet, adminBrand: string | null): boolean {
    if (adminBrand || !set.brand_ids || set.brand_ids.length === 0) return true;
    if (!product['brand_id']) return false; // Brand-restricted but can't verify without brand_id
    return set.brand_ids.includes(product['brand_id']);
  }

  // Product ID check — Alleaves catalog product IDs (id_item_group), matches posProductId
  private productIdMatches(product: Product, set: FilterSet): boolean {
    if (!set.product_ids || set.product_ids.length === 0) return true;
    const posProductId = Number(product.posProductId);
    return !!posProductId && set.product_ids.includes(posProductId);
  }

  /**
   * Compute which discounts are guaranteed to apply to the current cart — i.e. only
   * auto_apply discounts, since those are the ones the POS will actually apply, and this
   * list's dollar figures drive the real subtotal/tax/total math (see getDiscountedSubtotal).
   * Non-auto-apply deals still show as an informational badge on product cards, but are
   * deliberately excluded here so this financial list never promises a saving the register
   * won't actually give.
   *
   * A discount is shown if:
   * 1. Cart subtotal meets all conditions (e.g. minimum subtotal thresholds)
   * 2. If the discount has filter_sets, at least one cart item matches at least
   *    one filter set (so deals for categories you haven't bought don't clutter the banner)
   */
  getCartDiscounts(
    cartItems: CartItem[],
    discounts: EcomDiscount[]
  ): { discount: EcomDiscount; estimatedSavings: number | null }[] {
    const subtotal = cartItems.reduce(
      (sum, item) => sum + parseFloat(item.price) * item.quantity,
      0
    );

    return discounts
      .filter(d => {
        if (!d.auto_apply) return false;
        if (!this.cartMeetsConditions(d.conditions, subtotal)) return false;
        // If the discount targets specific products/categories, only show it
        // when the cart contains at least one qualifying item
        if (d.filter_sets && d.filter_sets.length > 0) {
          return cartItems.some(item =>
            this.productMatchesDiscount(item as any, d)
          );
        }
        return true;
      })
      .map(d => ({
        discount: d,
        estimatedSavings: this.estimateSavings(d, cartItems, subtotal),
      }));
  }

  /**
   * Cart subtotal after applying guaranteed (auto_apply) discounts. This is the number that
   * should drive tax/total/AeroPay-charge math — each item gets at most its single best
   * matching SALE discount (no stacking/double-counting), and any auto-apply CART-type
   * discount reduces the result further. Since it only ever uses discounts the POS is
   * guaranteed to apply automatically, this can't exceed what the real order will total.
   */
  getDiscountedSubtotal(cartItems: CartItem[], discounts: EcomDiscount[]): number {
    let subtotal = cartItems.reduce((sum, item) => {
      const unitPrice = this.getDiscountedPrice(item as any, discounts) ?? parseFloat(item.price);
      return sum + unitPrice * item.quantity;
    }, 0);

    const originalSubtotal = cartItems.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
    const cartDiscount = discounts.find(
      d => d.discount_type === 'CART' && d.auto_apply && d.discount_value != null
        && this.cartMeetsConditions(d.conditions, originalSubtotal)
    );

    if (cartDiscount?.discount_value != null) {
      if (cartDiscount.discount_value_type === 'percentage') subtotal -= subtotal * (cartDiscount.discount_value / 100);
      else if (cartDiscount.discount_value_type === 'flat') subtotal -= cartDiscount.discount_value;
    }

    return Math.max(0, subtotal);
  }

  /** Check if the cart subtotal satisfies all conditions for a discount. */
  private cartMeetsConditions(conditions: AlleavesCondition[], subtotal: number): boolean {
    if (!conditions || conditions.length === 0) return true;

    return conditions.every(c => {
      if (c.type === 'cart_subtotal' && c.options) {
        const { operator, value } = c.options;
        switch (operator) {
          case 'greater_than_or_equal': return subtotal >= value;
          case 'greater_than':          return subtotal > value;
          case 'less_than':             return subtotal < value;
          case 'less_than_or_equal':    return subtotal <= value;
          case 'equal':                 return subtotal === value;
        }
      }
      // Unknown condition type — assume met (POS handles final truth)
      return true;
    });
  }

  /** Estimate savings for display in the cart. Returns null when not calculable. */
  private estimateSavings(
    d: EcomDiscount,
    cartItems: CartItem[],
    subtotal: number
  ): number | null {
    if (!d.discount_value) return null;

    if (d.discount_type === 'CART') {
      if (d.discount_value_type === 'percentage') return subtotal * (d.discount_value / 100);
      if (d.discount_value_type === 'flat') return d.discount_value;
    }

    if (d.discount_type === 'SALE') {
      // Estimate against qualifying items using filter_sets for accurate matching
      const qualifying = cartItems.filter(item => this.productMatchesDiscount(item as any, d));
      const qualSubtotal = qualifying.reduce(
        (sum, item) => sum + parseFloat(item.price) * item.quantity,
        0
      );
      if (d.discount_value_type === 'percentage') return qualSubtotal * (d.discount_value / 100);
      if (d.discount_value_type === 'flat') return d.discount_value;
    }

    // BOGO / BULK savings are complex — signal as non-calculable client-side
    return null;
  }

  /**
   * The discount (if any) that should actually change what a customer is charged for
   * this product — i.e. a per-product SALE discount that Alleaves will apply
   * automatically at the register. Deliberately excludes:
   * - CART-type discounts (cart-wide %, not a per-unit price)
   * - BOGO/BULK/BUNDLE deals (not a simple per-unit price)
   * - Any discount with auto_apply === false — those require a staff member to apply
   *   manually at pickup, so charging a reduced price/total for them here would risk
   *   undercharging relative to what the POS actually rings up.
   */
  getPriceDiscount(product: Product, discounts: EcomDiscount[]): EcomDiscount | null {
    const candidates = this.getProductDiscounts(product, discounts).filter(
      d => d.discount_type === 'SALE' && d.auto_apply && d.discount_value != null && d.discount_value_type
    );
    if (!candidates.length) return null;

    // If more than one somehow matches, apply whichever gives the bigger discount.
    const original = parseFloat(product.price);
    if (isNaN(original)) return candidates[0];

    return candidates.reduce((best, d) =>
      this.applyDiscountValue(original, d) < this.applyDiscountValue(original, best) ? d : best
    );
  }

  /** Discounted unit price for a product, or null if no auto-apply SALE discount applies. */
  getDiscountedPrice(product: Product, discounts: EcomDiscount[]): number | null {
    const discount = this.getPriceDiscount(product, discounts);
    if (!discount) return null;

    const original = parseFloat(product.price);
    if (isNaN(original)) return null;

    return this.applyDiscountValue(original, discount);
  }

  private applyDiscountValue(originalPrice: number, d: EcomDiscount): number {
    if (d.discount_value_type === 'percentage') return Math.max(0, originalPrice * (1 - (d.discount_value! / 100)));
    if (d.discount_value_type === 'flat') return Math.max(0, originalPrice - d.discount_value!);
    return originalPrice;
  }

  /** Format a discount value for display (e.g. "25% OFF", "$4.20 OFF"). */
  formatDiscountLabel(d: EcomDiscount): string {
    if (!d.discount_value) return d.description;
    if (d.discount_value_type === 'percentage') return `${d.discount_value}% OFF`;
    if (d.discount_value_type === 'flat') return `$${d.discount_value} OFF`;
    return d.description;
  }

  /** Badge color class based on discount type. */
  badgeClass(type: string): string {
    switch (type) {
      case 'BOGO':   return 'badge-bogo';
      case 'BULK':   return 'badge-bulk';
      case 'BUNDLE': return 'badge-bundle';
      case 'SALE':   return 'badge-sale';
      case 'CART':   return 'badge-cart';
      default:       return 'badge-deal';
    }
  }
}

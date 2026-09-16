import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';

import { ProductsService } from '../products.service';

import { Product } from './product.model';
import { CartItem, CartService } from '../cart.service';
import { AuthService } from '../auth.service';
import { AccessibilityService } from '../accessibility.service';
import { DiscountService } from '../discount.service';
import { EcomDiscount } from '../discount/discount.model';

@Component({
  selector: 'app-product',
  templateUrl: './product.component.html',
  styleUrls: ['./product.component.scss'],
})
export class ProductComponent implements OnInit, OnChanges {
  constructor(
    private productService: ProductsService,
    private cartService: CartService,
    private authService: AuthService,
    private accessibilityService: AccessibilityService,
    private discountService: DiscountService
  ) {}

  @Input() product: Product = {
    id: '',
    posProductId: '',
    id_batch: '',
    category: 'FLOWER',
    title: '',
    brand: '',
    desc: '',
    strainType: 'HYBRID',
    thc: '',
    weight: '',
    price: '',
    image: '',
  };

  @Input() activeDiscounts: EcomDiscount[] = [];

  isLoggedIn: boolean = false;
  isAdded: boolean = false;

  matchingDiscounts: EcomDiscount[] = [];
  discountedPrice: number | null = null;

  ngOnInit() {
    this.authService.isLoggedIn().subscribe(status => this.isLoggedIn = status);
    this.updateDiscounts();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['product'] || changes['activeDiscounts']) {
      this.updateDiscounts();
    }
  }

  private updateDiscounts() {
    this.matchingDiscounts = this.product && this.activeDiscounts?.length
      ? this.discountService.getProductDiscounts(this.product, this.activeDiscounts)
      : [];
    this.discountedPrice = this.product && this.activeDiscounts?.length
      ? this.discountService.getDiscountedPrice(this.product, this.activeDiscounts)
      : null;
  }

  /** The single best discount to badge — highest priority first, falling back to the first match. */
  get primaryDiscount(): EcomDiscount | null {
    return this.matchingDiscounts[0] || null;
  }

  get discountBadgeLabel(): string {
    return this.primaryDiscount ? this.discountService.formatDiscountLabel(this.primaryDiscount) : '';
  }

  get discountBadgeClass(): string {
    return this.primaryDiscount ? this.discountService.badgeClass(this.primaryDiscount.discount_type) : '';
  }

  updateProductDisplay() {
    this.productService.updateCurrentProduct(this.product);
    this.accessibilityService.announce(`Viewing details for ${this.product.title}.`, 'polite');
  }

  addToCart(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    if (this.isAdded) return;

    const cartItem: CartItem = { ...this.product, quantity: 1 };
    this.cartService.addToCart(cartItem);

    this.isAdded = true;
    setTimeout(() => (this.isAdded = false), 2000);

    this.accessibilityService.announce(`${this.product.title} added to your cart.`, 'assertive');
  }

  getProductImage(product: any): string {
    if (product.image) {
      return product.image;
    }
    return 'assets/default.png';
  }
}

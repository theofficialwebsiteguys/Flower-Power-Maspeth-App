import { Component, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';

import { ProductsService } from '../products.service';

import { Product } from '../product/product.model';
import { CartService } from '../cart.service';
import { AuthService } from '../auth.service';
import { AccessibilityService } from '../accessibility.service';

@Component({
  selector: 'app-single-product',
  templateUrl: './single-product.component.html',
  styleUrls: ['./single-product.component.scss'],
})
export class SingleProductComponent implements OnInit {
  currentProduct: Product = {
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
    quantity: 0,
    image: '',
  };

  showFullDescription = false;
  quantity = 1; 

  isLoggedIn: boolean = false;

  constructor(
    private productService: ProductsService,
    private cartService: CartService,
    private authService: AuthService,
    private location: Location,
    private router: Router,
    private toastController: ToastController,
    private accessibilityService: AccessibilityService
  ) {}

  ngOnInit() {
    this.productService.currentProduct$.subscribe((product) => {
      if (product) {
        this.currentProduct = product;
        this.quantity = 1; 
        this.accessibilityService.announce(`Now viewing ${product.title} by ${product.brand}.`, 'polite');
      } else {
        this.router.navigateByUrl('/home');
      }
    });

    this.authService.isLoggedIn().subscribe(status => {
      this.isLoggedIn = status;
    });
  }

  ngOnDestroy(){
    this.quantity = 1;
  }

  toggleDescription() {
    this.showFullDescription = !this.showFullDescription;
    const message = this.showFullDescription ? 'Full description shown.' : 'Description collapsed.';
    this.accessibilityService.announce(message, 'polite');
  }

  getDescription(): string {
    if (!this.currentProduct.desc) {
      return '';
    }
    return this.showFullDescription || this.currentProduct.desc.length <= 75
      ? this.currentProduct.desc
      : this.currentProduct.desc.substring(0, 75) + '...';
  }

  goBack() {
    this.location.back();
    this.accessibilityService.announce('Returned to the previous page.', 'polite');
  }

  incrementQuantity() {
    if (this.quantity < this.currentProduct['quantity'] ) {
      this.quantity++;
      this.accessibilityService.announce(`Quantity increased to ${this.quantity}.`, 'polite');
    }
  }

  decrementQuantity() {
    if (this.quantity > 1) {
      this.quantity--;
      this.accessibilityService.announce(`Quantity decreased to ${this.quantity}.`, 'polite');
    }
  }

  async addToCart() {
    const cartItem = {
      ...this.currentProduct,
      quantity: this.quantity,
    };

    this.cartService.addToCart(cartItem);
    this.accessibilityService.announce(`${this.currentProduct.title} added to cart. Quantity: ${this.quantity}.`, 'assertive');

    const toast = await this.toastController.create({
      message: `${this.currentProduct.title} added to cart`,
      duration: 2000,
      color: 'success',
      position: 'bottom',
      cssClass: 'custom-toast',
    });
    await toast.present();
  }
  
  getProductImage(product: any): string {
    if (product.image) {
      return product.image;
    }
    return 'assets/default.png';
  }
  
}

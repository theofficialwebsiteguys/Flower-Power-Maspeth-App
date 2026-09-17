import { Component, OnInit } from '@angular/core';

import { ProductsService } from '../products.service';

import { CategoryWithImage, ProductCategory } from '../product-category/product-category.model';
import { Product } from '../product/product.model';
import { AccessibilityService } from '../accessibility.service';

@Component({
  selector: 'app-card-slider',
  templateUrl: './card-slider.component.html',
  styleUrls: ['./card-slider.component.scss'],
})
export class CardSliderComponent implements OnInit {
  products: Product[] = [];
  categories: CategoryWithImage[] = [];
  loading: boolean = true; // Add loading state

  constructor(private readonly productService: ProductsService, private accessibilityService: AccessibilityService) {}

  ngOnInit() {
    this.productService.getCategories$().subscribe((cats) => {
      this.categories = cats;
    });

    this.productService.getProducts().subscribe((products) => {
      this.products = products;
      this.loading = false; // Set loading to false when data is retrieved
    });
  }

  getLimitedProducts(category: string) {
    return this.products.filter(product => product.category === category).slice(0, 9);
  }

  getTotalProducts(category: string) {
    return this.products.filter(product => product.category === category).length;
  }

  updateCategory(category?: ProductCategory) {
    if (category) {
      this.productService.updateCategory(category);
      this.accessibilityService.announce(`Category changed to ${category}`, 'polite');
    }
  }

  updateProductDisplay(product: Product) {
    this.productService.updateCurrentProduct(product);
    this.accessibilityService.announce(`Viewing product ${product.title}`, 'polite');
  }

  getProductImage(product: any): string {
    if (product.image) {
      return product.image;
    }
    return 'assets/default.png';
  }
}

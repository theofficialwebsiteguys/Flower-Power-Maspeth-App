import { Component, Input, OnInit, SimpleChanges } from '@angular/core';
import { Observable, of, startWith, tap } from 'rxjs';

import { ProductsService } from '../products.service';

import { Product } from '../product/product.model';
import { ProductCategory } from '../product-category/product-category.model';
import { AccessibilityService } from '../accessibility.service';
import { DiscountService } from '../discount.service';
import { EcomDiscount } from '../discount/discount.model';

@Component({
  selector: 'app-product-list',
  templateUrl: './product-list.component.html',
  styleUrls: ['./product-list.component.scss'],
})
export class ProductListComponent implements OnInit {

  @Input() showSimilarItems: boolean = false;
  @Input() searchQuery: string = '';

  constructor(
    private productService: ProductsService,
    private accessibilityService: AccessibilityService,
    private discountService: DiscountService
  ) {}

  currentCategory: ProductCategory = 'PREROLL';
  products$: Observable<Product[]> = of([]);

  activeDiscounts: EcomDiscount[] = [];

  hasLoaded = false;

  // Placeholder count while the skeleton grid is showing.
  skeletonItems = [1, 2, 3, 4, 5, 6];

  ngOnInit() {
    this.updateProducts();

    this.productService.currentCategory$.subscribe((category) => {
      this.currentCategory = category;
      this.updateProducts();
      this.accessibilityService.announce(`Category updated to ${category}.`, 'polite');
    });

    this.productService.currentProductFilters$.subscribe(() => {
      this.updateProducts();
      this.accessibilityService.announce('Product filters updated.', 'polite');
    });

    this.discountService.fetchDiscounts().subscribe((discounts) => {
      this.activeDiscounts = discounts;
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['searchQuery']) {
      this.updateProducts();
    }

    if (changes['showSimilarItems']) {
      this.updateProducts();
      const message = this.showSimilarItems ? 'Displaying similar items.' : 'Displaying filtered products.';
      this.accessibilityService.announce(message, 'polite');
    }
  }

  private updateProducts() {
    this.hasLoaded = false;

    const productStream = this.showSimilarItems
      ? this.productService.getSimilarItems()
      : this.productService.getFilteredProducts(this.searchQuery);

    this.products$ = productStream.pipe(
      startWith([]),
      tap(() => this.hasLoaded = true)
    );
  }

  onSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchQuery = target.value.trim();
    this.updateProducts();
  }

  isCategoryVisible(category: string): boolean {
    return this.searchQuery.trim() !== '' || category === this.currentCategory;
  }
}

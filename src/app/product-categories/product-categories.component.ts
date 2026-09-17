import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';

import { ProductsService } from '../products.service';

import { CategoryWithImage } from '../product-category/product-category.model';

@Component({
  selector: 'app-product-categories',
  templateUrl: './product-categories.component.html',
  styleUrls: ['./product-categories.component.scss'],
})
export class ProductCategoriesComponent implements OnInit, OnDestroy {
  constructor(private productService: ProductsService) {}

  categories: CategoryWithImage[] = [];
  private categorySub?: Subscription;

  ngOnInit() {
    this.categorySub = this.productService.getCategories$().subscribe((cats) => {
      this.categories = cats;
    });
  }

  ngOnDestroy() {
    this.categorySub?.unsubscribe();
  }
}

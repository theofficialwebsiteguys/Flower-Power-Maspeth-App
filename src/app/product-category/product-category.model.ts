export type ProductCategory =
  | 'FLOWER'
  | 'PREROLL'
  | 'VAPORIZERS'
  | 'VAPE'
  | 'CONCENTRATES'
  | 'BEVERAGE'
  | 'TINCTURES'
  | 'EDIBLE'
  | 'TOPICAL'
  | 'ACCESSORIES'
  | 'CBD';

  export interface CategoryWithImage {
    category: ProductCategory;
    imageUrl: string;
  }
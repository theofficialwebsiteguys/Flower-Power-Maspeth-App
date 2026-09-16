export type DiscountType = 'BOGO' | 'BULK' | 'BUNDLE' | 'SALE' | 'CART' | 'DEAL';

/**
 * One logical filter group derived from the Alleaves `filters` array.
 * A product matches the discount if it satisfies ANY FilterSet (OR across sets,
 * AND within a set). Enables multi-category bundle deals like "28g Flower + 1g Vape".
 */
export interface FilterSet {
  category: string | null;
  weight: string | null;
  brand_ids: number[];
  /** Alleaves catalog product IDs (id_item_group) this set is scoped to — matches Product.posProductId */
  product_ids: number[];
}

export interface EcomDiscount {
  id: number;
  title: string;
  description: string;
  discount_type: DiscountType;
  /** Numeric value of the discount (e.g. 25 for 25%, 4.20 for $4.20) */
  discount_value: number | null;
  /** 'percentage' | 'flat' */
  discount_value_type: string | null;
  banner_image_url: string | null;
  /** Primary category for Offers-page navigation (null for multi-category bundle deals) */
  filter_category: string | null;
  /** Admin-configured brand name for display/navigation overrides */
  filter_brand: string | null;
  /** Alleaves brand IDs aggregated from all filter sets */
  filter_brand_ids: number[];
  /** Primary weight for single-set discounts (null for multi-combo deals) */
  filter_weight: string | null;
  /**
   * Structured filter sets for precise product badge matching.
   * Each entry = one { category, weight, brand_ids } combo.
   * Product matches the discount if it satisfies ANY set (OR logic).
   */
  filter_sets: FilterSet[];
  /** Human-readable filter hint ("Flower · 3.5g", "Flower 28g + Vape 1g", "All Products") */
  filter_hint: string;
  auto_apply: boolean;
  sort_order: number;
  /** Raw Alleaves conditions for client-side cart eligibility checks */
  conditions: AlleavesCondition[];
  /** Raw Alleaves filters array */
  filters: AlleavesFilter[];
}

export interface AlleavesCondition {
  type: string; // e.g. 'cart_subtotal'
  options?: {
    operator: string;
    value: number;
  };
}

export interface AlleavesFilter {
  type: string; // 'category' | 'weight' | 'brand' | 'all_products'
  method?: string;
  value?: number[];
}

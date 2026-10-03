import { describe, expect, expectTypeOf, it } from 'vitest';
import { PAGE_TYPES, ROLES, type PageType, type Role } from '../src/index.ts';

describe('content vocabularies', () => {
  it('lists every page type', () => {
    expect(PAGE_TYPES).toEqual(['home', 'listing', 'search', 'product', 'cart', 'checkout', 'account', 'help', 'content', 'other']);
    expectTypeOf<PageType>().toEqualTypeOf<(typeof PAGE_TYPES)[number]>();
  });

  it('lists every content role', () => {
    expect(ROLES).toEqual([
      'nav', 'search', 'filter', 'sort', 'product_card', 'product_image', 'product_title', 'price', 'variant', 'quantity',
      'add_to_cart', 'buy_now', 'wishlist', 'reviews', 'shipping', 'returns', 'size_guide', 'form', 'error', 'modal', 'chat',
      'cta', 'cart', 'checkout', 'heading', 'text', 'media', 'footer',
    ]);
    expectTypeOf<Role>().toEqualTypeOf<(typeof ROLES)[number]>();
  });

  it('has no duplicates', () => {
    expect(new Set(PAGE_TYPES).size).toBe(PAGE_TYPES.length);
    expect(new Set(ROLES).size).toBe(ROLES.length);
  });
});

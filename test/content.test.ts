import { describe, expect, expectTypeOf, it } from 'vitest';
import { PAGE_TYPES, ROLES, SITE_KINDS, type PageType, type Role, type SiteKind } from '../src/index.ts';

describe('content vocabularies', () => {
  it('lists every site kind', () => {
    expect(SITE_KINDS).toEqual([
      'ecommerce', 'marketplace', 'saas', 'content_media', 'lead_gen', 'travel_booking', 'finance', 'education', 'healthcare',
      'real_estate', 'jobs', 'community', 'government', 'nonprofit', 'other',
    ]);
    expectTypeOf<SiteKind>().toEqualTypeOf<(typeof SITE_KINDS)[number]>();
  });

  it('lists functional page types that apply to every kind of site', () => {
    expect(PAGE_TYPES).toEqual([
      'home', 'landing', 'listing', 'search', 'detail', 'compare', 'pricing', 'cart', 'checkout', 'confirmation', 'signup',
      'login', 'account', 'app', 'form', 'help', 'article', 'media', 'legal', 'error', 'other',
    ]);
    expectTypeOf<PageType>().toEqualTypeOf<(typeof PAGE_TYPES)[number]>();
  });

  it('lists generic content roles, with commerce roles as specialisations', () => {
    expect(ROLES).toEqual([
      'nav', 'breadcrumb', 'search', 'filter', 'sort', 'pagination', 'item_card', 'item_media', 'item_title', 'price',
      'variant', 'quantity', 'plan_table', 'comparison', 'primary_cta', 'secondary_cta', 'add_to_cart', 'buy_now',
      'signup_cta', 'contact_cta', 'book_cta', 'download_cta', 'wishlist', 'reviews', 'testimonial', 'trust', 'faq',
      'shipping', 'returns', 'size_guide', 'form', 'login_form', 'error', 'modal', 'chat', 'cookie_banner', 'paywall',
      'video', 'cart', 'checkout', 'heading', 'text', 'media', 'footer',
    ]);
    expectTypeOf<Role>().toEqualTypeOf<(typeof ROLES)[number]>();
  });

  it('has no duplicates', () => {
    for (const list of [SITE_KINDS, PAGE_TYPES, ROLES]) expect(new Set(list).size).toBe(list.length);
  });
});

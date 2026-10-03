/**
 * Shared vocabularies for what a page is and what its parts do. An SDK labels the current page with one `PageType`
 * and its regions with `Role`s (never their text); a server validates incoming labels against the same lists.
 * Append only: a stored label must keep its meaning.
 */
export const PAGE_TYPES = ['home', 'listing', 'search', 'product', 'cart', 'checkout', 'account', 'help', 'content', 'other'] as const;

export type PageType = (typeof PAGE_TYPES)[number];

export const ROLES = [
  'nav', 'search', 'filter', 'sort', 'product_card', 'product_image', 'product_title', 'price', 'variant', 'quantity',
  'add_to_cart', 'buy_now', 'wishlist', 'reviews', 'shipping', 'returns', 'size_guide', 'form', 'error', 'modal', 'chat',
  'cta', 'cart', 'checkout', 'heading', 'text', 'media', 'footer',
] as const;

export type Role = (typeof ROLES)[number];

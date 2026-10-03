/**
 * Shared vocabularies for what a site is, what a page is for and what its parts do. They are platform- and
 * industry-neutral: an SDK labels the current page with one `PageType` and its regions with `Role`s (never their
 * text); a server validates incoming labels against the same lists. Append only once released: a stored label must
 * keep its meaning.
 */

/** What kind of site it is (set per site, not detected per page). */
export const SITE_KINDS = [
  'ecommerce', 'marketplace', 'saas', 'content_media', 'lead_gen', 'travel_booking', 'finance', 'education', 'healthcare',
  'real_estate', 'jobs', 'community', 'government', 'nonprofit', 'other',
] as const;

export type SiteKind = (typeof SITE_KINDS)[number];

/**
 * What a page is for, by function rather than industry: `detail` is one item (a product, property, job, hotel room,
 * plan, event or profile); `listing` is many; `confirmation` is any thank-you or order-complete page; `app` is the
 * signed-in product itself.
 */
export const PAGE_TYPES = [
  'home', 'landing', 'listing', 'search', 'detail', 'compare', 'pricing', 'cart', 'checkout', 'confirmation', 'signup',
  'login', 'account', 'app', 'form', 'help', 'article', 'media', 'legal', 'error', 'other',
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

/**
 * What a region of a page does. Generic roles (`item_card`, `primary_cta`) apply everywhere; typed calls to action
 * and commerce roles (`add_to_cart`, `size_guide`) are specialisations used when they are recognisable.
 */
export const ROLES = [
  'nav', 'breadcrumb', 'search', 'filter', 'sort', 'pagination', 'item_card', 'item_media', 'item_title', 'price',
  'variant', 'quantity', 'plan_table', 'comparison', 'primary_cta', 'secondary_cta', 'add_to_cart', 'buy_now',
  'signup_cta', 'contact_cta', 'book_cta', 'download_cta', 'wishlist', 'reviews', 'testimonial', 'trust', 'faq',
  'shipping', 'returns', 'size_guide', 'form', 'login_form', 'error', 'modal', 'chat', 'cookie_banner', 'paywall',
  'video', 'cart', 'checkout', 'heading', 'text', 'media', 'footer',
] as const;

export type Role = (typeof ROLES)[number];

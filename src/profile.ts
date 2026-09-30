import type { Action, Profile } from './types.ts';

/**
 * Auto-detect the site vertical and page action from the DOM. This is only a weak prior —
 * explicit `profile` config wins, and the server corrects per-site priors over time.
 */
export interface PageContext {
  profile: Profile;
  action: Action;
  /** Payment fields/processor present → PCI-lite mode. */
  payment: boolean;
  hints: string[];
}

/** The site vertical and the hint that gave it away; the first match wins. */
function verticalOf(w: Window, has: (sel: string) => boolean, scripts: string, payment: boolean): [Profile, string?] {
  // Globals set by the page's own scripts (Shopify, Google Publisher Tag, Prebid).
  const globals = w as Window & { Shopify?: unknown; googletag?: unknown; pbjs?: unknown };
  if (globals.Shopify || /cdn\.shopify\.com/.test(scripts) || has('form[action*="/cart/add"]')) return ['ecommerce', 'shopify'];
  if (has('[itemtype*="schema.org/Product"], [data-product-id], .woocommerce, form[action*="add-to-cart"]')) return ['ecommerce', 'product'];
  if (has('meta[property="og:type"][content="article"]') || globals.googletag || globals.pbjs) return ['content', 'article/ads'];
  if (has('.hs-form, form[id^="hsForm_"], form.mktoForm') || /[?&](gclid|fbclid|msclkid)=/.test(w.location.search)) return ['leadgen', 'leadform'];
  if (has('[contenteditable="true"], textarea[name*="comment" i], form[action*="comment"]')) return ['social', 'ugc'];
  return [payment ? 'payments' : 'generic'];
}

/** The page's action from payment fields, password inputs, the path and the query. */
function actionOf(path: string, search: string, pw: number, payment: boolean): Action {
  if (payment) return 'payment';
  if (/\/checkouts?\b|\/pay\b/.test(path)) return 'checkout';
  if (pw >= 2 || /sign-?up|register|create-account|join/.test(path)) return 'signup';
  if (pw === 1 || /log-?in|sign-?in/.test(path)) return 'login';
  if (/\/cart\b/.test(path)) return 'add_to_cart';
  if (/forgot|reset-password/.test(path)) return 'password_reset';
  return /[?&](q|s|query|search)=/.test(search) || /\/search\b/.test(path) ? 'search' : 'pageview';
}

export function detectPage(w: Window, explicit?: Profile): PageContext {
  const doc = w.document;
  const hints: string[] = [];
  const has = (sel: string) => { try { return !!doc.querySelector(sel); } catch { return false; } };
  const scripts = Array.from(doc.scripts).map((script) => script.src).join(' ');

  const payment = /js\.stripe\.com|braintreegateway|checkoutshopper|adyen|paypal\.com\/sdk/.test(scripts)
    || has('iframe[name^="__privateStripeFrame"], [autocomplete^="cc-"], input[name*="cardnumber" i]');
  if (payment) hints.push('payment');

  const [vertical, hint] = verticalOf(w, has, scripts, payment);
  let profile = vertical;
  if (hint) hints.push(hint);
  const path = w.location.pathname.toLowerCase();
  const action = actionOf(path, w.location.search, doc.querySelectorAll('input[type="password"]').length, payment);

  if (explicit) profile = explicit;
  else if (profile === 'generic' && (action === 'login' || action === 'signup') && /app\.|dashboard|console/.test(w.location.host + path)) profile = 'saas';
  return { profile, action, payment, hints };
}

const ACTION_RE = /^[A-Za-z0-9/_]{1,64}$/;
export const validAction = (action: string): boolean => ACTION_RE.test(action);

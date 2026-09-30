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

export function detectPage(w: Window, explicit?: Profile): PageContext {
  const doc = w.document;
  const hints: string[] = [];
  const has = (sel: string) => { try { return !!doc.querySelector(sel); } catch { return false; } };
  const scripts = Array.from(doc.scripts).map((script) => script.src).join(' ');
  // Globals set by the page's own scripts (Shopify, Google Publisher Tag, Prebid).
  const globals = w as Window & { Shopify?: unknown; googletag?: unknown; pbjs?: unknown };

  const payment = /js\.stripe\.com|braintreegateway|checkoutshopper|adyen|paypal\.com\/sdk/.test(scripts)
    || has('iframe[name^="__privateStripeFrame"], [autocomplete^="cc-"], input[name*="cardnumber" i]');
  if (payment) hints.push('payment');

  let profile: Profile = 'generic';
  if (globals.Shopify || /cdn\.shopify\.com/.test(scripts) || has('form[action*="/cart/add"]')) { profile = 'ecommerce'; hints.push('shopify'); }
  else if (has('[itemtype*="schema.org/Product"], [data-product-id], .woocommerce, form[action*="add-to-cart"]')) { profile = 'ecommerce'; hints.push('product'); }
  else if (has('meta[property="og:type"][content="article"]') || globals.googletag || globals.pbjs) { profile = 'content'; hints.push('article/ads'); }
  else if (has('.hs-form, form[id^="hsForm_"], form.mktoForm') || /[?&](gclid|fbclid|msclkid)=/.test(w.location.search)) { profile = 'leadgen'; hints.push('leadform'); }
  else if (has('[contenteditable="true"], textarea[name*="comment" i], form[action*="comment"]')) { profile = 'social'; hints.push('ugc'); }
  else if (payment) profile = 'payments';

  const path = w.location.pathname.toLowerCase();
  const pw = doc.querySelectorAll('input[type="password"]').length;
  let action: Action = 'pageview';
  if (payment || /\/checkouts?\b|\/pay\b/.test(path)) action = payment ? 'payment' : 'checkout';
  else if (pw >= 2 || /sign-?up|register|create-account|join/.test(path)) action = 'signup';
  else if (pw === 1 || /log-?in|sign-?in/.test(path)) action = 'login';
  else if (/\/cart\b/.test(path)) action = 'add_to_cart';
  else if (/forgot|reset-password/.test(path)) action = 'password_reset';
  else if (/[?&](q|s|query|search)=/.test(w.location.search) || /\/search\b/.test(path)) action = 'search';

  if (explicit) profile = explicit;
  else if (profile === 'generic' && (action === 'login' || action === 'signup') && /app\.|dashboard|console/.test(w.location.host + path)) profile = 'saas';
  return { profile, action, payment, hints };
}

const ACTION_RE = /^[A-Za-z0-9/_]{1,64}$/;
export const validAction = (action: string): boolean => ACTION_RE.test(action);

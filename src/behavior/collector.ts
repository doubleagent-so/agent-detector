import { Ring, type TraceEvent } from './trace.ts';

/**
 * Passive, capture-phase listeners. All handlers are O(1) and passive; nothing reads input values.
 * `pciLite` keeps only timing for card fields: no input lengths and no field slots.
 */
export interface CollectorOptions {
  pciLite?: boolean;
  now?: () => number;
}

const hashCode = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h & 0xffff;
};

const isEditable = (el: EventTarget | null): el is HTMLElement => {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable === true;
};

// Inputs whose value is typed text. Sliders, checkboxes and pickers fire `input` with no `beforeinput`.
const TEXT_TYPES = /^(|text|email|search|tel|url|password|number)$/;
const isTextField = (el: EventTarget | null): el is HTMLElement =>
  isEditable(el) && (el.tagName !== 'INPUT' || TEXT_TYPES.test((el as HTMLInputElement).type ?? ''));

const isCardField = (el: HTMLElement): boolean =>
  /^cc-/.test(el.getAttribute('autocomplete') || '') || /card|cvc|cvv/i.test(el.getAttribute('name') || '');

const fieldSlot = (el: HTMLElement): number => hashCode(`${el.tagName}|${el.id}|${el.getAttribute('name') ?? ''}`);

export function startCollector(w: Window, opts: CollectorOptions = {}): { ring: Ring; stop: () => void } {
  const ring = new Ring();
  const t0 = performance.now();
  const now = opts.now ?? (() => performance.now() - t0);
  // Dispatch can be delayed by a busy main thread. Use creation timestamps so a
  // queued burst of human input does not look like millisecond automation.
  const at = (e: Event): number => {
    if (opts.now) return now();
    const stamp = e.timeStamp;
    return Number.isFinite(stamp) && stamp >= t0 && stamp <= performance.now()
      ? stamp - t0 : now();
  };
  const doc = w.document;
  const push = (source: Event, e: Omit<TraceEvent, 't' | 'u'>, t = at(source)) =>
    ring.push({ ...e, t, u: !source.isTrusted || undefined });
  const off: (() => void)[] = [];
  const on = <E extends Event>(target: Window | Document, type: string, fn: (e: E) => void) => {
    // Each caller names the event type its listener reads; the DOM hands it that event.
    const listener = fn as EventListener;
    target.addEventListener(type, listener, { capture: true, passive: true });
    off.push(() => target.removeEventListener(type, listener, { capture: true } as EventListenerOptions));
  };

  // Chrome frame height used to detect the CDP screenX/Y == clientX/Y artefact.
  const chromeInset = () => ({ x: w.screenX + (w.outerWidth - w.innerWidth), y: w.screenY + (w.outerHeight - w.innerHeight) });
  const impossibleScreen = (e: MouseEvent) => {
    const ins = chromeInset();
    return e.screenX === e.clientX && e.screenY === e.clientY && (ins.y > 30 || ins.x > 30);
  };
  const ptype = (e: PointerEvent): 'm' | 't' | 'p' => (e.pointerType === 'touch' ? 't' : e.pointerType === 'pen' ? 'p' : 'm');
  let mousePress: { id: number; at: number } | undefined;

  on(w, 'pointermove', (e: PointerEvent) => {
    let co = -1;
    try { if (typeof e.getCoalescedEvents === 'function') co = e.getCoalescedEvents().length; } catch { /* unavailable */ }
    push(e, { k: 'mv', x: e.clientX, y: e.clientY, pt: ptype(e), co, sxm: impossibleScreen(e) || undefined });
  });
  on(w, 'pointerdown', (e: PointerEvent) => {
    mousePress = e.isTrusted && ptype(e) === 'm' ? { id: e.pointerId, at: now() } : undefined;
    const el = e.target as Element | null;
    let ox: number | undefined, oy: number | undefined, wd: number | undefined, ht: number | undefined;
    if (el && typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        ox = (e.clientX - (r.left + r.width / 2)) / r.width;
        oy = (e.clientY - (r.top + r.height / 2)) / r.height;
        wd = r.width; ht = r.height;
      }
    }
    push(e, { k: 'dn', x: e.clientX, y: e.clientY, pt: ptype(e), ox, oy, w: wd, h: ht, sxm: impossibleScreen(e) || undefined });
  });
  on(w, 'pointerup', (e: PointerEvent) => {
    const holdMs = e.isTrusted && mousePress && mousePress.id === e.pointerId ? now() - mousePress.at : undefined;
    mousePress = undefined;
    push(e, { k: 'up', pt: ptype(e), holdMs });
  });
  on(w, 'pointercancel', () => { mousePress = undefined; });
  on(w, 'click', (e: MouseEvent) => push(e, { k: 'ck', x: e.clientX, y: e.clientY, d: e.detail }));
  on(w, 'contextmenu', (e: Event) => push(e, { k: 'cm' }));

  on(w, 'keydown', (e: KeyboardEvent) => {
    if (e.repeat) return;
    const c = e.code || e.key || '';
    const sp = c === 'Backspace' || c === 'Delete' ? 'b' : c === 'Tab' ? 't' : c === 'Enter' ? 'e'
      : (e.ctrlKey || e.metaKey) && (c === 'KeyV' || e.key === 'v') ? 'v'
      : /^(Space|PageDown|PageUp|Arrow|Home|End)/.test(c) ? 'n' : undefined;
    push(e, { k: 'kd', ks: hashCode(c), mod: e.ctrlKey || e.metaKey || e.altKey || undefined, sp, composing: e.isComposing || undefined });
  });
  on(w, 'keyup', (e: KeyboardEvent) => push(e, { k: 'ku', ks: hashCode(e.code || e.key || ''), composing: e.isComposing || undefined }));

  const lastBefore = new Map<number, number>(), lastFill = new Map<number, number>();
  const slot = (el: HTMLElement) => (opts.pciLite && isCardField(el) ? undefined : fieldSlot(el));
  on(w, 'beforeinput', (e: InputEvent) => {
    const el = e.target as HTMLElement;
    const card = opts.pciLite && isEditable(el) && isCardField(el);
    const t = e.inputType || '';
    const it = e.isComposing ? 'c' : t === 'insertText' ? 't' : t === 'insertFromPaste' ? 'p' : t === 'insertReplacementText' || t === '' ? 'r'
      : t.startsWith('delete') ? 'd' : t.includes('Composition') ? 'c' : 'o';
    if (isEditable(el)) lastBefore.set(fieldSlot(el), at(e));
    push(e, { k: 'in', it, n: card ? undefined : (e.data?.length ?? 0) });
  });
  on(w, 'input', (e: Event) => {
    const el = e.target as HTMLElement;
    if (!isTextField(el)) return;
    const fs = fieldSlot(el), t = at(e);
    if (e.isTrusted) {
      // Typing already produced a beforeinput. Keep only script-set values and autofill, at most one
      // trusted event per field per second. Untrusted ones are the evidence and all stay.
      if (t - (lastBefore.get(fs) ?? -1e9) < 50 || t - (lastFill.get(fs) ?? -1e9) < 1000) return;
      lastFill.set(fs, t);
    }
    push(e, { k: 'iv', fs: slot(el) }, t);
  });
  on(w, 'change', (e: Event) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'SELECT' || isEditable(el))) push(e, { k: 'ch', fs: slot(el) });
  });
  on(w, 'paste', (e: Event) => push(e, { k: 'ps' }));
  on(w, 'focusin', (e: FocusEvent) => { if (isEditable(e.target)) push(e, { k: 'fo' }); });

  on(w, 'wheel', (e: WheelEvent) => push(e, { k: 'wh', dy: Math.round(e.deltaY * 100) / 100, dm: e.deltaMode }));
  let lastScroll = -1e9;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const scrollPos = () => ({ sy: Math.round(w.scrollY), h: w.innerHeight });
  on(w, 'scroll', (e: Event) => {
    const t = at(e);
    const docScroll = e.target === doc || e.target === doc.documentElement || e.target === w;
    if (t - lastScroll > 50) { lastScroll = t; push(e, { k: 'sc', ...(docScroll ? scrollPos() : {}) }, t); } // throttle
    if (!docScroll) return;
    // The throttle drops a burst's final position; record it once scrolling settles.
    clearTimeout(settle);
    // Stamp it when it fires: input pushed meanwhile has a later `t`, and the ring must stay time-ordered.
    settle = setTimeout(() => ring.push({ k: 'se', t: now(), ...scrollPos() }), 150);
  });

  on(w, 'touchstart', (e: TouchEvent) => {
    const tt = e.touches[0];
    push(e, { k: 'ts', x: tt?.clientX, y: tt?.clientY, f: tt?.force, r: tt?.radiusX });
  });
  on(w, 'touchmove', (e: TouchEvent) => { const tt = e.touches[0]; push(e, { k: 'tm', x: tt?.clientX, y: tt?.clientY }); });
  on(w, 'touchend', (e: TouchEvent) => { const tt = e.changedTouches[0]; push(e, { k: 'te', x: tt?.clientX, y: tt?.clientY }); });

  on(doc, 'visibilitychange', (e: Event) => push(e, { k: doc.visibilityState === 'hidden' ? 'vh' : 'vv' }));

  return { ring, stop: () => { clearTimeout(settle); off.forEach((f) => f()); } };
}

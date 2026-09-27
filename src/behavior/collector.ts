import { Ring, type TraceEvent } from './trace.ts';

/**
 * Passive, capture-phase listeners. All handlers are O(1) and passive; nothing reads input values.
 * `pciLite` stops listening to editable content inside payment forms beyond focus timing.
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
  const on = <K extends keyof WindowEventMap>(target: Window | Document, type: K | string, fn: (e: any) => void) => {
    target.addEventListener(type, fn, { capture: true, passive: true });
    off.push(() => target.removeEventListener(type, fn, { capture: true } as EventListenerOptions));
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

  const lastBefore = new Map<number, number>();
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
    if (!isEditable(el)) return;
    const fs = fieldSlot(el), t = at(e);
    // Typing already produced a beforeinput. Keep only script-set values and autofill.
    if (e.isTrusted && t - (lastBefore.get(fs) ?? -1e9) < 50) return;
    push(e, { k: 'iv', fs }, t);
  });
  on(w, 'change', (e: Event) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'SELECT' || isEditable(el))) push(e, { k: 'ch', fs: fieldSlot(el) });
  });
  on(w, 'paste', (e: Event) => push(e, { k: 'ps' }));
  on(w, 'focusin', (e: FocusEvent) => { if (isEditable(e.target)) push(e, { k: 'fo' }); });

  on(w, 'wheel', (e: WheelEvent) => push(e, { k: 'wh', dy: Math.round(e.deltaY * 100) / 100, dm: e.deltaMode }));
  let lastScroll = -1e9, lastDocScroll = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const isDocScroll = (e: Event) => e.target === doc || e.target === doc.documentElement || e.target === w;
  const scrollPos = () => ({ sy: Math.round(w.scrollY), h: w.innerHeight });
  on(w, 'scroll', (e: Event) => {
    const t = at(e);
    const docScroll = isDocScroll(e);
    if (t - lastScroll > 50) { lastScroll = t; push(e, { k: 'sc', ...(docScroll ? scrollPos() : {}) }, t); } // throttle
    if (!docScroll) return;
    lastDocScroll = t;
    // The throttle drops a burst's final position; record it once scrolling settles.
    clearTimeout(settle);
    settle = setTimeout(() => ring.push({ k: 'se', t: lastDocScroll, ...scrollPos() }), 150);
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

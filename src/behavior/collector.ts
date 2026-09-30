import { Ring, type TraceEvent } from './trace.ts';

/**
 * Passive, capture-phase listeners. All handlers are O(1) and passive; nothing reads input values.
 * `pciLite` keeps only timing for card fields: no input lengths and no field slots.
 */
export interface CollectorOptions {
  pciLite?: boolean;
  now?: () => number;
}

function pointerKind(type: string): 'm' | 't' | 'p' {
  if (type === 'touch') return 't';
  return type === 'pen' ? 'p' : 'm';
}

/** Editing (b, t, e), paste (v) and navigation (n) keys; other keys are undefined. */
function specialKey(event: KeyboardEvent, code: string): TraceEvent['sp'] {
  if (code === 'Backspace' || code === 'Delete') return 'b';
  if (code === 'Tab') return 't';
  if (code === 'Enter') return 'e';
  if ((event.ctrlKey || event.metaKey) && (code === 'KeyV' || event.key === 'v')) return 'v';
  return /^(Space|PageDown|PageUp|Arrow|Home|End)/.test(code) ? 'n' : undefined;
}

/** An inputType as typed (t), pasted (p), replaced (r), deleted (d), composed (c) or other (o). */
function inputKind(type: string): NonNullable<TraceEvent['it']> {
  if (type === 'insertText') return 't';
  if (type === 'insertFromPaste') return 'p';
  if (type === 'insertReplacementText' || type === '') return 'r';
  if (type.startsWith('delete')) return 'd';
  return type.includes('Composition') ? 'c' : 'o';
}

const hashCode = (text: string): number => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h & 0xffff;
};

const isEditable = (el: EventTarget | null): el is HTMLElement => {
  const element = el as HTMLElement | null;
  if (!element || !element.tagName) return false;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable === true;
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
  const at = (event: Event): number => {
    if (opts.now) return now();
    const stamp = event.timeStamp;
    return Number.isFinite(stamp) && stamp >= t0 && stamp <= performance.now()
      ? stamp - t0 : now();
  };
  const doc = w.document;
  const push = (source: Event, fields: Omit<TraceEvent, 't' | 'u'>, t = at(source)) =>
    ring.push({ ...fields, t, u: !source.isTrusted || undefined });
  const off: (() => void)[] = [];
  const on = <E extends Event>(target: Window | Document, type: string, fn: (e: E) => void) => {
    // Each caller names the event type its listener reads; the DOM hands it that event.
    const listener = fn as EventListener;
    target.addEventListener(type, listener, { capture: true, passive: true });
    off.push(() => target.removeEventListener(type, listener, { capture: true } as EventListenerOptions));
  };

  // Chrome frame height used to detect the CDP screenX/Y == clientX/Y artefact.
  const chromeInset = () => ({ x: w.screenX + (w.outerWidth - w.innerWidth), y: w.screenY + (w.outerHeight - w.innerHeight) });
  const impossibleScreen = (event: MouseEvent) => {
    const ins = chromeInset();
    return event.screenX === event.clientX && event.screenY === event.clientY && (ins.y > 30 || ins.x > 30);
  };
  const ptype = (event: PointerEvent): 'm' | 't' | 'p' => pointerKind(event.pointerType);
  let mousePress: { id: number; at: number } | undefined;

  on(w, 'pointermove', (event: PointerEvent) => {
    let co = -1;
    try { if (typeof event.getCoalescedEvents === 'function') co = event.getCoalescedEvents().length; } catch { /* unavailable */ }
    push(event, { k: 'mv', x: event.clientX, y: event.clientY, pt: ptype(event), co, sxm: impossibleScreen(event) || undefined });
  });
  on(w, 'pointerdown', (event: PointerEvent) => {
    mousePress = event.isTrusted && ptype(event) === 'm' ? { id: event.pointerId, at: now() } : undefined;
    const el = event.target as Element | null;
    let ox: number | undefined, oy: number | undefined, wd: number | undefined, ht: number | undefined;
    if (el && typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        ox = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
        oy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
        wd = rect.width; ht = rect.height;
      }
    }
    push(event, { k: 'dn', x: event.clientX, y: event.clientY, pt: ptype(event), ox, oy, w: wd, h: ht, sxm: impossibleScreen(event) || undefined });
  });
  on(w, 'pointerup', (event: PointerEvent) => {
    const holdMs = event.isTrusted && mousePress && mousePress.id === event.pointerId ? now() - mousePress.at : undefined;
    mousePress = undefined;
    push(event, { k: 'up', pt: ptype(event), holdMs });
  });
  on(w, 'pointercancel', () => { mousePress = undefined; });
  on(w, 'click', (event: MouseEvent) => push(event, { k: 'ck', x: event.clientX, y: event.clientY, d: event.detail }));
  on(w, 'contextmenu', (event: Event) => push(event, { k: 'cm' }));

  on(w, 'keydown', (event: KeyboardEvent) => {
    if (event.repeat) return;
    const code = event.code || event.key || '';
    const sp = specialKey(event, code);
    push(event, { k: 'kd', ks: hashCode(code), mod: event.ctrlKey || event.metaKey || event.altKey || undefined, sp, composing: event.isComposing || undefined });
  });
  on(w, 'keyup', (event: KeyboardEvent) => push(event, { k: 'ku', ks: hashCode(event.code || event.key || ''), composing: event.isComposing || undefined }));

  const lastBefore = new Map<number, number>(), lastFill = new Map<number, number>();
  const slot = (el: HTMLElement) => (opts.pciLite && isCardField(el) ? undefined : fieldSlot(el));
  on(w, 'beforeinput', (event: InputEvent) => {
    const el = event.target as HTMLElement;
    const card = opts.pciLite && isEditable(el) && isCardField(el);
    const t = event.inputType || '';
    const it = event.isComposing ? 'c' : inputKind(t);
    if (isEditable(el)) lastBefore.set(fieldSlot(el), at(event));
    push(event, { k: 'in', it, n: card ? undefined : (event.data?.length ?? 0) });
  });
  on(w, 'input', (event: Event) => {
    const el = event.target as HTMLElement;
    if (!isTextField(el)) return;
    const fs = fieldSlot(el), t = at(event);
    if (event.isTrusted) {
      // Typing already produced a beforeinput. Keep only script-set values and autofill, at most one
      // trusted event per field per second. Untrusted ones are the evidence and all stay.
      if (t - (lastBefore.get(fs) ?? -1e9) < 50 || t - (lastFill.get(fs) ?? -1e9) < 1000) return;
      lastFill.set(fs, t);
    }
    push(event, { k: 'iv', fs: slot(el) }, t);
  });
  on(w, 'change', (event: Event) => {
    const el = event.target as HTMLElement | null;
    if (el && (el.tagName === 'SELECT' || isEditable(el))) push(event, { k: 'ch', fs: slot(el) });
  });
  on(w, 'paste', (event: Event) => push(event, { k: 'ps' }));
  on(w, 'focusin', (event: FocusEvent) => { if (isEditable(event.target)) push(event, { k: 'fo' }); });

  on(w, 'wheel', (event: WheelEvent) => push(event, { k: 'wh', dy: Math.round(event.deltaY * 100) / 100, dm: event.deltaMode }));
  let lastScroll = -1e9;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const scrollPos = () => ({ sy: Math.round(w.scrollY), h: w.innerHeight });
  on(w, 'scroll', (event: Event) => {
    const t = at(event);
    const docScroll = event.target === doc || event.target === doc.documentElement || event.target === w;
    if (t - lastScroll > 50) { lastScroll = t; push(event, { k: 'sc', ...(docScroll ? scrollPos() : {}) }, t); } // throttle
    if (!docScroll) return;
    // The throttle drops a burst's final position; record it once scrolling settles.
    clearTimeout(settle);
    // Stamp it when it fires: input pushed meanwhile has a later `t`, and the ring must stay time-ordered.
    settle = setTimeout(() => ring.push({ k: 'se', t: now(), ...scrollPos() }), 150);
  });

  on(w, 'touchstart', (event: TouchEvent) => {
    const tt = event.touches[0];
    push(event, { k: 'ts', x: tt?.clientX, y: tt?.clientY, f: tt?.force, r: tt?.radiusX });
  });
  on(w, 'touchmove', (event: TouchEvent) => { const tt = event.touches[0]; push(event, { k: 'tm', x: tt?.clientX, y: tt?.clientY }); });
  on(w, 'touchend', (event: TouchEvent) => { const tt = event.changedTouches[0]; push(event, { k: 'te', x: tt?.clientX, y: tt?.clientY }); });

  on(doc, 'visibilitychange', (event: Event) => push(event, { k: doc.visibilityState === 'hidden' ? 'vh' : 'vv' }));

  return { ring, stop: () => { clearTimeout(settle); off.forEach((unlisten) => unlisten()); } };
}

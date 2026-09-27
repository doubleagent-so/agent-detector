// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCollector } from '../src/behavior/collector.ts';
import { Ring, type TraceEvent } from '../src/behavior/trace.ts';

let clock = 0;
let col: ReturnType<typeof startCollector>;
const ev = (type: string, init: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, target: EventTarget = window) => {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  for (const [k, v] of Object.entries({ ...init, ...extra })) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e);
  clock += 10;
};
const events = (): TraceEvent[] => [...col.ring.events];
const last = (): TraceEvent => col.ring.events[col.ring.length - 1];

beforeEach(() => {
  clock = 0;
  document.body.innerHTML = '<input id="card" name="cardnumber"><input id="cc" autocomplete="cc-number"><input id="plain" name="email"><input id="range" type="range"><input id="chk" type="checkbox"><input id="num" type="number"><textarea id="ta"></textarea><div id="ce" contenteditable="true"></div><button id="b">Go</button><select id="sel"><option>a</option></select>';
  col = startCollector(window, { now: () => clock });
});
afterEach(() => { col.stop(); vi.restoreAllMocks(); });

describe('collector', () => {
  it('records a separate mouse hold when native down/up timestamps coincide', () => {
    col.stop();
    const timer = vi.spyOn(performance, 'now').mockReturnValue(100);
    col = startCollector(window);
    timer.mockReturnValue(200);
    ev('pointerdown', { pointerId: 1, pointerType: 'mouse', isTrusted: true, timeStamp: 190 });
    timer.mockReturnValue(200.5);
    ev('pointerup', { pointerId: 1, pointerType: 'mouse', isTrusted: true, timeStamp: 190 });
    expect(events().map(e => e.t)).toEqual([90, 90]);
    expect(last().holdMs).toBe(0.5);
  });

  it('does not pair cancelled, synthetic or different-pointer presses', () => {
    const mouse = { pointerId: 1, pointerType: 'mouse', isTrusted: true };
    ev('pointerdown', mouse);
    ev('pointercancel');
    ev('pointerup', mouse);
    expect(last().holdMs).toBeUndefined();
    ev('pointerdown', mouse);
    ev('pointerup', { ...mouse, pointerId: 2 });
    expect(last().holdMs).toBeUndefined();
    ev('pointerdown', { ...mouse, isTrusted: false });
    ev('pointerup', mouse);
    expect(last().holdMs).toBeUndefined();
  });

  it('preserves input creation time when main-thread dispatch is delayed', () => {
    col.stop();
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(100);
    col = startCollector(window);
    performanceNow.mockReturnValue(1000);
    ev('keydown', { code: 'KeyA', timeStamp: 200 });
    ev('keyup', { code: 'KeyA', timeStamp: 290 });
    expect(events().map(e => e.t)).toEqual([100, 190]);
  });

  it('captures composition and synthetic origins without treating them as keystroke dynamics', () => {
    ev('keydown', { code: 'KeyA', isComposing: true });
    expect(last()).toMatchObject({ composing: true, u: true });
    ev('beforeinput', { inputType: 'insertText', data: 'ab', isComposing: true });
    expect(last()).toMatchObject({ it: 'c', u: true });
    ev('paste');
    expect(last()).toMatchObject({ k: 'ps', u: true });
    ev('pointermove', { getCoalescedEvents: () => { throw new Error('unsupported'); } });
    expect(last()).toMatchObject({ k: 'mv', co: -1 });
  });
  it('records pointer moves with coalesced counts, pointer types and the CDP screen==client artefact', () => {
    Object.defineProperty(window, 'outerHeight', { value: window.innerHeight + 80, configurable: true });
    ev('pointermove', { clientX: 5, clientY: 6, screenX: 5, screenY: 6, pointerType: 'mouse', getCoalescedEvents: () => [1, 2] });
    expect(last()).toEqual(expect.objectContaining({ k: 'mv', x: 5, y: 6, pt: 'm', co: 2, sxm: true, u: true }));
    ev('pointermove', { clientX: 1, clientY: 1, screenX: 100, screenY: 200, pointerType: 'touch' });
    expect(last()).toEqual(expect.objectContaining({ pt: 't', co: -1, sxm: undefined }));
    ev('pointermove', { clientX: 1, clientY: 1, screenX: 100, screenY: 200, pointerType: 'pen' });
    expect(last().pt).toBe('p');
    Object.defineProperty(window, 'outerHeight', { value: window.innerHeight, configurable: true });
    ev('pointermove', { clientX: 5, clientY: 6, screenX: 5, screenY: 6, pointerType: 'mouse' });
    expect(last().sxm).toBeUndefined(); // no chrome inset → not impossible
  });

  it('records pointer-down offsets from the target centre, up and click', () => {
    const b = document.getElementById('b')!;
    b.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 40 }) as DOMRect;
    ev('pointerdown', { clientX: 50, clientY: 20, screenX: 1, screenY: 1, pointerType: 'mouse' }, {}, b);
    expect(last()).toEqual(expect.objectContaining({ k: 'dn', ox: 0, oy: 0, w: 100, h: 40 }));
    b.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    ev('pointerdown', { clientX: 1, clientY: 1, screenX: 1, screenY: 1, pointerType: 'touch' }, {}, b);
    expect(last()).toEqual(expect.objectContaining({ k: 'dn', ox: undefined, w: undefined }));
    ev('pointerdown', { clientX: 1, clientY: 1, screenX: 9, screenY: 9, pointerType: 'mouse' }); // target = window (no rect)
    expect(last().ox).toBeUndefined();
    ev('pointerup', { pointerType: 'mouse' });
    ev('click', { clientX: 1, clientY: 2, detail: 1 });
    ev('contextmenu');
    expect(events().slice(-3).map((e) => e.k)).toEqual(['up', 'ck', 'cm']);
    expect(events().at(-2)).toEqual(expect.objectContaining({ d: 1, u: true }));
  });

  it('classifies special keys without recording key identities', () => {
    const keys: [Record<string, unknown>, string | undefined][] = [
      [{ code: 'Backspace' }, 'b'], [{ code: 'Delete' }, 'b'], [{ code: 'Tab' }, 't'], [{ code: 'Enter' }, 'e'],
      [{ code: 'KeyV', ctrlKey: true }, 'v'], [{ key: 'v', metaKey: true }, 'v'], [{ code: 'ArrowDown' }, 'n'],
      [{ code: 'Space' }, 'n'], [{ code: 'KeyA' }, undefined], [{}, undefined],
    ];
    for (const [init, sp] of keys) {
      ev('keydown', init);
      expect(last().sp, JSON.stringify(init)).toBe(sp);
      expect(last()).not.toHaveProperty('key');
    }
    expect(last().ks).toBe(0); // empty code hashes to 0
    ev('keydown', { code: 'KeyA', altKey: true });
    expect(last().mod).toBe(true);
    const n = col.ring.length;
    ev('keydown', { code: 'KeyA', repeat: true });
    expect(col.ring.length).toBe(n);
    ev('keyup', { code: 'KeyA' });
    ev('keyup', {});
    expect(events().slice(-2).map((e) => e.k)).toEqual(['ku', 'ku']);
  });

  it('classifies input types; card fields in PCI-lite keep timing only', () => {
    col.stop();
    col = startCollector(window, { now: () => clock, pciLite: true });
    const plain = document.getElementById('plain')!;
    const types: [string | undefined, string][] = [['insertText', 't'], ['insertFromPaste', 'p'], ['insertReplacementText', 'r'], ['', 'r'], [undefined, 'r'], ['deleteContentBackward', 'd'], ['insertCompositionText', 'c'], ['formatBold', 'o']];
    for (const [inputType, it] of types) {
      ev('beforeinput', { inputType, data: 'ab' }, {}, plain);
      expect(last()).toEqual(expect.objectContaining({ k: 'in', it, n: 2 }));
    }
    ev('beforeinput', { inputType: 'insertText', data: null }, {}, plain);
    expect(last().n).toBe(0);
    for (const id of ['card', 'cc']) {
      ev('beforeinput', { inputType: 'insertText', data: '4242' }, {}, document.getElementById(id)!);
      expect(last().n, id).toBeUndefined();
    }
    ev('beforeinput', { inputType: 'insertText', data: 'x' }, {}, document.getElementById('ce')!);
    expect(last().n).toBe(1);
  });

  it('records paste, focus into editables only, wheel, throttled scroll, touch and visibility', () => {
    ev('paste');
    expect(last().k).toBe('ps');
    const n = col.ring.length;
    ev('focusin', {}, {}, document.getElementById('b')!);
    ev('focusin', {}, {}, window);
    expect(col.ring.length).toBe(n);
    ev('focusin', {}, {}, document.getElementById('ta')!);
    ev('focusin', {}, {}, document.getElementById('ce')!);
    expect(events().slice(-2).map((e) => e.k)).toEqual(['fo', 'fo']);
    ev('wheel', { deltaY: 3.14159, deltaMode: 0 });
    expect(last()).toEqual(expect.objectContaining({ k: 'wh', dy: 3.14, dm: 0 }));

    ev('scroll');
    const s = col.ring.length;
    ev('scroll'); // 10ms later → throttled
    expect(col.ring.length).toBe(s);
    clock += 100;
    ev('scroll');
    expect(col.ring.length).toBe(s + 1);

    const touch = { clientX: 3, clientY: 4, force: 0.5, radiusX: 11 };
    ev('touchstart', { touches: [touch] });
    expect(last()).toEqual(expect.objectContaining({ k: 'ts', x: 3, f: 0.5, r: 11 }));
    ev('touchstart', { touches: [] });
    expect(last().x).toBeUndefined();
    ev('touchmove', { touches: [touch] });
    ev('touchmove', { touches: [] });
    ev('touchend', { changedTouches: [touch] });
    ev('touchend', { changedTouches: [] });
    expect(events().slice(-4).map((e) => e.k)).toEqual(['tm', 'tm', 'te', 'te']);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    ev('visibilitychange', {}, {}, document);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    ev('visibilitychange', {}, {}, document);
    expect(events().slice(-2).map((e) => e.k)).toEqual(['vh', 'vv']);
  });

  it('records script-set and autofilled values, but not typed input', () => {
    const plain = document.getElementById('plain')!;
    ev('input', {}, {}, plain); // new Event() is untrusted
    expect(last()).toEqual(expect.objectContaining({ k: 'iv', u: true, fs: expect.any(Number) }));
    const slot = last().fs;
    ev('beforeinput', { inputType: 'insertText', data: 'a', isTrusted: true }, {}, plain);
    ev('input', { isTrusted: true }, {}, plain); // typed: its beforeinput is 10 ms earlier
    expect(last().k).toBe('in');
    clock += 100;
    ev('input', { isTrusted: true }, {}, plain); // autofill: trusted, with no beforeinput
    expect(last()).toEqual(expect.objectContaining({ k: 'iv', fs: slot }));
    expect(last().u).toBeUndefined();
    ev('change', {}, {}, document.getElementById('sel')!);
    expect(last()).toEqual(expect.objectContaining({ k: 'ch', u: true }));
    expect(last().fs).not.toBe(slot);
    ev('input', {}, {}, document.getElementById('b')!); // not editable
    expect(last().k).toBe('ch');
  });

  it('keeps the ring time-ordered when input arrives before the scroll settles', () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
      ev('scroll', {}, {}, document);
      ev('pointerdown', { clientX: 1, clientY: 1, pointerType: 'mouse' }); // within the 150 ms settle window
      vi.advanceTimersByTime(200);
      expect(last().k).toBe('se');
      const ts = events().map((e) => e.t);
      expect(ts).toEqual([...ts].sort((a, b) => a - b));
    } finally {
      vi.useRealTimers();
    }
  });

  it('records field changes without typing for text-like fields only', () => {
    for (const id of ['range', 'chk']) {
      const n = col.ring.length;
      ev('input', {}, {}, document.getElementById(id)!);
      ev('input', { isTrusted: true }, {}, document.getElementById(id)!);
      expect(col.ring.length, id).toBe(n);
    }
    for (const id of ['num', 'ta', 'ce']) {
      ev('input', {}, {}, document.getElementById(id)!);
      expect(last().k, id).toBe('iv');
    }
  });

  it('collapses trusted autofill on one field to one event per second; untrusted stays', () => {
    const plain = document.getElementById('plain')!;
    const ivs = () => events().filter((e) => e.k === 'iv');
    ev('input', { isTrusted: true }, {}, plain);
    clock += 100;
    ev('input', { isTrusted: true }, {}, plain);
    expect(ivs()).toHaveLength(1);
    ev('input', { isTrusted: true }, {}, document.getElementById('ta')!); // another field is not collapsed
    expect(ivs()).toHaveLength(2);
    clock += 1000;
    ev('input', { isTrusted: true }, {}, plain);
    expect(ivs()).toHaveLength(3);
    ev('input', {}, {}, plain);
    ev('input', {}, {}, plain);
    expect(ivs()).toHaveLength(5);
  });

  it('PCI-lite drops field slots on card fields', () => {
    col.stop();
    col = startCollector(window, { now: () => clock, pciLite: true });
    for (const id of ['card', 'cc']) {
      ev('input', {}, {}, document.getElementById(id)!);
      expect(last(), id).toMatchObject({ k: 'iv' });
      expect(last().fs, id).toBeUndefined();
      ev('change', {}, {}, document.getElementById(id)!);
      expect(last(), id).toMatchObject({ k: 'ch' });
      expect(last().fs, id).toBeUndefined();
    }
    ev('input', {}, {}, document.getElementById('plain')!);
    expect(last().fs).toEqual(expect.any(Number));
  });

  it('stop() removes every listener; default clock uses performance.now', () => {
    col.stop();
    const n = col.ring.length;
    ev('click');
    expect(col.ring.length).toBe(n);
    const c2 = startCollector(window);
    ev('click');
    expect(c2.ring.events[0].t).toBeGreaterThanOrEqual(0);
    c2.stop();
  });

  it('records document scroll position and a trailing settle event', () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(window, 'scrollY', { value: 1200, configurable: true });
      ev('scroll', {}, {}, document);
      expect(last()).toEqual(expect.objectContaining({ k: 'sc', sy: 1200, h: window.innerHeight }));
      Object.defineProperty(window, 'scrollY', { value: 1500, configurable: true });
      ev('scroll', {}, {}, document); // within 50 ms throttle: not pushed
      vi.advanceTimersByTime(200);
      // Stamped when the timer fires, not at the last scroll, so the ring stays time-ordered.
      expect(last()).toEqual(expect.objectContaining({ k: 'se', sy: 1500, t: clock }));
      clock += 100; // past the 50 ms throttle
      ev('scroll', {}, {}, document.getElementById('ta')!);
      vi.advanceTimersByTime(200);
      expect(last().k).toBe('sc'); // element scroll: no position, no settle event
      expect(last().sy).toBeUndefined();
      ev('scroll', {}, {}, document);
      col.stop();
      const n = col.ring.length;
      vi.advanceTimersByTime(200);
      expect(col.ring.length).toBe(n); // stop() cancels the pending settle event
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Ring', () => {
  it('caps moves separately so discrete actions survive, and caps total length', () => {
    const r = new Ring(10, 3);
    r.push({ k: 'ck', t: 0 });
    for (let i = 0; i < 6; i++) r.push({ k: 'mv', t: i });
    expect(r.events.filter((e) => e.k === 'mv')).toHaveLength(3);
    expect(r.events[0].k).toBe('ck');
    for (let i = 0; i < 12; i++) r.push({ k: 'kd', t: 100 + i });
    expect(r.length).toBe(10);
    expect(r.events.every((e) => e.k === 'kd')).toBe(true);
    // Dropping a move from the front frees a move slot.
    const r2 = new Ring(2, 5);
    r2.push({ k: 'mv', t: 0 });
    r2.push({ k: 'kd', t: 1 });
    r2.push({ k: 'kd', t: 2 });
    for (let i = 0; i < 5; i++) r2.push({ k: 'mv', t: 3 + i });
    expect(r2.length).toBe(2);
  });

  it('with the move cap reached and no move in the buffer, still appends', () => {
    const r = new Ring(2, 1);
    r.push({ k: 'mv', t: 0 });
    r.push({ k: 'kd', t: 1 });
    r.push({ k: 'kd', t: 2 }); // evicts the move → moves counter back to 0
    r.push({ k: 'mv', t: 3 });
    r.push({ k: 'mv', t: 4 }); // cap reached: replaces the oldest move
    expect(r.events.map((e) => e.k)).toEqual(['kd', 'mv']);
  });
});

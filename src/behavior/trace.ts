/**
 * Compact interaction trace. Privacy: we never record key identities or input contents —
 * only timing, geometry and event types. Card fields (PCI) contribute timing only.
 */
export type TraceKind =
  | 'mv'  // pointer/mouse move
  | 'dn'  // pointer down
  | 'up'  // pointer up
  | 'ck'  // click
  | 'kd'  // key down
  | 'ku'  // key up
  | 'in'  // beforeinput
  | 'iv'  // input event with no matching beforeinput (script-set or autofill)
  | 'ch'  // change
  | 'ps'  // paste
  | 'cm'  // contextmenu
  | 'wh'  // wheel
  | 'sc'  // scroll
  | 'se'  // document scroll settled (trailing, 150 ms)
  | 'fo'  // focus into an editable
  | 'ts'  // touch start
  | 'te'  // touch end
  | 'tm'  // touch move
  | 'vh'  // visibility hidden
  | 'vv'; // visibility visible

export interface TraceEvent {
  k: TraceKind;
  /** ms since engine start */
  t: number;
  x?: number;
  y?: number;
  /** pointer type: m=mouse, t=touch, p=pen */
  pt?: 'm' | 't' | 'p';
  /** coalesced sample count (mv) */
  co?: number;
  /** screen/client offset impossible for real input (CDP bug) */
  sxm?: boolean;
  /** normalised offset from target centre (dn): -0.5..0.5 */
  ox?: number;
  oy?: number;
  /** target size (dn) */
  w?: number;
  h?: number;
  /** Pointer-up: elapsed dispatch time for the matching trusted mouse press. */
  holdMs?: number;
  /** isTrusted === false */
  u?: boolean;
  /** key slot (kd/ku): small hash of event.code to pair down/up — not the key itself */
  ks?: number;
  /** modifier held (kd) */
  mod?: boolean;
  /** Keyboard event occurred during IME composition. */
  composing?: boolean;
  /** special key class (kd): b=backspace, t=tab, v=paste shortcut, e=enter, n=navigation(space/pgdn/arrows) */
  sp?: 'b' | 't' | 'v' | 'e' | 'n';
  /** inputType class (in): t=insertText, p=insertFromPaste, r=replacement/autofill, d=delete, c=composition, o=other */
  it?: 't' | 'p' | 'r' | 'd' | 'c' | 'o';
  /** data length (in) */
  n?: number;
  /** wheel deltaY / deltaMode */
  dy?: number;
  dm?: number;
  /** touch force / radius */
  f?: number;
  r?: number;
  /** click detail (ck) */
  d?: number;
  /** field slot (iv/ch): small hash of tag, id and name to tell fields apart — never the value */
  fs?: number;
  /** document scrollY in px (sc/se); `h` carries the viewport height on the same events */
  sy?: number;
}

export class Ring {
  private buf: TraceEvent[] = [];
  private moves = 0;
  /** Events before this bound may have been evicted, so absence is not observable. */
  completeSince = 0;
  private cap: number;
  private moveCap: number;
  constructor(cap = 4000, moveCap = 2500) {
    this.cap = cap;
    this.moveCap = moveCap;
  }
  push(event: TraceEvent): void {
    if (event.k === 'mv') {
      // Keep moves bounded separately so long sessions don't evict discrete actions.
      if (this.moves >= this.moveCap) {
        const i = this.buf.findIndex((x) => x.k === 'mv');
        if (i >= 0) {
          const [dropped] = this.buf.splice(i, 1);
          this.completeSince = Math.max(this.completeSince, dropped.t + 0.001);
        }
      } else this.moves++;
    }
    this.buf.push(event);
    if (this.buf.length > this.cap) {
      const dropped = this.buf.shift();
      if (dropped) this.completeSince = Math.max(this.completeSince, dropped.t + 0.001);
      if (dropped?.k === 'mv') this.moves--;
    }
  }
  get events(): readonly TraceEvent[] { return this.buf; }
  get length(): number { return this.buf.length; }
}

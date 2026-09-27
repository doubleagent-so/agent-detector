import type { Signal, Signatures } from '../types.ts';

/**
 * Agent DOM markers (Tier A). Agents inject overlays/highlights after load, so we watch with a
 * single MutationObserver that only re-checks selectors when elements/ids change (debounced).
 * Sources: CHEQ (Claude in Chrome), Castle (Comet), browser-use/skyvern source.
 */
export function scanMarkers(doc: Document, sig: Signatures): Signal[] {
  const out: Signal[] = [];
  for (const m of sig.markers) {
    let el: Element | null = null;
    try { el = doc.querySelector(m.selector); } catch { continue; }
    if (el) {
      out.push({
        code: m.code, group: 'A', target: m.target, family: m.family, ...(m.agentId ? { agentId: m.agentId } : {}),
        llr: m.llr ?? 9, hard: (m.llr ?? 9) >= 8, detail: m.selector.split(',')[0],
      });
    }
  }
  return out;
}

export function watchMarkers(doc: Document, sig: Signatures, onHit: (s: Signal[]) => void): () => void {
  const found = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    timer = undefined;
    const hits = scanMarkers(doc, sig).filter((s) => !found.has(s.code));
    hits.forEach((s) => found.add(s.code));
    if (hits.length) onHit(hits);
  };
  check();
  if (typeof MutationObserver === 'undefined') return () => {};
  const mo = new MutationObserver(() => { if (!timer) timer = setTimeout(check, 250); });
  mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['id', 'unique_id', 'data-browser-use-highlight', 'data-browser-use-interaction-highlight', 'data-stagehand-mask', 'data-skyvern-otp-box'] });
  return () => { mo.disconnect(); if (timer) clearTimeout(timer); };
}

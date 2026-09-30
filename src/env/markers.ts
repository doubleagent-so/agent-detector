import type { Signal, Signatures } from '../types.ts';

/**
 * Agent DOM markers (Tier A). Agents inject overlays/highlights after load, so we watch with a
 * single MutationObserver that only re-checks selectors when elements/ids change (debounced).
 * Sources: CHEQ (Claude in Chrome), Castle (Comet), browser-use/skyvern source.
 */
export function scanMarkers(doc: Document, sig: Signatures): Signal[] {
  const out: Signal[] = [];
  for (const marker of sig.markers) {
    let el: Element | null;
    try { el = doc.querySelector(marker.selector); } catch { continue; }
    if (el) {
      out.push({
        code: marker.code, group: 'A', target: marker.target, family: marker.family, ...(marker.agentId ? { agentId: marker.agentId } : {}),
        llr: marker.llr ?? 9, hard: (marker.llr ?? 9) >= 8, detail: marker.selector.split(',')[0],
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
    const hits = scanMarkers(doc, sig).filter((signal) => !found.has(signal.code));
    hits.forEach((signal) => found.add(signal.code));
    if (hits.length) onHit(hits);
  };
  check();
  if (typeof MutationObserver === 'undefined') return () => {};
  const mo = new MutationObserver(() => { if (!timer) timer = setTimeout(check, 250); });
  mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['id', 'unique_id', 'data-browser-use-highlight', 'data-browser-use-interaction-highlight', 'data-stagehand-mask', 'data-skyvern-otp-box'] });
  return () => { mo.disconnect(); if (timer) clearTimeout(timer); };
}

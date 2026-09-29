// Live verdict for this page. Run with `npm run example` and open the printed URL,
// then try it with a real browser, a headless one, and an AI agent.
import { createEngine, type Verdict } from '../../src/index.ts';

const show = (v: Verdict): void => {
  document.getElementById('class')!.textContent = `${v.class} · ${Math.round(v.probability[v.class] * 100)}%`;
  document.getElementById('verdict')!.textContent = JSON.stringify(
    { class: v.class, probability: v.probability, confidence: v.confidence, agent: v.agent, recommendation: v.recommendation, reasons: v.reasons },
    null, 2);
};

const engine = createEngine(window, { onVerdict: show });

// Show the first full verdict as soon as the async probes finish; the interval below keeps it fresh.
async function showWhenReady(): Promise<void> {
  try {
    show(await engine.ready);
  } catch {
    // The engine never rejects `ready`; nothing to show if it somehow does.
  }
}

void showWhenReady();
setInterval(() => show(engine.verdict()), 2000);

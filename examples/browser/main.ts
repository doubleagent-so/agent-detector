// Live verdict for this page. Run with `npm run example` and open the printed URL,
// then try it with a real browser, a headless one, and an AI agent.
import { createEngine, type Verdict } from '../../src/index.ts';

const show = (verdict: Verdict): void => {
  document.getElementById('class')!.textContent = `${verdict.class} · ${Math.round(verdict.probability[verdict.class] * 100)}%`;
  document.getElementById('verdict')!.textContent = JSON.stringify(
    { class: verdict.class, probability: verdict.probability, confidence: verdict.confidence, agent: verdict.agent, recommendation: verdict.recommendation, reasons: verdict.reasons },
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

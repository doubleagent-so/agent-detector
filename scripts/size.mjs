// Size budget: a browser bundle that only calls createEngine must stay small, since it runs on every page view.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const BUDGET_GZIP = 17 * 1024; // 15.5 KB after the FP-Agent/BeCAPTCHA detectors (2026-09-27); 15.62 KB before order-independent attribution roles (2026-09-28)
const out = await build({
  stdin: { contents: "import { createEngine } from './src/index.ts'; createEngine(window);", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, minify: true, format: 'iife', target: 'es2019', platform: 'browser', write: false, logLevel: 'warning',
});
const gz = gzipSync(out.outputFiles[0].contents, { level: 9 }).length;
console.log(`createEngine bundle: ${(gz / 1024).toFixed(2)} KB gzip (budget ${(BUDGET_GZIP / 1024).toFixed(0)} KB)`);
if (gz > BUDGET_GZIP) {
  console.error('OVER BUDGET');
  process.exitCode = 1;
}

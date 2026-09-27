// Serves examples/browser with esbuild: `npm run example`, then open the URL it prints.
import { context } from 'esbuild';

const ctx = await context({ entryPoints: ['examples/browser/main.ts'], bundle: true, format: 'esm', outdir: 'examples/browser', logLevel: 'warning' });
const { hosts, port } = await ctx.serve({ servedir: 'examples/browser', port: 8123 });
console.log(`http://${hosts[0] === '0.0.0.0' ? 'localhost' : hosts[0]}:${port}/`);

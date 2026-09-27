// Builds the publishable package in dist/: ES modules and .d.ts per source file (tsc), plus a package.json
// whose exports point at the compiled files. Publish with `npm publish ./dist`. In the monorepo the
// workspace keeps resolving to src/, so nothing else needs a build first.
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
rmSync(dist, { recursive: true, force: true });

// typescript exports only package.json, so locate its bin through that.
const tsc = resolve(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc');
const out = spawnSync(process.execPath, [tsc, '-p', resolve(root, 'tsconfig.build.json')], { stdio: 'inherit' });
if (out.status !== 0) process.exit(out.status ?? 1);

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const { scripts: _scripts, devDependencies: _dev, engines: _engines, ...published } = pkg;
writeFileSync(resolve(dist, 'package.json'), `${JSON.stringify({
  ...published,
  main: './index.js',
  types: './index.d.ts',
  exports: { '.': { types: './index.d.ts', import: './index.js' } },
}, null, 2)}\n`);
for (const file of ['LICENSE', 'README.md']) copyFileSync(resolve(root, file), resolve(dist, file));
console.log(`built ${pkg.name}@${pkg.version} → dist/`);

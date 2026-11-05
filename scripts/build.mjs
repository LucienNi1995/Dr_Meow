import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { pathToFileURL } from 'node:url';
import { buildNativeProbe } from './native.mjs';

export const electronOptions = {
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  external: ['electron'],
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  outdir: 'dist/electron'
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildNativeProbe();
  await Promise.all([buildRenderer(), bundle(electronOptions)]);
}


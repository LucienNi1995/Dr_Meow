import { spawn } from 'node:child_process';
import electron from 'electron';
import { build } from 'esbuild';
import { createServer } from 'vite';
import { electronOptions } from './build.mjs';
import { buildNativeProbe } from './native.mjs';

buildNativeProbe();
await build(electronOptions);
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, DR_MEOW_DEV: '1' }
});
function stop() {
  child.kill();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', async error => {
  console.error(error.message);
  process.exitCode = 1;
  await server.close();
});
child.once('exit', async code => {
  process.exitCode = code ?? 0;
  await server.close();
});


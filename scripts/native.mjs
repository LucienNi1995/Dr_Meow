import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildNativeProbe() {
  if (process.platform !== 'win32') return;
  const compiler = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const source = fileURLToPath(new URL('../electron/native/FullscreenProbe.cs', import.meta.url));
  const output = fileURLToPath(new URL('../dist/native/FullscreenProbe.exe', import.meta.url));
  mkdirSync(dirname(output), { recursive: true });
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/out:' + output, source], {
    stdio: 'inherit',
    windowsHide: true
  });
}

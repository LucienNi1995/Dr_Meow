import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export function fullscreenProbePath(resources?: string): string {
  return join(resources ?? join(__dirname, '..'), 'native', 'FullscreenProbe.exe');
}

export function watchFullscreen(executable: string, hwnd: bigint, onChange: (covered: boolean) => void): () => void {
  const child = spawn(executable, [hwnd.toString(), String(process.pid)], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stopped = false;
  let covered = false;
  let clearSamples = 0;
  let lastSampleAt = performance.now();
  let watchdog: ReturnType<typeof setInterval> | undefined;

  function publish(next: boolean) {
    if (covered === next) return;
    covered = next;
    onChange(next);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (watchdog) clearInterval(watchdog);
    lines.close();
    child.stdin.end();
    child.kill();
  }

  lines.on('line', value => {
    if (stopped || (value !== '0' && value !== '1')) return;
    lastSampleAt = performance.now();
    if (value === '1') {
      clearSamples = 0;
      publish(true);
    } else if (++clearSamples >= 2) {
      publish(false);
    }
  });
  child.stdin.on('error', () => {});
  function recover() {
    if (stopped) return;
    stop();
    publish(false);
  }
  child.once('error', recover);
  child.once('close', recover);
  watchdog = setInterval(() => {
    if (performance.now() - lastSampleAt >= 2500) publish(false);
  }, 1000);

  return stop;
}


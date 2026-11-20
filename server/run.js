import { spawn } from 'node:child_process';

// Runs a converter in its own process group so a timeout or a cancelled
// request stops the whole job. LibreOffice's launcher hands the work to a
// soffice.bin child; killing only the launcher would leave that child running.
export function run(command, args, { timeout = 0, signal, maxBuffer = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, settled = false, timer;

    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => { killGroup(); finish(abortError()); };
    const collect = append => chunk => {
      size += chunk.length;
      if (size > maxBuffer) { killGroup(); return finish(new Error(`${command} produced more output than allowed.`)); }
      append(chunk.toString());
    };

    child.stdout.on('data', collect(text => { stdout += text; }));
    child.stderr.on('data', collect(text => { stderr += text; }));
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code === 0) return finish(null, { stdout, stderr });
      finish(new Error(`${command} exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
    });

    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeout) timer = setTimeout(() => { killGroup(); finish(new Error(`${command} timed out after ${timeout} ms.`)); }, timeout);
  });
}

export function abortError() {
  const error = new Error('The request was cancelled.');
  error.name = 'AbortError';
  return error;
}

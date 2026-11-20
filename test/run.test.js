import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../server/run.js';

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A launcher that hands the work to a child, the way LibreOffice does.
const launcher = ['-c', 'sleep 30 & wait'];

test('returns the output of a finished command', async () => {
  const { stdout } = await run('sh', ['-c', 'echo converted']);
  assert.equal(stdout.trim(), 'converted');
});

test('rejects with the exit code and error output when a command fails', async () => {
  await assert.rejects(run('sh', ['-c', 'echo broken >&2; exit 3']), /exited with code 3: broken/);
});

test('cancelling stops the command and the children it started', async () => {
  const controller = new AbortController();
  let childPid;
  const job = run('sh', launcher, { signal: controller.signal });
  const started = Date.now();
  while (!childPid && Date.now() - started < 2000) {
    await wait(20);
    childPid = Number((await import('node:child_process')).execSync(`pgrep -n -f "^sleep 30$" || true`).toString().trim()) || undefined;
  }
  assert.ok(childPid, 'the child process should have started');
  controller.abort();
  await assert.rejects(job, error => error.name === 'AbortError');
  await wait(100);
  assert.equal(alive(childPid), false, 'the child process should be gone');
});

test('a timeout stops the command and the children it started', async () => {
  const before = Date.now();
  await assert.rejects(run('sh', ['-c', 'sleep 31 & wait'], { timeout: 200 }), /timed out/);
  assert.ok(Date.now() - before < 2000);
  await wait(100);
  const { execSync } = await import('node:child_process');
  assert.equal(execSync('pgrep -f "^sleep 31$" || true').toString().trim(), '', 'no sleep should be left running');
});

test('an already-cancelled request never starts the command', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run('sh', ['-c', 'exit 0'], { signal: controller.signal }), error => error.name === 'AbortError');
});

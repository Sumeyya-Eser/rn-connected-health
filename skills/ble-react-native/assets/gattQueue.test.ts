// Runs with zero dependencies: node --experimental-strip-types --test gattQueue.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GattQueue, GattTimeoutError, reconnectDelayMs } from './gattQueue.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('GattQueue', () => {
  it('never runs two operations at once, and keeps order', async () => {
    const q = new GattQueue();
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    const op = (i: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(5 - i);
      order.push(i);
      running--;
      return i;
    };
    const results = await Promise.all([0, 1, 2, 3].map((i) => q.run(op(i))));
    assert.deepEqual(results, [0, 1, 2, 3]);
    assert.deepEqual(order, [0, 1, 2, 3]);
    assert.equal(maxRunning, 1);
    await sleep(0);
    assert.equal(q.size, 0);
  });

  it('keeps going after a failure or timeout', async () => {
    const q = new GattQueue();
    const failed = q.run(async () => {
      throw new Error('GATT 133');
    });
    const hung = q.run(() => new Promise(() => {}), { timeoutMs: 20, label: 'read battery' });
    const ok = q.run(async () => 'ok');
    await assert.rejects(failed, /GATT 133/);
    await assert.rejects(hung, GattTimeoutError);
    assert.equal(await ok, 'ok');
  });

  it('drops waiting operations when cleared on disconnect', async () => {
    const q = new GattQueue();
    const first = q.run(() => sleep(10).then(() => 1));
    const waiting = q.run(async () => 2, { label: 'write RACP' });
    await sleep(1); // first is now running; clear() only drops ops that have not started
    q.clear();
    assert.equal(await first, 1);
    await assert.rejects(waiting, /write RACP dropped/);
    assert.equal(await q.run(async () => 3), 3);
  });
});

describe('reconnectDelayMs', () => {
  it('grows exponentially, caps, and gives up', () => {
    const max = { random: () => 1 };
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((a) => reconnectDelayMs(a, max)), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    assert.equal(reconnectDelayMs(8, max), undefined);
  });
});

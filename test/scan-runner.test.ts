import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runScan } from '../src/scan-runner.js';
import type { ScanProgressEvent } from '../src/types.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('runScan', () => {
  it('emits started/completed progress without overreporting completion', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-run-scan-'));
    tempRoots.push(root);

    const first = path.join(root, 'project-a');
    const second = path.join(root, 'project-b');
    const firstTarget = path.join(first, 'node_modules');
    const secondTarget = path.join(second, 'venv');

    mkdirSync(firstTarget, { recursive: true });
    mkdirSync(secondTarget, { recursive: true });
    writeFileSync(path.join(firstTarget, 'a.txt'), 'hello');
    writeFileSync(path.join(secondTarget, 'b.txt'), 'world');

    const progressEvents: ScanProgressEvent[] = [];
    const result = await runScan({
      source: 'manual',
      targets: [
        { id: 'first', path: first },
        { id: 'second', path: second },
      ],
      onProgress: (event) => {
        progressEvents.push(event);
      },
    });

    const startedEvents = progressEvents.filter((event) => event.phase === 'started');
    const completedEvents = progressEvents.filter((event) => event.phase === 'completed');

    assert.equal(startedEvents.length, 2);
    assert.equal(completedEvents.length, 2);
    assert.equal(startedEvents[0].completed, 0);
    assert.equal(startedEvents[1].completed <= 1, true);
    assert.equal(completedEvents.at(-1)?.completed, 2);
    assert.equal(result.targets.length, 2);
  });
});

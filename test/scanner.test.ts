import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanDirectories } from '../src/scanner.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('scanDirectories', () => {
  it('finds target directories and respects only/exclude filters', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-scan-'));
    tempRoots.push(root);

    const nodeModules = path.join(root, 'project-a', 'node_modules');
    const venv = path.join(root, 'project-b', 'venv');
    const ignored = path.join(root, '.git', 'node_modules');

    mkdirSync(nodeModules, { recursive: true });
    mkdirSync(venv, { recursive: true });
    mkdirSync(ignored, { recursive: true });

    writeFileSync(path.join(nodeModules, 'a.js'), 'hello');
    writeFileSync(path.join(venv, 'bin.txt'), 'world');
    writeFileSync(path.join(ignored, 'x.txt'), 'should-skip');

    const full = await scanDirectories({ targetDir: root });
    assert.equal(full.directories.length, 2);

    const onlyNode = await scanDirectories({ targetDir: root, only: ['node_modules'] });
    assert.equal(onlyNode.directories.length, 1);
    assert.equal(onlyNode.directories[0].name, 'node_modules');

    const excluded = await scanDirectories({ targetDir: root, exclude: ['venv'] });
    assert.equal(excluded.directories.length, 1);
    assert.equal(excluded.directories[0].name, 'node_modules');
  });
});

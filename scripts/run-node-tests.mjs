#!/usr/bin/env node
// Runs the plain node:test suites that are not npm workspaces:
//   scripts/*.test.mjs  (any Node >= 20)
//   ap4m/*.test.mjs     (ap4m requires Node >= 22.13; skipped with a clear message on older Node)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tests = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f));

const [maj, min] = process.versions.node.split('.').map(Number);
const ap4mOk = maj > 22 || (maj === 22 && min >= 13);

const files = [...tests('scripts')];
if (ap4mOk) files.push(...tests('ap4m'));
else console.log(`SKIPPED ap4m tests: Node ${process.versions.node} < 22.13 (ap4m needs node:sqlite). Use Node 22.13+ to run them.`);

const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);

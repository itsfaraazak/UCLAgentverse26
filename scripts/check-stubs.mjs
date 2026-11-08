#!/usr/bin/env node
/**
 * Integration drift checker.
 *
 * The three UI variant branches were built in parallel with the real `lib/`
 * modules, against the interfaces pinned in SPEC.md §4. Where a module did not
 * yet exist, each branch created a file marked:
 *
 *     // TEMP STUB — replaced at integration.
 *
 * At integration those stubs get deleted and the real modules dropped in. That
 * is only safe if each stub exported the *same names* the real module exports.
 * A stub that invented an extra export, or renamed one, breaks the branch the
 * moment the real module replaces it.
 *
 * This script finds every stub on a branch and diffs its exported names against
 * the real module on a reference ref (default `main`).
 *
 * Usage:
 *   node scripts/check-stubs.mjs                       # all variant/* branches
 *   node scripts/check-stubs.mjs variant/lab-bench     # specific branches
 *   node scripts/check-stubs.mjs --base=HEAD variant/x # different reference
 *
 * Exit code 1 if any branch exports a name the reference does not — that is
 * the case that will fail to compile after the swap.
 *
 * Honest about its method: this is a regex scan of export statements, not a
 * typechecker. It catches missing and misnamed exports, which is the common
 * failure. It does NOT compare type shapes — two modules can export the same
 * names with incompatible signatures and this script will call that clean. The
 * real typecheck is `pnpm build` after the swap; this just finds the obvious
 * breakage early and cheaply.
 */

import { execFileSync } from 'node:child_process';

const MODULES = ['genome', 'vcs', 'agents', 'cellsim', 'safety'];
const STUB_MARKER = 'TEMP STUB';

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function refExists(ref) {
  return git(['rev-parse', '--verify', '--quiet', ref]) !== null;
}

function listFiles(ref) {
  const out = git(['ls-tree', '-r', '--name-only', ref, 'src/lib/']);
  if (out === null) return [];
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /\.tsx?$/.test(l) && !/\.(test|spec)\.tsx?$/.test(l));
}

function read(ref, path) {
  return git(['show', `${ref}:${path}`]);
}

/**
 * Pull exported names out of a TypeScript source file.
 * Deliberately conservative: it would rather miss an exotic form than invent a
 * name that is not there.
 */
function exportedNames(source) {
  const names = new Set();
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // export const/let/function/class/type/interface/enum NAME
  const decl =
    /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of src.matchAll(decl)) names.add(m[1]);

  // export { a, b as c }  — record the exported (outward-facing) name
  for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const part = piece.trim();
      if (!part) continue;
      const as = part.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = as ? as[1] : part.replace(/^type\s+/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default') names.add(name);
    }
  }

  if (/\bexport\s+default\b/.test(src)) names.add('default');
  return names;
}

function moduleOf(path) {
  const m = path.match(/^src\/lib\/([^/]+)\//);
  return m && MODULES.includes(m[1]) ? m[1] : null;
}

/** module -> Set(exported names) across all non-test files in that module. */
function surfaceOf(ref) {
  const surface = new Map(MODULES.map((m) => [m, new Set()]));
  for (const path of listFiles(ref)) {
    const mod = moduleOf(path);
    if (!mod) continue;
    const src = read(ref, path);
    if (src === null) continue;
    for (const n of exportedNames(src)) surface.get(mod).add(n);
  }
  return surface;
}

function stubsOf(ref) {
  const stubs = [];
  for (const path of listFiles(ref)) {
    const src = read(ref, path);
    if (src === null || !src.includes(STUB_MARKER)) continue;
    stubs.push({ path, module: moduleOf(path), names: exportedNames(src) });
  }
  return stubs;
}

function discoverBranches() {
  const out = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  if (out === null) return [];
  return out.split('\n').map((l) => l.trim()).filter((b) => b.startsWith('variant/'));
}

// ── main ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const baseArg = argv.find((a) => a.startsWith('--base='));
const base = baseArg ? baseArg.slice('--base='.length) : 'main';
let branches = argv.filter((a) => !a.startsWith('--'));

if (!refExists(base)) {
  console.error(`✗ reference ref '${base}' does not exist`);
  process.exit(2);
}
if (branches.length === 0) {
  branches = discoverBranches();
  if (branches.length === 0) {
    console.error('No variant/* branches found. Pass branch names explicitly.');
    process.exit(2);
  }
}

const reference = surfaceOf(base);
console.log(`Reference: ${base}`);
for (const [mod, names] of reference) {
  console.log(`  src/lib/${mod}: ${names.size ? `${names.size} exports` : '— absent —'}`);
}

let drift = 0;
let totalStubs = 0;

for (const branch of branches) {
  console.log(`\n${'─'.repeat(72)}\n${branch}`);
  if (!refExists(branch)) {
    console.log('  ✗ branch not found locally');
    drift += 1;
    continue;
  }

  const stubs = stubsOf(branch);
  if (stubs.length === 0) {
    console.log(`  ✓ no files marked "${STUB_MARKER}"`);
    continue;
  }

  for (const stub of stubs) {
    totalStubs += 1;
    const real = stub.module ? reference.get(stub.module) : new Set();
    const unknown = [...stub.names].filter((n) => !real.has(n)).sort();
    const notYetUsed = [...real].filter((n) => !stub.names.has(n)).sort();

    console.log(`\n  ${stub.path}`);
    console.log(`    module: ${stub.module ?? '(outside src/lib)'} · exports: ${stub.names.size}`);

    if (unknown.length > 0) {
      drift += 1;
      console.log(`    ✗ DRIFT — ${unknown.length} export(s) the reference does not have:`);
      for (const n of unknown) console.log(`        · ${n}`);
      console.log('      These break on swap: the branch imports them, the real module has no such export.');
    } else {
      console.log('    ✓ every exported name exists in the reference module');
    }

    if (notYetUsed.length > 0) {
      const shown = notYetUsed.slice(0, 12);
      console.log(`    · reference also exports ${notYetUsed.length} name(s) this stub omitted (fine — not an error):`);
      console.log(`        ${shown.join(', ')}${notYetUsed.length > shown.length ? ', …' : ''}`);
    }
  }
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`Branches checked: ${branches.length} · stub files: ${totalStubs} · drifting: ${drift}`);

if (drift > 0) {
  console.log('\nResolve each DRIFT before swapping modules in: either the branch renames its');
  console.log('usage to the real export, or the real module genuinely needs that export added.');
  console.log('Remember this is a name check only — run `pnpm build` after the swap for types.');
  process.exit(1);
}

console.log('\nNo name-level drift. Type compatibility still needs `pnpm build` after the swap.');

#!/usr/bin/env node
/**
 * check-design.mjs — Remote Gamepad design-system linter
 *
 * Catches the violations an agent (or a tired human) reliably makes.
 * Zero dependencies. Node 18+.
 *
 *   node scripts/check-design.mjs src
 *   node scripts/check-design.mjs src --warn-only
 *
 * Exit 0 = clean (or warn-only). Exit 1 = errors found.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const ROOT = process.argv[2] ?? 'src';
const WARN_ONLY = process.argv.includes('--warn-only');

const EXTS = new Set(['.css', '.scss', '.ts', '.tsx', '.js', '.jsx', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

/* Files that ARE the design system — exempt from the no-raw-values rule. */
const TOKEN_FILE = /tokens\.css$/;

/* Pad-widget files: the interaction layer. Glass is forbidden here. */
const WIDGET_PATH = /(widget|pad|thumbstick|trigger|dpad|abxy|ltrt|macro|gamepad)/i;

/* Pure greys — every neutral in this system is tinted. */
const PURE_GREY = /#(?:80{2}80|8{6}|CCC(?:CCC)?|DDD(?:DDD)?|EEE(?:EEE)?|333(?:333)?|666(?:666)?|999(?:999)?|AAA(?:AAA)?|BBB(?:BBB)?)\b/i;

const RAW_HEX = /#[0-9a-f]{3,8}\b/i;

const LAYOUT_ANIM = /transition\s*:[^;{]*\b(width|height|top|left|right|bottom|margin|padding|filter|backdrop-filter)\b/i;

const rules = [
  {
    id: 'glass-on-widget',
    level: 'error',
    test: (line, ctx) =>
      WIDGET_PATH.test(ctx.file) &&
      /backdrop-filter|\bclassName=["'`][^"'`]*\bglass\b/.test(line),
    msg: 'Glass on the interaction layer. Pad widgets must stay flat (CLAUDE.md §1).',
  },
  {
    id: 'blur-without-saturate',
    level: 'error',
    test: (line) =>
      /backdrop-filter\s*:/.test(line) &&
      /blur\(/.test(line) &&
      !/saturate\(/.test(line) &&
      !/:\s*none/.test(line),
    msg: 'backdrop-filter has blur() but no saturate(). Reads as frosted plastic (CLAUDE.md §5).',
  },
  {
    id: 'missing-webkit-prefix',
    level: 'warn',
    test: (line, ctx) =>
      /^\s*backdrop-filter\s*:/.test(line) &&
      !ctx.prev.includes('-webkit-backdrop-filter'),
    msg: 'backdrop-filter without a -webkit- companion on the preceding line. Older WebViews will ignore it.',
  },
  {
    id: 'transition-all',
    level: 'error',
    test: (line) => /transition\s*:\s*all\b/.test(line),
    msg: 'transition: all watches every animatable property, including layout ones. Name the property.',
  },
  {
    id: 'layout-animation',
    level: 'error',
    test: (line) => LAYOUT_ANIM.test(line),
    msg: 'Animating a layout or filter property. Use transform and opacity only (CLAUDE.md §7).',
  },
  {
    id: 'raw-hex',
    level: 'warn',
    test: (line, ctx) =>
      !TOKEN_FILE.test(ctx.file) && RAW_HEX.test(line) && !/--[a-z-]+\s*:/.test(line),
    msg: 'Raw hex outside tokens.css. Use a var(--token) (CLAUDE.md §3).',
  },
  {
    id: 'pure-grey',
    level: 'warn',
    test: (line) => PURE_GREY.test(line),
    msg: 'Pure grey. Every neutral in this system is tinted (CLAUDE.md §2).',
  },
  {
    id: 'nested-glass',
    level: 'warn',
    test: (line) => {
      const m = line.match(/className=["'`]([^"'`]*)["'`]/);
      return !!m && (m[1].match(/\bglass\b/g) ?? []).length > 1;
    },
    msg: 'Two glass classes on one element. Never stack glass on glass (CLAUDE.md §2).',
  },
  {
    id: 'inline-style-object',
    level: 'warn',
    test: (line) => /style=\{\{[^}]*(backdropFilter|borderRadius|background)/.test(line),
    msg: 'Inline style object — new identity every render. Move to a class (CLAUDE.md §5).',
  },
];

/* --- file-level rules (whole-file checks) --- */
const fileRules = [
  {
    id: 'missing-a11y-fallback',
    level: 'error',
    test: (src) =>
      /\.glass\s*\{/.test(src) &&
      !/prefers-reduced-transparency/.test(src),
    msg: 'Defines .glass but has no prefers-reduced-transparency fallback (CLAUDE.md §8).',
  },
];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(extname(name))) out.push(full);
  }
  return out;
}

const findings = [];

for (const file of walk(ROOT)) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const rel = relative(process.cwd(), file) || file;
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const ctx = { file: rel, prev: lines[i - 1] ?? '', index: i };
    for (const r of rules) {
      let hit = false;
      try { hit = r.test(line, ctx); } catch { hit = false; }
      if (hit) findings.push({ ...r, file: rel, line: i + 1, src: trimmed.slice(0, 100) });
    }
  });

  for (const r of fileRules) {
    let hit = false;
    try { hit = r.test(src, rel); } catch { hit = false; }
    if (hit) findings.push({ ...r, file: rel, line: 1, src: '(file)' });
  }
}

/* --- report --- */
const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');

const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', x: '\x1b[0m' };

if (!findings.length) {
  console.log(`${C.g}✓ design system clean${C.x}  (${ROOT})`);
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

for (const [file, list] of byFile) {
  console.log(`\n${file}`);
  for (const f of list.sort((a, b) => a.line - b.line)) {
    const tag = f.level === 'error' ? `${C.r}error${C.x}` : `${C.y}warn ${C.x}`;
    console.log(`  ${String(f.line).padStart(4)}  ${tag}  ${f.msg}`);
    console.log(`        ${C.d}${f.src}${C.x}`);
  }
}

console.log(
  `\n${errors.length ? C.r : C.g}${errors.length} error(s)${C.x}, ` +
  `${warns.length ? C.y : C.g}${warns.length} warning(s)${C.x}`
);

process.exit(errors.length && !WARN_ONLY ? 1 : 0);

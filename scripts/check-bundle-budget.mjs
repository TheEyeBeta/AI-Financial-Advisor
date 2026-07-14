#!/usr/bin/env node
/**
 * Production bundle-size budget (#213). Run after `npm run build`.
 *
 * Fails when the gzipped total of dist/assets JS (or any single chunk)
 * exceeds its budget. Raise a budget only with a reviewed justification —
 * these numbers are the release gate for initial-load performance.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');
// Current build (2026-07): ~450KB gzip total, largest chunk ~103KB gzip.
const TOTAL_JS_GZIP_BUDGET_BYTES = 700 * 1024;
const SINGLE_CHUNK_GZIP_BUDGET_BYTES = 200 * 1024;

let files;
try {
  files = readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.js'));
} catch {
  console.error(`No build output at ${DIST_ASSETS} — run 'npm run build' first.`);
  process.exit(1);
}

let total = 0;
let failed = false;
const rows = [];

for (const name of files) {
  const path = join(DIST_ASSETS, name);
  if (!statSync(path).isFile()) continue;
  const gzipped = gzipSync(readFileSync(path)).length;
  total += gzipped;
  const overBudget = gzipped > SINGLE_CHUNK_GZIP_BUDGET_BYTES;
  if (overBudget) failed = true;
  rows.push({ name, gzipKB: (gzipped / 1024).toFixed(1), overBudget });
}

rows.sort((a, b) => Number(b.gzipKB) - Number(a.gzipKB));
for (const row of rows) {
  console.log(
    `${row.overBudget ? 'FAIL' : ' ok '}  ${row.gzipKB.padStart(8)} KB gzip  ${row.name}`,
  );
}

const totalKB = (total / 1024).toFixed(1);
const budgetKB = (TOTAL_JS_GZIP_BUDGET_BYTES / 1024).toFixed(0);
if (total > TOTAL_JS_GZIP_BUDGET_BYTES) {
  failed = true;
  console.error(`\nFAIL: total JS ${totalKB} KB gzip exceeds the ${budgetKB} KB budget.`);
} else {
  console.log(`\nok: total JS ${totalKB} KB gzip within the ${budgetKB} KB budget.`);
}

if (failed) {
  console.error(
    'Bundle budget exceeded (#213). Split the offending chunk or get a reviewed budget change.',
  );
  process.exit(1);
}

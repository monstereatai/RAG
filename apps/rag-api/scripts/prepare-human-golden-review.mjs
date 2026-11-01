/** Generate a private, explicitly UNREVIEWED sheet from live API observations. */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { opt, report } from './lib/platform-validation-utils.mjs';
import { makeReviewSheet } from './lib/golden-human-review.mjs';

const datasetPath = opt('--dataset', process.env.REVIEWED_GOLDEN_DATASET);
const capturePath = opt('--capture', process.env.REVIEWED_GOLDEN_CAPTURE);
const out = opt('--out', '.tmp/evidence/private-golden-review-sheet.json');
if (!datasetPath || !capturePath) throw new Error('--dataset and --capture required');
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const draft = JSON.parse(await readFile(capturePath, 'utf8'));
const sheet = makeReviewSheet(dataset, draft);
console.log(JSON.stringify({ path: await report(out, sheet), cases: sheet.decisions.length,
  humanReviewed: false, releaseApproved: false,
  next: 'Open original sources and captured answers; a DIFFERENT reviewer fills every decision. Do not commit private files.' }, null, 2));

/** Validate independent human decisions; DO NOT auto-create review labels. */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { opt, report } from './lib/platform-validation-utils.mjs';
import { finalizeHumanReview } from './lib/golden-human-review.mjs';

const datasetPath = opt('--dataset', process.env.REVIEWED_GOLDEN_DATASET);
const capturePath = opt('--capture', process.env.REVIEWED_GOLDEN_CAPTURE);
const reviewPath = opt('--review', process.env.REVIEWED_GOLDEN_REVIEW);
const out = opt('--out', '.tmp/evidence/private-golden-observations.reviewed.json');
if (!datasetPath || !capturePath || !reviewPath) throw new Error('--dataset, --capture, --review required');
const [dataset, draft, decisions] = await Promise.all([datasetPath,capturePath,reviewPath].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const frozen = finalizeHumanReview(dataset, draft, decisions);
console.log(JSON.stringify({ path: await report(out, frozen), reviewerCount: new Set(frozen.runs.map(x=>x.humanReview.reviewerId)).size,
  cases: frozen.runs.length, next: 'Run verify:golden:business --dataset ... --observations <path>; an approved review does NOT mean the quality gate passed.' }, null, 2));

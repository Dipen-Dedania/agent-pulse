// The assets (fonts, music, sfx, screenshots) are binary-identical to the
// first brag run's. This run was authored in an environment with no shell
// access, so instead of committing a second copy they are pulled from the
// sibling composition on first use. Runs automatically before dev/check/render
// via the npm pre-hooks; run `npm run assets` to trigger it by hand.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../brag-output/composition/assets');
const dst = path.resolve(here, 'assets');

if (existsSync(dst)) {
  console.log('assets already present:', dst);
} else if (!existsSync(src)) {
  console.error('source assets not found:', src);
  process.exit(1);
} else {
  cpSync(src, dst, { recursive: true });
  console.log('copied assets from', src);
}

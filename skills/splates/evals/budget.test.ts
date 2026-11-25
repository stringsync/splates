import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * SKILL.md loads into every conversation in a splates repository, so it may
 * not grow past this many words. Lower it whenever a trim lands, never raise
 * it: new text replaces old.
 */
const SKILL_WORDS = 3000;

test(`SKILL.md stays within ${SKILL_WORDS} words`, async () => {
	const text = await Bun.file(join(import.meta.dir, "..", "SKILL.md")).text();
	const words = text.split(/\s+/).filter(Boolean).length;
	expect(words).toBeLessThanOrEqual(SKILL_WORDS);
});

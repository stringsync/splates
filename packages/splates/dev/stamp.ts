const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const VERSION = /^version:.*$/m;

/** `doc` with its frontmatter's `version:` line set to `version`. */
export function stampSkill(doc: string, version: string): string {
	const front = doc.match(FRONTMATTER)?.[0];
	if (front === undefined || !VERSION.test(front)) {
		throw new Error(
			'the skill has no "version:" line in its frontmatter to stamp',
		);
	}
	return (
		front.replace(VERSION, () => `version: ${version}`) +
		doc.slice(front.length)
	);
}

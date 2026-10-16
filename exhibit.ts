/** An exhibit's heading, `### 🖼️ <what it shows>`. */
const EXHIBIT = /^### 🖼️?[ \t]+(.+?)[ \t]*$/;
/** A line that is an image alone: `![header at 390px](/abs/path.png)`. */
const IMAGE = /^[ \t]*!\[[^\]]*\]\([^)]+\)[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Something to look at that the skill captions with the one or two calls it
 * shows, as a reply writes it under `### 🖼️ <title>`: a screenshot, a
 * diagram or a snippet.
 */
export interface Exhibit {
	/** What it shows, from its heading. */
	title: string;
	/** The screenshot, diagram or snippet, as markdown. */
	body: string;
}

/** What the exhibit titled by `line` shows; null for any other line. */
export function exhibitTitle(line: string): string | null {
	return EXHIBIT.exec(line)?.[1] ?? null;
}

/**
 * An assumption's `body` parted into what is to look at, its images and code
 * blocks, as markdown, null when it holds neither, and the words around them.
 */
export function shownIn(body: string): { shown: string | null; said: string } {
	const shown: string[] = [];
	const said: string[] = [];
	let fenced = false;
	for (const line of body.split("\n")) {
		const fence = FENCE.test(line);
		(fenced || fence || IMAGE.test(line) ? shown : said).push(line);
		if (fence) {
			fenced = !fenced;
		}
	}
	return {
		shown: shown.length === 0 ? null : shown.join("\n"),
		said: said.join("\n").trim(),
	};
}

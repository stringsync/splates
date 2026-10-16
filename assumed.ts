import { type Exhibit, exhibitTitle, shownIn } from "./exhibit";
import { assumptions, type Question, questions } from "./plan";

/** A reply's line saying a call the agent made: `- Assumed 3: Three tries`. */
const ASSUMED = /^- Assumed (\d+):[ \t]+(.+?)[ \t]*$/;

/** A heading that ends what an exhibit shows: `#` to `###`. */
const HEADING = /^#{1,3}[ \t]/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * A call the agent made without asking, as the skill's `- Assumed <number>:
 * <what>` line says it in a reply: numbered as in its task's `## Assumptions`.
 */
export interface Assumed {
	number: string;
	/** What it chose, as the line says it. */
	text: string;
	/** What the reply shows it in, when the line captions an exhibit. */
	exhibit?: Exhibit;
}

/**
 * Each of `assumed` as its task's `plan` writes it, matched by number: under
 * `## Assumptions`, or under `## Blocked` once challenged, so a reply that
 * challenged it still reads as it did. One the plan has no item for, as
 * outside a task or once it is gone, is its line alone, with no choices.
 * Either way, one the reply captions an exhibit with shows it, unless the
 * plan already shows it something.
 */
export function assumedIn(plan: string, assumed: Assumed[]): Question[] {
	const items = [...assumptions(plan), ...questions(plan)];
	return assumed.map(({ number, text, exhibit }) => {
		const item = items.find((each) => each.number === number) ?? {
			number,
			done: false,
			text,
			body: "",
			reply: null,
			followUps: [],
			choices: [],
			pick: null,
		};
		return exhibit === undefined || shownIn(item.body).shown !== null
			? item
			: { ...item, body: trimmed([item.body, "", exhibit.body]) };
	});
}

/** Whether `line` is a reply's `- Assumed <number>:` line. */
export function isAssumed(line: string): boolean {
	return ASSUMED.test(line);
}

/**
 * The run of `- Assumed <number>:` lines from `start`, blank lines between
 * them, and the line after it; null for any other line. An exhibit in the
 * run, `### 🖼️ <title>` and what it shows, is what the lines right after it
 * caption, up to a blank line; one that captions none ends the run.
 */
export function assumedAt(
	lines: string[],
	start: number,
): { assumed: Assumed[]; end: number } | null {
	const assumed: Assumed[] = [];
	let end = start;
	let exhibit: Exhibit | undefined;
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i] as string;
		const title = exhibitTitle(line);
		if (title !== null) {
			const shown = shownEnd(lines, i + 1);
			if (!ASSUMED.test(lines[shown] ?? "")) {
				break;
			}
			exhibit = { title, body: trimmed(lines.slice(i + 1, shown)) };
			i = shown - 1;
			continue;
		}
		const said = ASSUMED.exec(line);
		if (said !== null) {
			assumed.push({
				number: said[1] as string,
				text: said[2] as string,
				...(exhibit === undefined ? {} : { exhibit }),
			});
			end = i + 1;
		} else if (line.trim() !== "") {
			break;
		} else {
			exhibit = undefined;
		}
	}
	return assumed.length === 0 ? null : { assumed, end };
}

/**
 * The first line from `start` past what an exhibit shows: a heading or a
 * `- Assumed <number>:` line, outside code blocks; else the end.
 */
function shownEnd(lines: string[], start: number): number {
	let fenced = false;
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i] as string;
		if (FENCE.test(line)) {
			fenced = !fenced;
		} else if (!fenced && (HEADING.test(line) || ASSUMED.test(line))) {
			return i;
		}
	}
	return lines.length;
}

/** `lines` as one text, without blank lines at either end. */
function trimmed(lines: string[]): string {
	return lines.join("\n").replace(/^\n+|\s+$/g, "");
}

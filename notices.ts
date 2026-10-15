import { Duration } from "webappwiz/time";
import type { Need, Needing } from "./needs";

/** Something a row did worth telling the person about, away from the page. */
export interface Notice {
	row: Needing;
	title: string;
	body: string;
}

/** Which notices the person asked for, as the page's Notifications settings say. */
export interface Wants {
	waiting: boolean;
	finished: boolean;
	quiet: boolean;
	/** Minutes a running agent goes without a word before it counts as quiet. */
	quietAfter: number;
}

/** What the last look saw of a row. */
interface Seen {
	kind: Needing["need"]["kind"];
	quiet: boolean;
}

/**
 * Tells what changed in the rows since the last look worth notifying of,
 * the same on the page and on the server, which pushes it to a phone the
 * page cannot run on once it leaves the front.
 */
export class Notices {
	/** By row, what the last look saw; null before the first. */
	private seen: Map<string, Seen> | null = null;

	/**
	 * Compares `rows`, named by `name`, with the last look at `now`, and
	 * returns what changed worth telling, of the kinds `wants` asks for: a
	 * row that came to wait, a conversation that finished its turn, and one
	 * running with no word for the quiet time. The first look tells nothing,
	 * since it has nothing to compare.
	 */
	look(
		rows: Needing[],
		name: (row: Needing) => string,
		now: number,
		wants: Wants,
	): Notice[] {
		const after = Duration.mins(wants.quietAfter);
		const before = this.seen;
		this.seen = new Map(
			rows.map((row) => [
				keyOf(row),
				{ kind: row.need.kind, quiet: quiet(row, now, after) },
			]),
		);
		if (before === null) {
			return [];
		}
		return rows.flatMap((row) => {
			const was = before.get(keyOf(row));
			const is = this.seen?.get(keyOf(row));
			if (was === undefined || is === undefined) {
				return [];
			}
			const need = row.need;
			if (need.kind === "waiting" && was.kind !== "waiting") {
				return wants.waiting
					? [{ row, title: titleOf(row, name), body: wanted(row, need) }]
					: [];
			}
			if (
				row.conversation !== null &&
				need.kind === "idle" &&
				(was.kind === "working" || was.kind === "assuming")
			) {
				return wants.finished
					? [{ row, title: titleOf(row, name), body: lastWords(row) }]
					: [];
			}
			if (is.quiet && !was.quiet && wants.quiet) {
				return [
					{
						row,
						title: titleOf(row, name),
						body: `Quiet for ${after.mins} minutes`,
					},
				];
			}
			return [];
		});
	}
}

/** What tells `row` apart from the others, in a notification and its click. */
export function keyOf(row: Needing): string {
	return row.conversation !== null
		? `conversation ${row.conversation.id}`
		: `task ${row.task?.task}`;
}

/** Whether `row` is a conversation running with no word for `after`. */
function quiet(row: Needing, now: number, after: Duration): boolean {
	const conversation = row.conversation;
	if (conversation?.status !== "running") {
		return false;
	}
	const last = conversation.messages.at(-1);
	const moved = last?.until ?? last?.at ?? null;
	// A log too old to say never counts as quiet.
	return moved !== null && now - Date.parse(moved) >= after.ms;
}

/** Longest a notice's title runs, so a lock screen shows it whole. */
const TITLE_LENGTH = 40;

/** Longest a notice's body runs: one line on a lock screen. */
const BODY_LENGTH = 80;

/** `row`'s name, as a notice's title. */
function titleOf(row: Needing, name: (row: Needing) => string): string {
	return plain(name(row), TITLE_LENGTH);
}

/** One line on what a waiting `row` wants of the person. */
function wanted(
	row: Needing,
	need: Extract<Need, { kind: "waiting" }>,
): string {
	const said = (lead: string, text: string) => {
		const line = plain(text, BODY_LENGTH);
		// A stand-in such as "Failed" says nothing past the lead.
		return line === "" || line === lead
			? lead
			: plain(`${lead}: ${line}`, BODY_LENGTH);
	};
	switch (need.why) {
		case "ask":
			return row.conversation?.ask?.type === "permission"
				? said("Wants to run", need.subject)
				: said("Asks", need.subject);
		case "review":
			return "Ready for review";
		case "failed":
			return said("Failed", need.subject);
		case "questions":
			return said("Asks", need.subject);
		case "escalated":
			return need.questions.length > 0
				? said("Asks", need.subject)
				: said("Escalated", need.subject);
	}
}

/**
 * The first line of what the agent said last, such as its report's title,
 * or a stand-in when it said nothing.
 */
function lastWords(row: Needing): string {
	const said = row.conversation?.messages
		.findLast((message) => message.role === "agent")
		?.parts.findLast((part) => part.type === "text");
	const text = said?.type === "text" ? plain(said.text, BODY_LENGTH) : "";
	return text === "" ? "Its turn is over" : text;
}

/**
 * The first line of `markdown` with its marks taken out, cut to `length`:
 * a notification shows plain text, and a phone only a line or so of it.
 */
export function plain(markdown: string, length: number): string {
	const line =
		markdown
			.split("\n")
			.map((each) =>
				each
					.replace(
						/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/,
						"",
					)
					.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
					.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
					.replace(/(\*\*|__|`)/g, "")
					.replace(/\s+/g, " ")
					.trim(),
			)
			.find((each) => each !== "") ?? "";
	return line.length > length
		? `${line.slice(0, length - 1).trimEnd()}…`
		: line;
}

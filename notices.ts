import { Duration } from "webappwiz/time";
import type { Needing } from "./needs";

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
					? [
							{
								row,
								title: `${name(row)} ${need.why === "failed" ? "failed" : "needs you"}`,
								body: need.subject,
							},
						]
					: [];
			}
			if (
				row.conversation !== null &&
				need.kind === "idle" &&
				(was.kind === "working" || was.kind === "assuming")
			) {
				return wants.finished
					? [{ row, title: `${name(row)} finished`, body: lastWords(row) }]
					: [];
			}
			if (is.quiet && !was.quiet && wants.quiet) {
				return [
					{
						row,
						title: `${name(row)} has gone quiet`,
						body: `No word for ${after.mins} minutes`,
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

/** The start of what the agent said last, or a stand-in when it said nothing. */
function lastWords(row: Needing): string {
	const said = row.conversation?.messages
		.findLast((message) => message.role === "agent")
		?.parts.findLast((part) => part.type === "text");
	const text = said?.type === "text" ? said.text.trim() : "";
	if (text === "") {
		return "Its turn is over";
	}
	return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

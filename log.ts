import { color, type Logger } from "webappwiz/log";
import { age } from "./age";
import type { Entry, Journal } from "./journal";
import { table } from "./table";

/** Enough to cover a session's worth of work without scrolling. */
export const DEFAULT_COUNT = 20;

export interface LogOptions {
	/** How many of the most recent entries to show. */
	count?: number;
	/** Print the entries as JSON instead of a table. */
	json?: boolean;
}

export async function log(
	{ journal, log }: { journal: Journal; log: Logger },
	{ count = DEFAULT_COUNT, json = false }: LogOptions = {},
): Promise<void> {
	const entries = await journal.tail(count);

	if (json) {
		log.info(JSON.stringify(entries, null, "\t"));
		return;
	}
	if (entries.length === 0) {
		log.info("nothing recorded yet");
		return;
	}
	log.info(table(["WHEN", "ACTION", "TASK", "RESULT"], entries.map(row)));
}

function row(entry: Entry): string[] {
	return [
		age(entry.at),
		entry.action,
		entry.task ?? "-",
		entry.reason === null ? color.green("ok") : color.red(entry.reason),
	];
}

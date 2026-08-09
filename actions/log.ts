import { color, type Logger } from "@webappwiz/log";
import { age } from "../lib/age";
import type { Entry, Journal } from "../lib/journal";
import { table } from "../lib/table";

/** Enough to cover a session's worth of work without scrolling. */
export const DEFAULT_COUNT = 20;

export async function log(
	{ journal, log }: { journal: Journal; log: Logger },
	{ count = DEFAULT_COUNT, json = false } = {},
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

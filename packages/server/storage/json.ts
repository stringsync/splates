import type { Schema } from "./schema";

/** `value` as a document keeps it: tab-indented, ending in a newline. */
export function documentText(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

/** `entries` as a log keeps them, one JSON line each. */
export function logLines(entries: unknown[]): string {
	return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

/**
 * The entries in `raw`, one per line, leaving out any line torn by a crash
 * mid-append or that `schema` refuses.
 */
export function entriesOf<T>(raw: string, schema?: Schema<T>): T[] {
	return raw
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const entry: unknown = JSON.parse(line);
				return [schema === undefined ? (entry as T) : schema.parse(entry)];
			} catch {
				return [];
			}
		});
}

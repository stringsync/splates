import { logLine } from "./log-lines";

const STAMP =
	/^\[?(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?\]?\s*/;

/**
 * The time a line opens with, when it opens with one that is recognizable
 * (ISO, with a T or a space, a `.` or `,` before the fraction, a zone or none,
 * which is local time), and the line without it.
 */
export function parseStamp(
	line: string,
): { at: number; rest: string } | undefined {
	const match = STAMP.exec(line);
	if (!match) {
		return undefined;
	}
	const [whole, date, time, fraction = "", zone = ""] = match;
	const at = Date.parse(
		`${date}T${time}${fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : ""}${zone}`,
	);
	return Number.isNaN(at) ? undefined : { at, rest: line.slice(whole.length) };
}

/** A level for a line that carries none of its own, found by the word it uses. */
export function guessLevel(text: string): string {
	if (/\b(FATAL|PANIC|ERROR|ERR|EXCEPTION)\b/i.test(text)) {
		return "error";
	}
	if (/\b(WARN|WARNING)\b/i.test(text)) {
		return "warn";
	}
	return "info";
}

/** A line of docker or a tailed file as a log line: its time, a guessed level, its text. */
export function sourceLine(at: number, text: string): string {
	return logLine(at, guessLevel(text), text);
}

/** A name safe to put in a file name. */
export function fileSafe(name: string): string {
	return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

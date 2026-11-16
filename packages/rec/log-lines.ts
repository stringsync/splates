/** The lines the browser logs are made of: Chrome's own time, a level, then the text on one line. */

export interface RemoteObject {
	type?: string;
	value?: unknown;
	description?: string;
	unserializableValue?: string;
}

export interface ExceptionDetails {
	text?: string;
	url?: string;
	lineNumber?: number;
	exception?: RemoteObject;
}

/** One log line: Chrome's own time in ISO form, a level, then the text on a single line. */
export function logLine(at: number, level: string, text: string): string {
	const flat = text.replace(/\r?\n/g, "\\n");
	return `${new Date(at).toISOString()} ${level.toUpperCase().padEnd(5)} ${flat}`;
}

function show(object: RemoteObject): string {
	if (object.value !== undefined) {
		return typeof object.value === "string"
			? object.value
			: JSON.stringify(object.value);
	}
	return object.unserializableValue ?? object.description ?? object.type ?? "";
}

export const LEVELS: Record<string, string> = {
	warning: "warn",
	assert: "error",
	log: "info",
};

/** A `console.*` call as a line, its arguments joined as the console prints them. */
export function consoleLine(
	at: number,
	type: string,
	args: RemoteObject[],
): string {
	return logLine(at, LEVELS[type] ?? type, args.map(show).join(" "));
}

/** An uncaught exception as a line: the error's own description when it has one, with where it threw. */
export function exceptionLine(at: number, details: ExceptionDetails): string {
	const text =
		details.exception?.description ?? details.exception?.value ?? details.text;
	const where = details.url
		? ` (${details.url}:${(details.lineNumber ?? 0) + 1})`
		: "";
	return logLine(at, "exception", `${String(text ?? "uncaught")}${where}`);
}

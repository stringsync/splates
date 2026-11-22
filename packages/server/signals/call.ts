import { fail } from "../exit";
import { normalizeClock } from "./clock-schedule";

/** A signal's identity: the signal function, and its arguments with keys sorted and values normalized. */
export interface Call {
	fn: string;
	args: Record<string, string | number | boolean>;
	/** `name` alone, or `name({ key: value, ... })`, the form that names the signal. */
	canonical: string;
}

/** One field of a signal function's arguments, as `splates.config.ts` declares it. */
export interface SignalFunctionField {
	type: "string" | "number" | "boolean";
	description: string;
	optional?: boolean;
}

/** A signal function of signals: what its calls take, and how a project makes it true. */
export interface SignalFunction {
	description: string;
	/** Its fields; none for a signal function that takes no arguments. */
	args?: Record<string, SignalFunctionField>;
	/** The field a plain value maps to, as `clock.in("2 days")`. */
	main?: string;
	examples?: string[];
	/** A script run with the arguments as JSON in `$SPLATES_ARGS`, in the project's main tree. */
	poll?: { interval: string; script: string };
}

/** The prefixes only standard signal functions may use. */
export const RESERVED_PREFIXES = ["clock.", "task.", "machine."] as const;

const TASK_EVENT: Record<string, SignalFunctionField> = {
	task: { type: "number", description: "the task's number" },
	lane: {
		type: "number",
		description: "only tasks in this lane",
		optional: true,
	},
	stage: {
		type: "string",
		description: "only tasks in this stage",
		optional: true,
	},
};

/** The signal functions splates itself provides. */
export const STANDARD_SIGNAL_FUNCTIONS: Record<string, SignalFunction> = {
	"clock.in": {
		description: "Once, after a delay",
		args: {
			after: { type: "string", description: "a delay, as 2 days" },
			tz: { type: "string", description: "a time zone", optional: true },
		},
		main: "after",
		examples: ['clock.in("2 days")'],
	},
	"clock.at": {
		description: "Once, at a time",
		args: {
			time: { type: "string", description: "a time, as next monday 9am" },
			tz: { type: "string", description: "a time zone", optional: true },
		},
		main: "time",
		examples: ['clock.at("2026-12-01 09:00")'],
	},
	"clock.interval": {
		description: "Each interval, catching up once after downtime",
		args: {
			interval: { type: "string", description: "the gap, as 2 days" },
			at: { type: "string", description: "the time of day", optional: true },
			tz: { type: "string", description: "a time zone", optional: true },
		},
		main: "interval",
		examples: ['clock.interval({ interval: "2 days", at: "9am" })'],
	},
	"clock.cron": {
		description: "On a cron schedule",
		args: {
			expr: { type: "string", description: "a cron expression" },
			tz: { type: "string", description: "a time zone", optional: true },
		},
		main: "expr",
		examples: ['clock.cron("0 9 * * 1")'],
	},
	...Object.fromEntries(
		["created", "queued", "started", "done", "dropped", "updated"].map(
			(event) => [
				`task.${event}`,
				{
					description: `A task is ${event}`,
					args: TASK_EVENT,
					main: "task",
					examples: [`task.${event}(812)`],
				} satisfies SignalFunction,
			],
		),
	),
	"machine.idle": {
		description: "Once the machine has been idle that long",
		args: { for: { type: "string", description: "how long, as 10m" } },
		main: "for",
		examples: ['machine.idle("10m")'],
	},
};

/** A call as written: its signal function and the arguments given, if any. */
export interface ParsedCall {
	fn: string;
	/** The JSON5 value in the parentheses; undefined with none. */
	args: unknown;
}

const FUNCTION_NAME = /^[\w-]+(?:\.[\w-]+)+/;
/** The older `<project>/<name>` is read as its dotted form. */
const OLD_FUNCTION_NAME = /^[\w-]+(?:[./][\w-]+)+/;

/**
 * Reads `name` or `name(<JSON5>)`. The argument is parsed, never
 * evaluated, may span lines, and ends at the parenthesis matching the first.
 */
export function parseCall(text: string): ParsedCall {
	const source = text.trim();
	const named = OLD_FUNCTION_NAME.exec(source);
	if (named === null) {
		fail(
			"usage",
			`'${text}' is no signal: write <signal function>(<arguments>), as clock.in("2 days") or mdom.released`,
			{ name: text },
		);
	}
	const fn = named[0].replaceAll("/", ".");
	const rest = source.slice(named[0].length).trim();
	if (rest === "") {
		return { fn, args: undefined };
	}
	if (!rest.startsWith("(")) {
		fail("usage", `'${text}': expected '(' after ${fn}`, { name: text });
	}
	const close = matching(rest);
	if (close === -1) {
		fail("usage", `'${text}': the parenthesis after ${fn} never closes`, {
			name: text,
		});
	}
	if (rest.slice(close + 1).trim() !== "") {
		fail("usage", `'${text}': nothing may follow the closing parenthesis`, {
			name: text,
		});
	}
	const inner = rest.slice(1, close).trim();
	if (inner === "") {
		return { fn, args: undefined };
	}
	try {
		return { fn, args: Bun.JSON5.parse(inner) as unknown };
	} catch {
		fail("usage", `'${text}': the arguments are not JSON5 (${inner})`, {
			name: text,
		});
	}
}

/** What each signal function is known as: the standard ones, and the project's declared. */
export type SignalFunctions = Record<string, SignalFunction>;

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Reads `text` against `signalFunctions`, refusing arguments the signal function does not take. */
export function callOf(text: string, signalFunctions: SignalFunctions): Call {
	const { fn, args } = parseCall(text);
	const known = signalFunctions[fn];
	if (
		known === undefined &&
		RESERVED_PREFIXES.some((prefix) => fn.startsWith(prefix))
	) {
		const siblings = Object.keys(STANDARD_SIGNAL_FUNCTIONS).filter((each) =>
			each.startsWith(fn.split(".")[0] ?? ""),
		);
		fail(
			"usage",
			`'${fn}' is no standard signal function; ${fn.split(".")[0] ?? ""}. is reserved. Standard: ${siblings.join(", ")}`,
			{ fn },
		);
	}
	const given = mapped(fn, args, known);
	const fields = known?.args;
	const normal: Record<string, string | number | boolean> = {};
	for (const key of Object.keys(given).sort()) {
		const value = given[key];
		const field = fields?.[key];
		if (fields !== undefined && field === undefined) {
			fail(
				"usage",
				`${fn} takes no '${key}': its fields are ${Object.keys(fields).join(", ") || "none"}`,
				{ fn, field: key },
			);
		}
		normal[key] = normalized(fn, key, value, field?.type);
	}
	for (const [key, field] of Object.entries(fields ?? {})) {
		if (field.optional !== true && !(key in normal)) {
			fail("usage", `${fn} needs '${key}': ${field.description}`, {
				fn,
				field: key,
			});
		}
	}
	normalizeClock(fn, normal);
	const keys = Object.keys(normal).sort();
	const body = keys
		.map(
			(key) =>
				`${IDENT.test(key) ? key : JSON.stringify(key)}: ${JSON.stringify(normal[key])}`,
		)
		.join(", ");
	return {
		fn,
		args: normal,
		canonical: keys.length === 0 ? fn : `${fn}({ ${body} })`,
	};
}

function mapped(
	fn: string,
	args: unknown,
	known: SignalFunction | undefined,
): Record<string, unknown> {
	if (args === undefined) {
		return {};
	}
	if (typeof args === "object" && args !== null && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}
	if (known?.main === undefined) {
		fail(
			"usage",
			`${fn} takes an object of arguments, as ${fn}({ key: value })`,
			{ fn },
		);
	}
	return { [known.main]: args };
}

function normalized(
	fn: string,
	key: string,
	value: unknown,
	type: SignalFunctionField["type"] | undefined,
): string | number | boolean {
	const kind = typeof value;
	if (kind !== "string" && kind !== "number" && kind !== "boolean") {
		fail("usage", `${fn}: '${key}' must be a string, number or boolean`, {
			fn,
			field: key,
		});
	}
	if (type !== undefined && kind !== type) {
		fail("usage", `${fn}: '${key}' must be a ${type}, not a ${kind}`, {
			fn,
			field: key,
		});
	}
	if (typeof value === "string") {
		const text = value.trim().replace(/\s+/g, " ");
		return text;
	}
	return value as number | boolean;
}

/** Refuses a `signals` setting that is not a record of signal functions; returns it. */
export function checkSignalFunctions(signals: unknown): SignalFunctions {
	if (signals === undefined || signals === null) {
		return {};
	}
	if (typeof signals !== "object" || Array.isArray(signals)) {
		throw new Error(
			"splates.config.ts: `signals` maps each signal function to its declaration",
		);
	}
	for (const [name, fn] of Object.entries(signals)) {
		if (!FUNCTION_NAME.test(name) || FUNCTION_NAME.exec(name)?.[0] !== name) {
			throw new Error(
				`splates.config.ts: signals '${name}' is no signal function name, as aws.stack-ready`,
			);
		}
		if (RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
			throw new Error(
				`splates.config.ts: signals '${name}' uses a reserved prefix (clock., task., machine.)`,
			);
		}
		const declared = fn as SignalFunction;
		useDeprecatedPoll(name, declared);
		if (
			typeof declared?.description !== "string" ||
			declared.description === ""
		) {
			throw new Error(
				`splates.config.ts: signals '${name}' needs a description`,
			);
		}
		if (
			declared.main !== undefined &&
			declared.args?.[declared.main] === undefined
		) {
			throw new Error(
				`splates.config.ts: signals '${name}' main '${declared.main}' is not one of its args`,
			);
		}
	}
	return signals as SignalFunctions;
}

/**
 * Reads an older `probe: { every, script }` as `poll: { interval, script }`,
 * saying so once, so configs declared before the rename still load.
 */
function useDeprecatedPoll(name: string, declared: SignalFunction): void {
	const old = declared as SignalFunction & {
		probe?: { every?: string; interval?: string; script: string };
		poll?: { every?: string; interval?: string; script: string };
	};
	const given = old.poll ?? old.probe;
	if (given === undefined) {
		return;
	}
	if (old.probe !== undefined || given.every !== undefined) {
		console.error(
			`splates.config.ts: signals '${name}' uses the deprecated \`probe\`/\`every\`: write \`poll: { interval, script }\``,
		);
	}
	delete old.probe;
	declared.poll = {
		interval: String(given.interval ?? given.every),
		script: given.script,
	};
}

/** The index of the parenthesis closing the one at 0, skipping strings and comments; -1 for none. */
function matching(text: string): number {
	let depth = 0;
	for (let at = 0; at < text.length; at++) {
		const char = text[at];
		if (char === '"' || char === "'") {
			at = endOfString(text, at);
			if (at === -1) {
				return -1;
			}
		} else if (char === "/" && text[at + 1] === "/") {
			const end = text.indexOf("\n", at);
			at = end === -1 ? text.length : end;
		} else if (char === "/" && text[at + 1] === "*") {
			const end = text.indexOf("*/", at + 2);
			if (end === -1) {
				return -1;
			}
			at = end + 1;
		} else if (char === "(") {
			depth++;
		} else if (char === ")") {
			depth--;
			if (depth === 0) {
				return at;
			}
		}
	}
	return -1;
}

function endOfString(text: string, start: number): number {
	const quote = text[start];
	for (let at = start + 1; at < text.length; at++) {
		if (text[at] === "\\") {
			at++;
		} else if (text[at] === quote) {
			return at;
		}
	}
	return -1;
}

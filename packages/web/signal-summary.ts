import type { SignalOverview, SignalRaise } from "@splates/server/signals";

/** A signal name split into its signal function and the arguments its call gives. */
export interface CallParts {
	fn: string;
	/** Each argument as its key and shown value, in the canonical order. */
	args: [key: string, value: string][];
}

const ARGUMENT =
	/\s*([A-Za-z_$][\w$]*|"(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*"|-?[\d.]+(?:e[+-]?\d+)?|true|false)\s*,?/gy;

/**
 * Splits a canonical call, `aws.stack-ready({ stack: "x" })`, into its
 * signal function and arguments; a bare name has none.
 */
export function callParts(name: string): CallParts {
	const open = name.indexOf("(");
	if (open === -1 || !name.endsWith("})")) {
		return { fn: name, args: [] };
	}
	const body = name.slice(open + 2, -2);
	const args: CallParts["args"] = [];
	ARGUMENT.lastIndex = 0;
	for (
		let found = ARGUMENT.exec(body);
		found !== null;
		found = ARGUMENT.exec(body)
	) {
		const key = found[1] ?? "";
		const value = found[2] ?? "";
		args.push([
			key.startsWith('"') ? (JSON.parse(key) as string) : key,
			value.startsWith('"') ? (JSON.parse(value) as string) : value,
		]);
	}
	return { fn: name.slice(0, open), args };
}

/**
 * The namespace a signal's name puts it in, everything before its last dot
 * (`mono.task` for `mono.task.started`), and its own name within it.
 */
export function namespaceOf(name: string): { namespace: string; leaf: string } {
	const { fn: whole } = callParts(name);
	const at = whole.lastIndexOf(".");
	return at <= 0
		? { namespace: whole, leaf: whole }
		: { namespace: whole.slice(0, at), leaf: whole.slice(at + 1) };
}

/** Signals that share a namespace, listed together under its name. */
export interface SignalNamespace {
	namespace: string;
	signals: SignalOverview[];
	/** Their raises of the last 7 days, all told. */
	raises: number;
}

/**
 * `signals` gathered into namespaces, the namespace raised most lately first and
 * within one the signal raised most lately first; a signal never raised goes
 * after those that were, by name.
 */
export function namespacesOf(signals: SignalOverview[]): SignalNamespace[] {
	const byNamespace = new Map<string, SignalOverview[]>();
	for (const each of [...signals].sort(latestFirst)) {
		const { namespace } = namespaceOf(each.name);
		byNamespace.set(namespace, [...(byNamespace.get(namespace) ?? []), each]);
	}
	return [...byNamespace].map(([namespace, members]) => ({
		namespace,
		signals: members,
		raises: members.reduce((sum, each) => sum + each.raises.length, 0),
	}));
}

function latestFirst(one: SignalOverview, other: SignalOverview): number {
	const at = (signal: SignalOverview) => signal.raises[0]?.at ?? "";
	return at(other).localeCompare(at(one)) || one.name.localeCompare(other.name);
}

/** One day's raises, for the chart. */
export interface RaiseDay {
	/** `Today`, else the weekday, `Mon`. */
	label: string;
	count: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** How many raises fell on each of the last `days` local days, oldest first, today last. */
export function raisesPerDay(
	raises: SignalRaise[],
	now: number,
	days = 7,
): RaiseDay[] {
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	return Array.from({ length: days }, (_, index) => {
		const start = new Date(today);
		start.setDate(today.getDate() - (days - 1 - index));
		const end = new Date(start);
		end.setDate(start.getDate() + 1);
		const count = raises.filter((raise) => {
			const at = Date.parse(raise.at);
			return at >= start.getTime() && at < end.getTime();
		}).length;
		return {
			label: index === days - 1 ? "Today" : (WEEKDAYS[start.getDay()] ?? ""),
			count,
		};
	});
}

/** The day with the most raises, the latest on a tie, or null when none had any. */
export function busiestDay(days: RaiseDay[]): RaiseDay | null {
	return days.reduce<RaiseDay | null>(
		(best, day) =>
			day.count > 0 && day.count >= (best?.count ?? 0) ? day : best,
		null,
	);
}

/** Who raised it most often, or null for no raises. */
export function usualRaiser(raises: SignalRaise[]): string | null {
	const counts = new Map<string, number>();
	for (const raise of raises) {
		counts.set(raise.by, (counts.get(raise.by) ?? 0) + 1);
	}
	let best: string | null = null;
	for (const [by, count] of counts) {
		if (best === null || count > (counts.get(best) ?? 0)) {
			best = by;
		}
	}
	return best;
}

/** The column a payload that is no object shows under. */
export const WHOLE = "payload";

/** The most payload fields the raises table gives columns; the rest show in the raw JSON. */
const MOST_COLUMNS = 4;

/**
 * The columns the raises table gives their payloads: each object field that
 * some raise fills, in the order the newest raises name them, then `payload`
 * when some payload is not an object.
 */
export function payloadColumns(raises: SignalRaise[]): string[] {
	const columns: string[] = [];
	let whole = false;
	for (const { payload } of raises) {
		if (isRecord(payload)) {
			for (const [key, value] of Object.entries(payload)) {
				if (!isEmpty(value) && !columns.includes(key)) {
					columns.push(key);
				}
			}
		} else if (!isEmpty(payload)) {
			whole = true;
		}
	}
	return [...columns.slice(0, MOST_COLUMNS), ...(whole ? [WHOLE] : [])];
}

/** What a raise holds under `column`, undefined for nothing. */
export function cellOf(payload: unknown, column: string): unknown {
	if (column === WHOLE) {
		return isRecord(payload) ? undefined : payload;
	}
	return isRecord(payload) ? payload[column] : undefined;
}

/** The task numbers a cell holds, when it is a list of them, else null. */
export function taskNumbers(column: string, value: unknown): number[] | null {
	return column === "numbers" &&
		Array.isArray(value) &&
		value.every((each) => Number.isInteger(each) && each > 0)
		? (value as number[])
		: null;
}

/** A cell as text: a string as it is, anything else as compact JSON. */
export function cellText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

/** Whether a value says nothing worth a cell: null, absent, `""`, `[]` or `{}`. */
export function isEmpty(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		value === "" ||
		(Array.isArray(value) && value.length === 0) ||
		(isRecord(value) && Object.keys(value).length === 0)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The latest removal reason, until a newer probe or raise supplies this signal again. */
export function removalOf(signal: SignalOverview): string | undefined {
	if (liveCount(signal) > 0) {
		return undefined;
	}
	const removed = signal.subscribers
		.filter((each) => each.state === "removed" && each.reason !== undefined)
		.sort((first, second) =>
			(second.endedAt ?? "").localeCompare(first.endedAt ?? ""),
		)[0];
	const probe = signal.probe;
	const probeRemoved =
		probe !== null &&
		["stopped", "replaced", "timed out"].includes(probe.state);
	const at = probeRemoved ? (probe?.endedAt ?? "") : (removed?.endedAt ?? "");
	if ((signal.raises[0]?.at ?? "") > at || (probe?.startedAt ?? "") > at) {
		return undefined;
	}
	return probeRemoved ? `probe ${probe?.state}` : removed?.reason;
}

/** How many subscribers still wait on `signal` or, for an automation, are not paused. */
export function liveCount(signal: SignalOverview): number {
	return signal.subscribers.filter((each) => each.live).length;
}

/** "2 subscribers", "1 subscriber", or null for none. */
export function subscribersText(count: number): string | null {
	return count === 0
		? null
		: `${count} ${count === 1 ? "subscriber" : "subscribers"}`;
}

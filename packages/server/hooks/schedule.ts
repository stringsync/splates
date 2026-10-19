import { fail } from "../exit";

/** When a schedule runs next after a time, in epoch milliseconds. */
export interface Schedule {
	nextAfter(at: number): number;
}

/** A trigger's schedule, refusing one that will not read. */
export function scheduleOf(
	trigger: { every: string } | { cron: string },
): Schedule {
	return "every" in trigger ? everyOf(trigger.every) : cronOf(trigger.cron);
}

/** `30m`, `2h`, `1d`: a run that long after the last. */
function everyOf(every: string): Schedule {
	const match = /^(\d+)\s*(m|h|d)$/.exec(every.trim());
	const count = Number(match?.[1]);
	if (match === null || count < 1) {
		fail(
			"usage",
			`'${every}' is no interval: give minutes, hours or days, as 30m, 2h or 1d`,
			{ every },
		);
	}
	const ms = count * UNIT[match[2] as keyof typeof UNIT];
	return { nextAfter: (at) => at + ms };
}

const UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** The fields of a cron line, in order, each with the values it takes. */
const FIELDS = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "day of month", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12 },
	{ name: "day of week", min: 0, max: 7 },
] as const;

/**
 * A five-field cron line (`0 9 * * 1-5`), in the machine's own time: each
 * field `*`, a number, a range `a-b`, any of those `/step`, or a list of
 * them. As in cron, a day matches when either day field does, once both are
 * set; Sunday is 0 or 7.
 */
function cronOf(line: string): Schedule {
	const parts = line.trim().split(/\s+/);
	if (parts.length !== FIELDS.length) {
		fail(
			"usage",
			`'${line}' is no cron line: give five fields, minute hour day month weekday, as "0 9 * * 1-5"`,
			{ cron: line },
		);
	}
	const [minutes, hours, days, months, weekdays] = parts.map((part, at) =>
		valuesOf(part, FIELDS[at] as (typeof FIELDS)[number], line),
	) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
	if (weekdays.has(7)) {
		weekdays.add(0);
	}
	const anyDay = parts[2] === "*";
	const anyWeekday = parts[4] === "*";
	const dayMatches = (date: Date): boolean => {
		const day = days.has(date.getDate());
		const weekday = weekdays.has(date.getDay());
		if (anyDay || anyWeekday) {
			return day && weekday;
		}
		return day || weekday;
	};
	return {
		nextAfter(at) {
			const date = new Date(at);
			date.setSeconds(0, 0);
			date.setMinutes(date.getMinutes() + 1);
			// Five years covers any line that matches at all, a 29 February too.
			const until = at + 5 * 366 * UNIT.d;
			while (date.getTime() <= until) {
				if (!months.has(date.getMonth() + 1)) {
					date.setMonth(date.getMonth() + 1, 1);
					date.setHours(0, 0);
				} else if (!dayMatches(date)) {
					date.setDate(date.getDate() + 1);
					date.setHours(0, 0);
				} else if (!hours.has(date.getHours())) {
					date.setHours(date.getHours() + 1, 0);
				} else if (!minutes.has(date.getMinutes())) {
					date.setMinutes(date.getMinutes() + 1);
				} else {
					return date.getTime();
				}
			}
			return Number.POSITIVE_INFINITY;
		},
	};
}

/** The values one cron field takes. */
function valuesOf(
	part: string,
	field: (typeof FIELDS)[number],
	line: string,
): Set<number> {
	const values = new Set<number>();
	for (const item of part.split(",")) {
		const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
		const from = match?.[2] === undefined ? field.min : Number(match[2]);
		const to =
			match?.[3] !== undefined
				? Number(match[3])
				: match?.[2] === undefined || match[4] !== undefined
					? field.max
					: from;
		const step = match?.[4] === undefined ? 1 : Number(match[4]);
		if (
			match === null ||
			from < field.min ||
			to > field.max ||
			from > to ||
			step < 1
		) {
			fail(
				"usage",
				`'${line}' is no cron line: its ${field.name} '${part}' takes ${field.min} to ${field.max}`,
				{ cron: line },
			);
		}
		for (let value = from; value <= to; value += step) {
			values.add(value);
		}
	}
	return values;
}

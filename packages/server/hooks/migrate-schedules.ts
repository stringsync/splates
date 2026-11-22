import { callOf, STANDARD_SIGNAL_FUNCTIONS } from "../signals/call";
import { newClock, type SignalClock } from "../signals/clock-schedule";
import type { RunStore } from "./runs";
import type { HookStore } from "./store";

/** Where the clocks of the signals book are kept. */
export interface ClockShelf {
	clocks(): Promise<SignalClock[]>;
	keepClock(clock: SignalClock): Promise<void>;
}

/**
 * Turns each saved `every` and `cron` automation into a subscription on
 * `clock.interval` or `clock.cron`, in place, keeping its number, hook,
 * name and pause. The clock starts where the old schedule counted from (its
 * last scheduled run, creation or edit), so its next due time stays what it
 * was and one missed while the server was down still runs once. A schedule
 * the clock cannot take is left as it is. Returns how many moved.
 */
export async function migrateSchedules(
	store: HookStore,
	runs: RunStore,
	shelf: ClockShelf,
	zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Promise<number> {
	const found = (await store.read()).filter(
		(each) =>
			each.source === undefined &&
			("every" in each.trigger || "cron" in each.trigger),
	);
	if (found.length === 0) {
		return 0;
	}
	const scheduled = await runs.read();
	const kept = new Set((await shelf.clocks()).map(({ name }) => name));
	let moved = 0;
	for (const each of found) {
		try {
			const { trigger } = each;
			const text =
				"every" in trigger
					? `clock.interval(${JSON.stringify({ interval: trigger.every })})`
					: "cron" in trigger
						? `clock.cron(${JSON.stringify({ expr: trigger.cron })})`
						: null;
			if (text === null) {
				continue;
			}
			const call = callOf(
				text.replace(/\}\)$/, `,"tz":${JSON.stringify(zone)}})`),
				STANDARD_SIGNAL_FUNCTIONS,
			);
			if (!kept.has(call.canonical)) {
				// The old schedule counted from the latest of these.
				const base = Math.max(
					Date.parse(scheduled[each.id]?.scheduledAt ?? each.createdAt),
					Date.parse(each.editedAt ?? each.createdAt),
				);
				await shelf.keepClock(
					newClock(call.canonical, call.fn, call.args, base),
				);
				kept.add(call.canonical);
			}
			await store.retrigger(each.id, { signal: call.canonical });
			moved += 1;
		} catch {
			// Left as it was: the scheduler still runs it.
		}
	}
	return moved;
}

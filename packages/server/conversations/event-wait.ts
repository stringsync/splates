import { Duration } from "core/time";
import type { Message } from "./state";

export type EventWait =
	| { type: "task"; task: string }
	| { type: "idle"; duration: Duration };

/** Reads a task or machine-idle wait from the final line of an agent reply. */
export function eventWaitOf(message: Message | undefined): EventWait | null {
	if (message?.role !== "agent") {
		return null;
	}
	const text = message.parts
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n\n")
		.trim();
	const task = /(?:^|\n)\[SPLATES WAIT task ([a-z0-9][a-z0-9-]*)\]$/.exec(text);
	if (task !== null) {
		return { type: "task", task: task[1] as string };
	}
	const idle = /(?:^|\n)\[SPLATES WAIT machine idle (\d+)(ms|s|m|h)\]$/.exec(
		text,
	);
	if (idle === null) {
		return null;
	}
	const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
	const ms = Number(idle[1]) * scale[idle[2] as keyof typeof scale];
	return Number.isSafeInteger(ms) && ms > 0
		? { type: "idle", duration: Duration.ms(ms) }
		: null;
}

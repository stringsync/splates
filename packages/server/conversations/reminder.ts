import { Duration } from "core/time";
import type { ReminderCard } from "./state";

/** How long the person is gone from a conversation before it reminds them what its task is for. */
export const AWAY = Duration.hrs(1);

// How stale the log's last visit may be, so a restart still judges `AWAY` closely.
export const VISIT_KEPT = Duration.mins(5);

/** The card a request body holds, or null for none or one not shaped as a card. */
export function reminderCardOf(value: unknown): ReminderCard | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const { task, line, before, after } = value as Record<string, unknown>;
	return typeof task === "string" &&
		typeof line === "string" &&
		typeof before === "string" &&
		typeof after === "string"
		? { task, line, before, after }
		: null;
}

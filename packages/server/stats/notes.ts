import type { Event } from "../records";
import type { Judged } from "./adherence";
import type { Outcome } from "./outcomes";

/**
 * Compares the conversations that got note pointers with the ones held out,
 * and reads how the routing did, from `events` of one project, its
 * `outcomes` and `judged` skill checks. A conversation counts once the
 * router has judged a message in it: whatever its first judgment said of the
 * holdout holds for it.
 */
export function noteStats(
	events: Event[],
	outcomes: Outcome[],
	judged: Judged[],
	project: string,
): NoteStats {
	const arms = new Map<string, "pointed" | "holdout">();
	const times: number[] = [];
	const rows = new Map<string, NoteRow>();
	const row = (path: string): NoteRow => {
		const found = rows.get(path) ?? {
			path,
			now: 0,
			optional: 0,
			nowRead: 0,
			optionalRead: 0,
			unprompted: 0,
			judged: 0,
			applied: 0,
		};
		rows.set(path, found);
		return found;
	};
	// What each conversation was pointed at, by note: the tiers not yet followed by a read.
	const waiting = new Map<string, Map<string, "now" | "optional">>();
	const pointedAt = new Set<string>();
	let messages = 0;
	let attached = 0;
	for (const event of events) {
		if (event.reason !== null || event.conversation === null) {
			continue;
		}
		const conversation = event.conversation;
		if (event.action === "notes attached") {
			if (!arms.has(conversation)) {
				arms.set(conversation, event.holdout ? "holdout" : "pointed");
			}
			if (arms.get(conversation) === "holdout") {
				continue;
			}
			messages += 1;
			times.push(event.ms);
			const tiers = event.notes.filter((note) => note.tier !== null);
			if (tiers.length > 0) {
				attached += 1;
			}
			for (const note of tiers) {
				const entry = row(note.path);
				if (note.tier === "now") {
					entry.now += 1;
				} else {
					entry.optional += 1;
				}
				const open = waiting.get(conversation) ?? new Map();
				open.set(note.path, note.tier);
				waiting.set(conversation, open);
				pointedAt.add(`${conversation}\n${note.path}`);
			}
			// A note held in context is not a miss when it is not read again.
			for (const note of event.notes) {
				if (note.inContext) {
					pointedAt.add(`${conversation}\n${note.path}`);
				}
			}
		} else if (
			event.action === "note read" &&
			arms.get(conversation) === "pointed"
		) {
			const entry = row(event.path);
			const open = waiting.get(conversation);
			const tier = open?.get(event.path);
			if (tier !== undefined) {
				open?.delete(event.path);
				if (tier === "now") {
					entry.nowRead += 1;
				} else {
					entry.optionalRead += 1;
				}
			} else if (!pointedAt.has(`${conversation}\n${event.path}`)) {
				entry.unprompted += 1;
				pointedAt.add(`${conversation}\n${event.path}`);
			}
		} else if (
			event.action === "note applied" &&
			arms.get(conversation) === "pointed"
		) {
			const entry = row(event.path);
			entry.judged += 1;
			if (event.probability >= APPLIED) {
				entry.applied += 1;
			}
		}
	}
	const arm = (which: "pointed" | "holdout"): Arm => {
		const own = new Set(
			[...arms].filter(([, each]) => each === which).map(([id]) => id),
		);
		const ended = outcomes.filter(
			(each) =>
				each.project === project &&
				!each.base.startsWith("task/") &&
				each.conversation !== null &&
				own.has(each.conversation),
		);
		const merged = ended.filter((each) => each.ended === "merged");
		const removed = ended.filter((each) => each.ended === "removed");
		const used = merged.filter((each) => each.usage !== undefined);
		const checks = judged
			.filter((each) => own.has(each.conversation))
			.flatMap((each) => Object.values(each.scores));
		const passed = checks.reduce((sum, each) => sum + each.passed, 0);
		return {
			conversations: own.size,
			merged: merged.length,
			removed: removed.length,
			firstTry: merged.filter((each) => each.failedMerges === 0).length,
			redone: removed.filter(
				(each) =>
					each.removedFor === "redo" || each.removedFor === "superseded",
			).length,
			used: used.length,
			tokens: used.reduce(
				(sum, each) =>
					sum + (each.usage?.input ?? 0) + (each.usage?.output ?? 0),
				0,
			),
			checksPassed: passed,
			checksApplied:
				passed + checks.reduce((sum, each) => sum + each.failed, 0),
		};
	};
	const sorted = [...times].sort((one, other) => one - other);
	const at = (share: number): number | null =>
		sorted.length === 0
			? null
			: (sorted[
					Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)
				] ?? null);
	return {
		pointed: arm("pointed"),
		holdout: arm("holdout"),
		messages,
		attached,
		p50: at(0.5),
		p95: at(0.95),
		notes: [...rows.values()].sort(
			(one, other) =>
				other.now + other.optional - (one.now + one.optional) ||
				one.path.localeCompare(other.path),
		),
	};
}

/** The probability at which a judged note counts as applied, the router's own bar for worth. */
export const APPLIED = 0.5;

/** How tasks went in conversations of one arm, summed. */
export interface Arm {
	/** Conversations the router judged a message of. */
	conversations: number;
	/** Tasks they merged or had removed. */
	merged: number;
	removed: number;
	/** Of `merged`, those whose gate passed the first time. */
	firstTry: number;
	/** Of `removed`, those removed as `redo` or `superseded`. */
	redone: number;
	/** Of `merged`, those whose usage was kept, and their tokens in and out. */
	used: number;
	tokens: number;
	/** Skill checks over the arm's conversations, applied places passed and failed. */
	checksPassed: number;
	checksApplied: number;
}

/** How one note was pointed at, read and applied, over conversations with pointers. */
export interface NoteRow {
	/** The note, by its path from the project root. */
	path: string;
	/** Pointers to it, by tier. */
	now: number;
	optional: number;
	/** Of those pointers, the ones its conversation went on to read the note after. */
	nowRead: number;
	optionalRead: number;
	/** Reads of it with no pointer before them in the conversation. */
	unprompted: number;
	/** Reads the judge weighed, and those it counted applied. */
	judged: number;
	applied: number;
}

/** What the Stats page's Notes section shows. */
export interface NoteStats {
	/** Conversations with pointers, against those held out. */
	pointed: Arm;
	holdout: Arm;
	/** Messages the router judged in conversations with pointers, and those that got any pointer. */
	messages: number;
	attached: number;
	/** How long the judge took per message, in milliseconds; null before any. */
	p50: number | null;
	p95: number | null;
	/** Every note that was pointed at or read, the most pointed first. */
	notes: NoteRow[];
}

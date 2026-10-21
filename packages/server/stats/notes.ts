import type { Event } from "../records";
import type { Judged } from "./adherence";
import type { Outcome } from "./outcomes";

/**
 * Compares the conversations that got note pointers with the ones held out,
 * and reads how the routing did, from `events` of one project, its
 * `outcomes` and `judged` skill checks. `sources` are the journals of the
 * projects read, each by its main tree; outcomes of any other are left out. A conversation counts once the
 * router has judged a message in it: whatever its first judgment said of the
 * holdout holds for it.
 */
export function noteStats(
	sources: { project: string; events: Event[] }[],
	outcomes: Outcome[],
	judged: Judged[],
): NoteStats {
	const projects = new Set(sources.map((each) => each.project));
	const arms = new Map<string, "pointed" | "holdout">();
	const times: number[] = [];
	const rows = new Map<string, NoteRow>();
	const row = (project: string, path: string): NoteRow => {
		const key = `${project}\n${path}`;
		const found = rows.get(key) ?? {
			project,
			path,
			now: 0,
			optional: 0,
			nowRead: 0,
			optionalRead: 0,
			unprompted: 0,
			judged: 0,
			applied: 0,
		};
		rows.set(key, found);
		return found;
	};
	// What each conversation was pointed at, by note: the tiers not yet followed by a read.
	const waiting = new Map<string, Map<string, "now" | "optional">>();
	const pointedAt = new Set<string>();
	let messages = 0;
	let attached = 0;
	// Whether the person corrected the agent, by arm: messages judged and those judged corrections.
	const said = { pointed: 0, holdout: 0 };
	const corrected = { pointed: 0, holdout: 0 };
	const spend = { routing: 0, routed: 0, weighing: 0, weighed: 0 };
	// The note bytes each conversation's own agent read, and its context as it last read one.
	const reading = new Map<string, { bytes: number; context: number | null }>();
	for (const { project, events } of sources) {
		for (const event of events) {
			if (event.reason !== null || event.conversation === null) {
				continue;
			}
			const conversation = event.conversation;
			if (event.action === "notes attached") {
				if (!arms.has(conversation)) {
					arms.set(conversation, event.holdout ? "holdout" : "pointed");
				}
				const which = arms.get(conversation) ?? "pointed";
				if (event.corrects !== undefined) {
					said[which] += 1;
					if (event.corrects >= CORRECTS) {
						corrected[which] += 1;
					}
				}
				if (event.dollars !== undefined && event.dollars !== null) {
					spend.routing += event.dollars;
					spend.routed += 1;
				}
				if (which === "holdout") {
					continue;
				}
				messages += 1;
				times.push(event.ms);
				const tiers = event.notes.filter((note) => note.tier !== null);
				if (tiers.length > 0) {
					attached += 1;
				}
				for (const note of tiers) {
					const entry = row(project, note.path);
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
				if (
					!event.subagent &&
					event.bytes !== undefined &&
					event.bytes !== null
				) {
					const sum = reading.get(conversation) ?? { bytes: 0, context: null };
					sum.bytes += event.bytes;
					sum.context = event.context ?? null;
					reading.set(conversation, sum);
				}
				const entry = row(project, event.path);
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
			} else if (event.action === "note applied") {
				if (event.dollars !== undefined && event.dollars !== null) {
					spend.weighing += event.dollars;
					spend.weighed += 1;
				}
				if (arms.get(conversation) !== "pointed") {
					continue;
				}
				const entry = row(project, event.path);
				entry.judged += 1;
				if (event.probability >= APPLIED) {
					entry.applied += 1;
				}
			}
		}
	}
	const arm = (which: "pointed" | "holdout"): Arm => {
		const own = new Set(
			[...arms].filter(([, each]) => each === which).map(([id]) => id),
		);
		const ended = outcomes.filter(
			(each) =>
				projects.has(each.project) &&
				!each.base.startsWith("task/") &&
				each.conversation !== null &&
				own.has(each.conversation),
		);
		const merged = ended.filter((each) => each.ended === "merged");
		const removed = ended.filter((each) => each.ended === "removed");
		const used = merged.filter((each) => each.usage !== undefined);
		const turned = merged.filter((each) => each.turns !== undefined);
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
			turned: turned.length,
			turns: turned.reduce((sum, each) => sum + (each.turns ?? 0), 0),
			said: said[which],
			corrected: corrected[which],
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
		projects: [...projects],
		pointed: arm("pointed"),
		holdout: arm("holdout"),
		messages,
		attached,
		p50: at(0.5),
		p95: at(0.95),
		spend,
		context: contextShare(reading),
		notes: [...rows.values()].sort(
			(one, other) =>
				other.now + other.optional - (one.now + one.optional) ||
				one.project.localeCompare(other.project) ||
				one.path.localeCompare(other.path),
		),
	};
}

/** The probability at which a judged note counts as applied, the router's own bar for worth. */
export const APPLIED = 0.5;

/** The probability at which a judged message counts as correcting the agent. */
export const CORRECTS = 0.5;

/** The bytes of English text a token holds, about, to set note bodies against context tokens. */
const BYTES_PER_TOKEN = 4;

/**
 * What the notes read took of their conversations' context: the bytes each
 * conversation's own agent read, as tokens, against the context it held as
 * it read the last of them, pooled over the conversations whose agent said
 * its context.
 */
function contextShare(
	reading: Map<string, { bytes: number; context: number | null }>,
): NoteStats["context"] {
	let tokens = 0;
	let held = 0;
	let conversations = 0;
	for (const { bytes, context } of reading.values()) {
		if (context === null || context === 0) {
			continue;
		}
		tokens += bytes / BYTES_PER_TOKEN;
		held += context;
		conversations += 1;
	}
	return {
		conversations,
		tokens: Math.round(tokens),
		share: held === 0 ? null : Math.min(1, tokens / held),
	};
}

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
	/** Of `merged`, those whose turns were kept, and their agent turns. */
	turned: number;
	turns: number;
	/** Messages the judge weighed as a correction or not, and those it counted corrections. */
	said: number;
	corrected: number;
	/** Skill checks over the arm's conversations, applied places passed and failed. */
	checksPassed: number;
	checksApplied: number;
}

/** How one note was pointed at, read and applied, over conversations with pointers. */
export interface NoteRow {
	/** The main tree of the project it belongs to. */
	project: string;
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
	/** The main trees of the projects read. */
	projects: string[];
	/** Conversations with pointers, against those held out. */
	pointed: Arm;
	holdout: Arm;
	/** Messages the router judged in conversations with pointers, and those that got any pointer. */
	messages: number;
	attached: number;
	/** How long the judge took per message, in milliseconds; null before any. */
	p50: number | null;
	p95: number | null;
	/**
	 * What the judge cost in dollars, both arms', routing messages and
	 * weighing the notes read in turns, with the messages and notes whose
	 * judgment said a price.
	 */
	spend: { routing: number; routed: number; weighing: number; weighed: number };
	/**
	 * What the notes read took of context in conversations with pointers:
	 * their bodies' tokens, about, and their share of the context held as
	 * the last was read, over the conversations whose agent said its context;
	 * null share before any.
	 */
	context: { conversations: number; tokens: number; share: number | null };
	/** Every note that was pointed at or read, the most pointed first. */
	notes: NoteRow[];
}

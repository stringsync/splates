import { describe, expect, it } from "bun:test";
import type { Message, Part } from "@stringsync/splates-server/conversations";
import type { Event } from "@stringsync/splates-server/records";
import { tool } from "./fixtures";
import { like } from "./thread-messages";
import type { Work } from "./work";

// Working says the agent is at it now, so it only ever shows on a turn's
// last line: a line of any kind under it reads as the agent having moved
// on. These turns are made at random, every kind of line in every order,
// so a kind of line added later is held to it too.
describe("Working", () => {
	it("shows only on the last line of a turn still going", () => {
		const random = seeded(20261019);
		const turns = Array.from({ length: 3000 }, () => madeUp(random));

		expect(turns).toSayWorkingOnlyLast();
	});
});

declare module "bun:test" {
	interface Matchers<T> {
		/** Asserts each turn says Working on its last line while it goes, and nowhere else. */
		toSayWorkingOnlyLast(): void;
	}
}

expect.extend({
	toSayWorkingOnlyLast(received) {
		const wrong = (received as ReturnType<typeof madeUp>[])
			.map((turn) => ({ turn, lines: linesOf(turn) }))
			.find(({ turn, lines }) => {
				const working = lines.flatMap((line, index) =>
					line === "Working" ? [index] : [],
				);
				// Nor does a turn going end on a line of splates's, or a row that
				// has stopped, with nothing under it to say the agent is at it.
				return turn.going
					? working.some((index) => index !== lines.length - 1) ||
							lines.at(-1) === "event" ||
							lines.at(-1) === "worked"
					: working.length > 0;
			});
		return {
			pass: wrong === undefined,
			message: () =>
				`expected Working only on the last line of a turn going, got ${this.utils.printReceived(wrong?.lines)} for ${JSON.stringify(wrong?.turn)}`,
		};
	},
});

/** The lines the page shows for a turn, a work row as Working or worked. */
function linesOf({ message, events, going, now }: ReturnType<typeof madeUp>) {
	const content = like(
		message,
		1,
		"c1",
		!going,
		at(0),
		now,
		"alpha",
		events,
	).content;
	return (typeof content === "string" ? [] : content)
		.filter(
			(part) =>
				part.type !== "data-stopped" && part.type !== "data-interrupted",
		)
		.map((part) =>
			part.type === "data-work"
				? (part.data as { work: Work }).work.working
					? "Working"
					: "worked"
				: part.type === "data-event"
					? "event"
					: part.type,
		);
}

const at = (seconds: number) => new Date(seconds * 1000).toISOString();

/** A turn of up to ten parts and five events at random, in time order. */
function madeUp(random: () => number): {
	message: Message;
	events: Event[];
	going: boolean;
	now: number;
} {
	const pick = <T>(of: readonly T[]): T =>
		of[Math.floor(random() * of.length)] as T;
	const parts: Part[] = [];
	let second = 1;
	const count = Math.floor(random() * 11);
	for (let index = 0; index < count; index++) {
		second += 1 + Math.floor(random() * 3);
		const kind = pick(["tool", "tool", "thought", "text", "compaction"]);
		const ends = random() < 0.8 ? at(second + 1) : null;
		if (kind === "tool") {
			parts.push(
				tool({
					id: `t${index}`,
					at: at(second),
					until: ends,
					status: ends === null ? "in_progress" : "completed",
				}),
			);
		} else if (kind === "thought") {
			parts.push({ type: "thought", text: "Hm.", at: at(second) });
		} else if (kind === "text") {
			parts.push({ type: "text", text: `Said ${index}.`, at: at(second) });
		} else {
			parts.push({
				type: "compaction",
				id: `k${index}`,
				status: ends === null ? "in_progress" : "completed",
				trigger: "automatic",
				before: null,
				after: null,
				summary: null,
				at: at(second),
				until: ends,
			});
		}
	}
	const events = Array.from({ length: Math.floor(random() * 6) }, (_, index) =>
		event(pick(KINDS), `e${index}`, at(1 + random() * (second + 2))),
	).sort((one, other) => one.at.localeCompare(other.at));
	const message: Message = {
		role: "agent",
		at: at(1),
		until: at(second + 1),
		plan: random() < 0.2 ? [{ text: "Look.", status: "in_progress" }] : null,
		parts,
	};
	return {
		message,
		events,
		going: random() < 0.7,
		now: random() < 0.5 ? Number.POSITIVE_INFINITY : (second + 1) * 1000,
	};
}

const KINDS = [
	"add",
	"claim",
	"merge",
	"escalate",
	"remove",
	"attach",
	"task add",
	"task update",
] as const;

/** An event of each kind as splates logs one. */
function event(kind: (typeof KINDS)[number], id: string, when: string): Event {
	const common = {
		id,
		at: when,
		task: "alpha",
		reason: null,
		conversation: "c1",
	};
	switch (kind) {
		case "add":
			return {
				...common,
				action: "add",
				base: "main",
				tasks: [],
				goal: "Do it.",
				subjects: [],
				agent: null,
				model: null,
			} as Event;
		case "claim":
			return {
				...common,
				action: "claim",
				escalated: false,
				tookOver: false,
				goal: "Do it.",
			} as Event;
		case "merge":
			return {
				...common,
				action: "merge",
				base: "main",
				attemptsLeft: 3,
				failedTests: [],
				commit: "abc123",
				files: [],
			} as Event;
		case "escalate":
			return {
				...common,
				action: "escalate",
				about: "Needs a call.",
				review: false,
				base: "main",
				questions: [],
			} as Event;
		case "remove":
			return {
				...common,
				action: "remove",
				why: "nothing",
				released: [],
			} as Event;
		case "attach":
			return { ...common, action: "attach", stored: ["/tmp/a.png"] } as Event;
		case "task add":
			return {
				...common,
				action: "task add",
				number: 7,
				subject: "Later.",
				lane: null,
				position: 1,
			} as Event;
		case "task update":
			return {
				...common,
				action: "task update",
				number: 7,
				subject: "Later.",
				changed: { text: true },
			} as Event;
	}
}

/** A seeded mulberry32, so a failure comes back on every run. */
function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import { type Needing, need, needOfExternal } from "../needs";
import type { Details } from "../show";
import { Notifier } from "./notifier";
import { Settings } from "./settings";
import { conversation, details, message } from "./testing";

describe("Notifier", () => {
	let settings: Settings;
	let focused: boolean;
	let notifier: Notifier;
	const runs = conversation({ id: "c1", title: "Fix", status: "running" });
	const fails = conversation({ id: "c2", title: "Lint", status: "running" });
	const beta = details({ task: "beta" });

	beforeEach(() => {
		Object.assign(FakeNotification, {
			permission: "default",
			answer: "granted",
			shown: [],
		});
		Object.assign(globalThis, { Notification: FakeNotification });
		settings = new Settings(localStorage);
		focused = false;
		notifier = new Notifier(settings, () => focused);
	});

	afterEach(() => {
		localStorage.clear();
		Reflect.deleteProperty(globalThis, "Notification");
	});

	it("tells nothing on its first look, then of a row that comes to wait", () => {
		expect(notifier.look([row(runs)], name, NOW)).toEqual([]);
		const asks = {
			...runs,
			ask: {
				type: "permission" as const,
				id: "t1",
				at: "2026-10-11T10:59:00.000Z",
				title: "rm -rf build",
				options: [],
			},
		};
		expect(
			notifier
				.look([row(asks)], name, NOW)
				.map(({ title, body }) => [title, body]),
		).toEqual([["Fix", "Wants to run: rm -rf build"]]);
		// Still waiting is not news.
		expect(notifier.look([row(asks)], name, NOW)).toEqual([]);
	});

	it("tells of a conversation that finishes its turn, with its last words, or fails", () => {
		notifier.look([row(runs), row(fails)], name, NOW);

		expect(
			notifier
				.look(
					[
						row({
							...runs,
							status: "idle",
							messages: [
								message(
									"agent",
									"\n## ✅ Merged **fix** onto `main`\n\nThe fix is in.",
								),
							],
						}),
						row({ ...fails, status: "failed", error: "agent exited" }),
					],
					name,
					NOW,
				)
				.map(({ title, body }) => [title, body]),
		).toEqual([
			["Fix", "✅ Merged fix onto main"],
			["Lint", "Failed: agent exited"],
		]);
	});

	it("tells only of the kinds the settings ask for", async () => {
		notifier.look([row(runs), row(fails)], name, NOW);
		await settings.set("notifications.waiting", false);

		expect(
			notifier
				.look(
					[
						row({ ...runs, status: "idle" }),
						row({ ...fails, status: "failed" }),
					],
					name,
					NOW,
				)
				.map(({ title, body }) => [title, body]),
		).toEqual([["Fix", "Its turn is over"]]);
	});

	it("tells of an external agent's task that escalates, and of nothing for a new row", () => {
		notifier.look([row(null, beta)], name, NOW);

		expect(
			notifier
				.look(
					[
						row(null, { ...beta, status: "escalated", escalation: "a call" }),
						row(null, details({ task: "gamma", status: "escalated" })),
					],
					name,
					NOW,
				)
				.map(({ title, body }) => [title, body]),
		).toEqual([["beta", "Escalated: a call"]]);
	});

	it("tells nothing of a task left by archiving its conversation, the person's own doing", () => {
		const taken = { ...beta, takenBy: "c1" };
		notifier.look([row(null, taken)], name, NOW);

		expect(
			notifier.look(
				[
					{
						conversation: null,
						task: taken,
						need: needOfExternal(taken, [{ ...runs, archived: true }]),
					},
				],
				name,
				NOW,
			),
		).toEqual([]);
	});

	it("says in one plain line what a waiting row wants, under a short name", () => {
		const named = {
			...runs,
			title: "A conversation named by its whole first line",
		};
		notifier.look([row(named), row(null, beta)], name, NOW);

		expect(
			notifier
				.look(
					[
						row({
							...named,
							ask: {
								type: "question",
								id: "q1",
								at: "2026-10-11T10:59:00.000Z",
								message: `**Which** of these should land first? ${"x".repeat(80)}`,
								fields: [],
							},
						}),
						row(null, {
							...beta,
							status: "escalated",
							review: "the board at 390px",
						}),
					],
					name,
					NOW,
				)
				.map(({ title, body }) => [title, body]),
		).toEqual([
			[
				"A conversation named by its whole first…",
				`Asks: Which of these should land first? ${"x".repeat(39)}…`,
			],
			["beta", "Ready for review"],
		]);
	});

	it("tells once of a running conversation with no word for the quiet time", async () => {
		await settings.set("notifications.quietAfter", 5);
		const said = {
			...message("agent", "running the tests"),
			at: "2026-10-11T10:55:00.000Z",
			until: "2026-10-11T10:58:00.000Z",
		};
		const talked = { ...runs, messages: [said] };
		const later = Date.parse(said.until) + 5 * 60_000;
		notifier.look([row(talked)], name, later - 1);

		expect(
			notifier
				.look([row(talked)], name, later)
				.map(({ title, body }) => [title, body]),
		).toEqual([["Fix", "Quiet for 5 minutes"]]);
		expect(notifier.look([row(talked)], name, later + 60_000)).toEqual([]);
	});

	it("shows notices only while on and away from the page unless set to, opening the row on a click", async () => {
		const fix = row(conversation({ id: "c1", title: "Fix" }));
		const notice = { row: fix, title: "Fix finished", body: "Done" };
		const opened: Needing[] = [];

		notifier.show([notice], (each) => opened.push(each));
		expect(FakeNotification.shown).toEqual([]);

		await settings.set("notifications.on", true);
		focused = true;
		notifier.show([notice], (each) => opened.push(each));
		expect(FakeNotification.shown).toEqual([]);

		focused = false;
		notifier.show([notice], (each) => opened.push(each));
		const [shown] = FakeNotification.shown;
		expect([shown?.title, shown?.options]).toEqual([
			"Fix finished",
			{ body: "Done", tag: "conversation c1" },
		]);
		shown?.onclick?.();
		expect(opened).toEqual([fix]);
		expect(shown?.closed).toBe(true);

		// In front too, once the settings say so.
		await settings.set("notifications.inFront", true);
		focused = true;
		notifier.show([notice], (each) => opened.push(each));
		expect(FakeNotification.shown).toHaveLength(2);
	});
});

/** A browser that notifies, keeping what it was asked to show. */
class FakeNotification {
	static permission: NotificationPermission = "default";
	static answer: NotificationPermission = "granted";
	static shown: FakeNotification[] = [];
	static requestPermission = async () => {
		FakeNotification.permission = FakeNotification.answer;
		return FakeNotification.answer;
	};
	onclick: (() => void) | null = null;
	closed = false;
	constructor(
		readonly title: string,
		readonly options: NotificationOptions,
	) {
		FakeNotification.shown.push(this);
	}
	close(): void {
		this.closed = true;
	}
}

const row = (
	held: ConversationState | null,
	task: Details | null = null,
): Needing => ({ conversation: held, task, need: need(task, held) });

const name = (each: Needing) =>
	each.conversation?.title ?? each.task?.task ?? "";

const NOW = Date.parse("2026-10-11T11:00:00.000Z");

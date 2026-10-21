import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { listed } from "@stringsync/splates-server/conversations";
import { details } from "./fixtures";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	tool,
	waitFor,
	within,
} from "./testing";

describe("App's open conversation when the sidebar updates", () => {
	let testing: Testing;
	let view: ConversationsView;
	let card: HTMLElement;

	const report = [
		"## ⚠️ Escalated header: waiting on two calls",
		"",
		"1. Which pages need it?",
		"   - [a] Todos",
		"   - [b] Tasks",
		"2. How should a stale todo be shown?",
		"   - (a) A muted card",
		"   - (b) A badge",
	].join("\n");

	const second = () =>
		view.getAllByRole("listitem", { name: "question 2" }).at(-1) as HTMLElement;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [message("user", "fix the header"), message("agent", report)],
			}),
			conversation({ id: "c2", title: "Other", messages: [] }),
		]);
		await waitFor(second);
		await act(async () =>
			fireEvent.click(
				within(second()).getByRole("button", { name: /A badge/ }),
			),
		);
		card = second();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("keeps what was answered when another conversation changes", async () => {
		await act(async () =>
			testing.say(
				conversation({
					id: "c2",
					title: "Other",
					messages: [message("user", "hi")],
				}),
			),
		);
		expect(
			within(second())
				.getAllByRole("button", { pressed: true })
				.map((each) => each.textContent),
		).toEqual(["bA badge"]);
	});

	const kept = () => {
		expect(second()).toBe(card);
		return within(second())
			.getAllByRole("button", { pressed: true })
			.map((each) => each.textContent);
	};

	it("keeps what was answered when the conversation itself changes", async () => {
		await act(async () =>
			testing.say(
				conversation({
					title: "Header 2",
					messages: [
						message("user", "fix the header"),
						message("agent", report),
					],
				}),
			),
		);
		expect(kept()).toEqual(["bA badge"]);
	});

	it("keeps what was answered when the snapshot streams", async () => {
		await act(async () =>
			testing.stream?.onmessage?.({
				data: JSON.stringify({
					...testing.served,
					tasks: [
						details({ task: "beta", lease: "held" }),
						details({ task: "alpha", lease: "held" }),
					],
				}),
			}),
		);
		expect(kept()).toEqual(["bA badge"]);
	});

	it("keeps what was answered when the listing is read again", async () => {
		const whole = conversation({
			title: "Header",
			messages: [message("user", "fix the header"), message("agent", report)],
		});
		const summary = { ...whole, summary: true as const };
		testing.wholes[whole.id] = whole;
		testing.talk = { ...testing.talk, conversations: [summary] } as never;
		await act(async () =>
			testing.talkStream?.named?.get("settings")?.({ data: "{}" }),
		);
		expect(kept()).toEqual(["bA badge"]);
	});

	const own = (more: object) =>
		conversation({
			title: "Header",
			messages: [message("user", "fix the header"), message("agent", report)],
			...more,
		});

	for (const [name, more] of [
		["a read mark", { read: 1, unread: true }],
		["a task taken", { task: "alpha" }],
	] as const) {
		it(`keeps its place through ${name}`, async () => {
			await act(async () => testing.say(own(more) as never));
			expect(kept()).toEqual(["bA badge"]);
		});
	}

	it("keeps its place when a new conversation arrives", async () => {
		await act(async () =>
			testing.say(conversation({ id: "c9", title: "New", messages: [] })),
		);
		expect(kept()).toEqual(["bA badge"]);
	});

	it("keeps its place when its task's details change", async () => {
		await act(async () =>
			testing.stream?.onmessage?.({
				data: JSON.stringify({
					...testing.served,
					tasks: [details({ task: "alpha", lease: "stale" })],
				}),
			}),
		);
		expect(kept()).toEqual(["bA badge"]);
	});
});

describe("App's open conversation when a listing repeats it", () => {
	let testing: Testing;

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("keeps the question card and its answers", async () => {
		const whole = conversation({
			title: "Header",
			messages: [
				message("user", "fix the header"),
				message(
					"agent",
					tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
					"1. How should a stale todo be shown?\n   - (a) A muted card\n   - (b) A badge",
				),
			],
		});
		testing = new Testing();
		testing.wholes[whole.id] = whole;
		const view = await testing.openConversations([whole]);
		const question = () =>
			view
				.getAllByRole("listitem", { name: "question 1" })
				.at(-1) as HTMLElement;
		await waitFor(question);
		await act(async () =>
			fireEvent.click(
				within(question()).getByRole("button", { name: /A badge/ }),
			),
		);
		const card = question();
		expect(within(card).getAllByRole("button", { pressed: true })).toHaveLength(
			1,
		);

		await act(async () => testing.say(listed(whole)));

		expect(question()).toBe(card);
		expect(
			within(card)
				.getAllByRole("button", { pressed: true })
				.map((each) => each.textContent),
		).toEqual(["bA badge"]);
	});
});

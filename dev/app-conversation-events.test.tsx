import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import type { Event } from "../events";
import {
	cleanup,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's arbor events", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The thread of a turn, opened with `events`. */
	const opened = async (state: ConversationState, events: Event[]) => {
		const view = await testing.openConversations([{ ...state, events }]);
		return await waitFor(() => view.getByRole("region", { name: "Tests" }));
	};

	it("draws each event as a line between the work it came in, a refused one marked", async () => {
		const state = turn([
			tool({
				id: "x1",
				command: "arbor claim alpha",
				at: second(2),
				until: second(3),
			}),
			tool({
				id: "r1",
				kind: "read",
				paths: ["/repo/a.ts"],
				at: second(10),
				until: second(11),
			}),
			"It stops now.",
		]);
		const thread = await opened(state, [
			claim("alpha", 3.5),
			claim("beta", 10.5, { reason: "lease_held" }),
		]);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Claimedalpha",
			"Claim failedbeta",
		]);
		expect(
			within(thread).getAllByRole("list", { name: "timeline" }),
		).toHaveLength(2);
		expect(thread.textContent).toMatch(
			/arbor claim alpha.*Claimedalpha.*a\.ts.*Claim failedbeta.*It stops now\./,
		);
	});

	it("draws a handoff as a line, and the claim that takes it over as another", async () => {
		const thread = await opened(turn(["Over to you."]), [
			{
				id: "h",
				at: second(2),
				action: "handoff",
				task: "alpha",
				reason: null,
				conversation: "c1",
				agent: "codex",
				model: "gpt-5.5",
				relay: false,
			},
			claim("alpha", 3, { tookOver: true }),
		]);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Handed offalpha",
			"Took overalpha",
		]);
		expect(within(lines[0] as HTMLElement).getByTitle(/codex \(gpt-5\.5\)/));
	});

	it("draws a todo or todos taken, released or removed as one chip, and nothing when refused", async () => {
		const thread = await opened(turn(["Done."]), [
			todoEvent("todo take", 3, [{ id: 12, subject: "Fix the lease" }]),
			todoEvent("todo release", 4, [
				{ id: 1, subject: "One" },
				{ id: 2, subject: "Two" },
				{ id: 3, subject: "Three" },
			]),
			todoEvent("todo remove", 5, [{ id: 12, subject: "Fix the lease" }]),
			todoEvent("todo take", 6, undefined, "not_found"),
		]);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(3);
			return found;
		});
		const [took, released, removed] = lines.map((line) => line.textContent);
		expect(took).toContain("Took#12 Fix the lease");
		expect(released).toContain("Released3 todos");
		expect(released).toContain("Two");
		expect(removed).toContain("Removed#12 Fix the lease");
	});

	it("draws a cred request as a chip opening it on the Creds page, and none for a cred already kept", async () => {
		const thread = await opened(turn(["Waiting."]), [
			credRequest("a", "CF_TOKEN", true),
			credRequest("b", "KEPT_TOKEN", false),
		]);

		const line = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(1);
			return found[0] as HTMLElement;
		});
		expect(line.textContent).toBe("RequestedCF_TOKEN");
		expect(within(line).getByRole("link").getAttribute("href")).toBe(
			"#creds/CF_TOKEN",
		);
		expect(thread.textContent).not.toContain("## 🔑");
	});

	it("draws nothing for an action no line is drawn for yet", async () => {
		const thread = await opened(turn(["Done."]), [
			{
				id: "r",
				at: second(2),
				action: "retry",
				task: "alpha",
				reason: null,
				conversation: "c1",
			},
		]);

		await waitFor(() => expect(thread.textContent).toContain("Done."));
		expect(within(thread).queryAllByRole("note", { name: "arbor" })).toEqual(
			[],
		);
	});

	it("draws arbor dev stopping and starting as lines with no chip", async () => {
		const thread = await opened(turn(["Back."]), [
			{
				id: "s1",
				at: second(2),
				action: "dev stop",
				task: null,
				reason: null,
				conversation: null,
				conversations: ["c1"],
				why: "restart",
			},
			{
				id: "s2",
				at: second(3),
				action: "dev start",
				task: null,
				reason: null,
				conversation: null,
				conversations: ["c1"],
			},
		]);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"arbor dev stopped",
			"arbor dev started",
		]);
	});

	it("folds todo updates in a row into one line listing each", async () => {
		const thread = await opened(
			turn([
				tool({
					id: "x1",
					command: "arbor todo update 1",
					at: second(2),
					until: second(3),
				}),
				"Groomed.",
			]),
			[update(1, 3.1, "One"), update(2, 3.2, "Two"), update(3, 3.3, "Three")],
		);

		const line = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(1);
			return found[0] as HTMLElement;
		});
		expect(line.textContent).toContain("Updated3 todos");
		expect(line.textContent).toContain("#1 One");
		expect(line.textContent).toContain("#3 Three");
	});

	it("draws one todo update with what changed in its chip's title", async () => {
		const thread = await opened(turn(["Done."]), [update(7, 2, "Seven")]);

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "arbor" }),
		);
		expect(line.textContent).toBe("Updated#7 Seven");
		expect(line.querySelector("[title]")?.getAttribute("title")).toContain(
			"moved to position 2",
		);
	});

	it("draws a lane started, updated and removed as a line naming it", async () => {
		const thread = await opened(turn(["Done."]), [
			{ ...laneEvent("a", 2), action: "lane add", lane: 4, name: "Stats" },
			{
				...laneEvent("b", 3),
				action: "lane update",
				lane: 4,
				name: "Metrics",
				changed: { name: "Metrics" },
			},
			{
				...laneEvent("c", 4),
				action: "lane remove",
				lane: 4,
				name: "Metrics",
				todos: [7, 8],
			},
			{
				id: "d",
				at: second(5),
				action: "lane remove",
				task: null,
				reason: "usage",
				conversation: "c1",
			},
		]);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(3);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"StartedStats",
			"UpdatedMetrics",
			"RemovedMetrics",
		]);
	});

	it("draws a removed task as one line, its reason and the todos put back in its chip's title", async () => {
		const thread = await opened(turn(["Gone."]), [removed()]);

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "arbor" }),
		);
		expect(line.textContent).toBe("Removedalpha");
		expect(line.querySelector("[title]")?.getAttribute("title")).toBe(
			"Task alpha\nReason: redo\nTodo #7 open again: Seven",
		);
	});
});

/** What every lane event the agent ran at `secs` carries. */
function laneEvent(id: string, secs: number) {
	return {
		id,
		at: second(secs),
		task: null,
		reason: null,
		conversation: "c1",
	} as const;
}

/** The agent removing alpha for a redo, which put todo 7 back. */
function removed(): Event {
	return {
		id: "rm",
		at: second(2),
		action: "remove",
		task: "alpha",
		reason: null,
		conversation: "c1",
		why: "redo",
		released: [{ id: 7, subject: "Seven" }],
	};
}

/** A todo update the agent ran at `secs`, moving todo `id` to position 2. */
function update(id: number, secs: number, subject: string): Event {
	return {
		id: `u${id}`,
		at: second(secs),
		action: "todo update",
		task: null,
		reason: null,
		conversation: "c1",
		todo: id,
		subject,
		changed: { position: 2 },
	};
}

/** A claim of `task` the agent ran at `secs`, refused as `reason` when given. */
function claim(
	task: string,
	secs: number,
	opts: { reason?: string; tookOver?: boolean } = {},
): Event {
	const { reason, tookOver = false } = opts;
	return reason === undefined
		? {
				id: task,
				at: second(secs),
				action: "claim",
				task,
				reason: null,
				conversation: "c1",
				escalated: false,
				tookOver,
			}
		: {
				id: task,
				at: second(secs),
				action: "claim",
				task,
				reason,
				conversation: "c1",
			};
}

/** A todo command the agent ran at `secs`, refused as `reason` when given. */
function todoEvent(
	action: "todo take" | "todo release" | "todo remove",
	secs: number,
	todos?: { id: number; subject: string }[],
	reason?: string,
): Event {
	const common = {
		id: `${action}-${secs}`,
		at: second(secs),
		action,
		task: "alpha",
		conversation: "c1",
	};
	return reason === undefined
		? { ...common, reason: null, todos: todos ?? [] }
		: { ...common, reason };
}

/** A cred request the agent ran, which asked for the cred or found it kept. */
function credRequest(id: string, name: string, asked: boolean): Event {
	return {
		id,
		at: second(3),
		action: "creds request",
		task: null,
		reason: null,
		conversation: "c1",
		name,
		asked,
	};
}

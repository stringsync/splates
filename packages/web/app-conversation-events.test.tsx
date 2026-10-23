import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Event } from "@stringsync/splates-server/records";
import { workTimelines } from "./drivers";
import {
	cleanup,
	fireEvent,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's splates events", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The counts of the thread's quiet events, and the dialog they open to. */
	const counted = async (thread: HTMLElement) => {
		const counts = await waitFor(() =>
			within(thread).getByRole("button", { name: "quiet events" }),
		);
		const text = counts.textContent;
		fireEvent.click(counts);
		const dialog = await waitFor(() =>
			within(document.body).getByRole("dialog"),
		);
		return { text, dialog };
	};

	/** The thread of a turn, opened with `events`. */
	const opened = async (state: ConversationState, events: Event[]) => {
		const view = await testing.openConversations([{ ...state, events }]);
		return await waitFor(() => view.getByRole("region", { name: "Tests" }));
	};

	it("draws each event as a line between the work it came in, a refused one marked", async () => {
		const state = turn([
			tool({
				id: "x1",
				command: "splates claim alpha",
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
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Claimedalpha",
			"Claim failedbeta",
		]);
		expect(workTimelines(thread)).toHaveLength(2);
		expect(thread.textContent).toMatch(
			/splates claim alpha.*Claimedalpha.*a\.ts.*Claim failedbeta.*It stops now\./,
		);
	});

	it("draws an old handoff as a line, naming the agent it went to on hover", async () => {
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
			},
		]);

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "splates" }),
		);
		expect(line.textContent).toBe("Handed offalpha");
		expect(within(line).getByTitle(/codex \(gpt-5\.5\)/));
	});

	it("counts todos taken, released or removed, and lists them in the dialog, a refused one as refused", async () => {
		const thread = await opened(turn(["Done."]), [
			todoEvent("task take", 3, [{ id: 12, subject: "Fix the lease" }]),
			todoEvent("task release", 4, [
				{ id: 1, subject: "One" },
				{ id: 2, subject: "Two" },
				{ id: 3, subject: "Three" },
			]),
			todoEvent("task remove", 5, [{ id: 12, subject: "Fix the lease" }]),
			todoEvent("task take", 6, undefined, "not_found"),
		]);

		expect(
			within(thread).queryAllByRole("note", { name: "splates" }),
		).toHaveLength(0);
		const { text, dialog } = await counted(thread);
		expect(text).toBe("4 taken·1 removed·1 refused");
		expect(dialog.textContent).toContain("Took#12 Fix the lease");
		expect(dialog.textContent).toContain("Released3 tasks");
		expect(dialog.textContent).toContain("Removed#12 Fix the lease");
		expect(dialog.textContent).toContain("task take: not_found");
	});

	it("draws a cred request as a chip opening it on the Creds page, and none for a cred already kept", async () => {
		const thread = await opened(turn(["Waiting."]), [
			credRequest("a", "CF_TOKEN", true),
			credRequest("b", "KEPT_TOKEN", false),
		]);

		const line = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(1);
			return found[0] as HTMLElement;
		});
		expect(line.textContent).toBe("RequestedCF_TOKEN");
		expect(within(line).getByRole("link").getAttribute("href")).toBe(
			"#creds/CF_TOKEN",
		);
		expect(thread.textContent).not.toContain("## 🔑");
	});

	it("counts the files an attach stored or dropped, and draws each attach in the dialog, a bare one not at all", async () => {
		const thread = await opened(turn(["Done."]), [
			attached(1, ["/git/splates/a/shot.png"], []),
			attached(2, ["/git/splates/a/one.png", "/git/splates/a/two.png"], []),
			attached(3, [], ["old.png"]),
			attached(4, [], []),
			attached(5, ["/git/splates/a/new.png"], ["one.png", "two.png"]),
		]);

		const { text, dialog } = await counted(thread);
		expect(text).toBe("7 files");
		expect(
			within(dialog)
				.getAllByRole("note", { name: "splates" })
				.map((line) => line.textContent),
		).toEqual([
			"Attachedshot.pngtoalpha",
			"Attached 2 filestoalpha",
			"Removedold.pngfromalpha",
			"Attachednew.pngtoalphaand removed 2 files",
		]);
	});

	it("draws nothing for an action no line is drawn for yet", async () => {
		const thread = await opened(turn(["Done."]), [
			{
				id: "r",
				at: second(2),
				action: "tunnel remove",
				task: null,
				reason: null,
				conversation: "c1",
			},
		]);

		await waitFor(() => expect(thread.textContent).toContain("Done."));
		expect(within(thread).queryAllByRole("note", { name: "splates" })).toEqual(
			[],
		);
	});

	it("draws a retry as a line naming its task, a refused one marked", async () => {
		const thread = await opened(
			turn([
				tool({
					id: "x1",
					command: "splates retry alpha",
					at: second(2),
					until: second(3),
				}),
				"Retrying.",
			]),
			[
				{
					id: "r1",
					at: second(3.5),
					action: "retry",
					task: "alpha",
					reason: null,
					conversation: "c1",
					attempts: 3,
				},
				{
					id: "r2",
					at: second(4.5),
					action: "retry",
					task: "beta",
					reason: "usage",
					conversation: "c1",
				},
			],
		);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Retriedalpha",
			"Retry failedbeta",
		]);
		expect(lines[1]?.querySelector('[aria-label="Failed"]')).not.toBeNull();
	});

	it("counts todo updates, folding a run in the dialog into one line listing each", async () => {
		const thread = await opened(
			turn([
				tool({
					id: "x1",
					command: "splates todo update 1",
					at: second(2),
					until: second(3),
				}),
				"Groomed.",
			]),
			[update(1, 3.1, "One"), update(2, 3.2, "Two"), update(3, 3.3, "Three")],
		);

		const { text, dialog } = await counted(thread);
		expect(text).toBe("3 moved");
		const line = within(dialog).getByRole("note", { name: "splates" });
		expect(line.textContent).toContain("Updated3 tasks");
		expect(line.textContent).toContain("#1 One");
		expect(line.textContent).toContain("#3 Three");
	});

	it("draws one todo update in the dialog with what changed in its chip's title", async () => {
		const thread = await opened(turn(["Done."]), [update(7, 2, "Seven")]);

		const { dialog } = await counted(thread);
		const line = within(dialog).getByRole("note", { name: "splates" });
		expect(line.textContent).toBe("Updated#7 Seven");
		expect(line.querySelector("[title]")?.getAttribute("title")).toContain(
			"moved to position 2",
		);
	});

	it("counts a lane started, updated and removed, and draws each in the dialog", async () => {
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
				tasks: [7, 8],
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

		const { text, dialog } = await counted(thread);
		expect(text).toBe("3 lanes·1 refused");
		expect(
			within(dialog)
				.getAllByRole("note", { name: "splates" })
				.map((line) => line.textContent),
		).toEqual(["StartedStats", "UpdatedMetrics", "RemovedMetrics"]);
	});

	it("draws a removed task as one line, its reason and the todos put back in its chip's title", async () => {
		const thread = await opened(turn(["Gone."]), [removed()]);

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "splates" }),
		);
		expect(line.textContent).toBe("Removedalpha");
		expect(line.querySelector("[title]")?.getAttribute("title")).toBe(
			"Task alpha\nReason: redo\nTask #7 open again: Seven",
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
		action: "task update",
		task: null,
		reason: null,
		conversation: "c1",
		number: id,
		subject,
		changed: { position: 2 },
	};
}

/** A claim of `task` the agent ran at `secs`, refused as `reason` when given. */
function claim(
	task: string,
	secs: number,
	opts: { reason?: string } = {},
): Event {
	const { reason } = opts;
	return reason === undefined
		? {
				id: task,
				at: second(secs),
				action: "claim",
				task,
				reason: null,
				conversation: "c1",
				goal: "",
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
	action: "task take" | "task release" | "task remove",
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
		? { ...common, reason: null, tasks: todos ?? [] }
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

/** An attach at `secs` that stored `stored` and dropped `removed`. */
function attached(secs: number, stored: string[], removed: string[]): Event {
	return {
		id: `attach${secs}`,
		at: second(secs),
		action: "attach",
		task: "alpha",
		reason: null,
		conversation: "c1",
		stored,
		removed,
	};
}

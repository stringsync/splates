import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
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

describe("App's merge events", () => {
	let testing: Testing;
	let events: Event[];

	beforeEach(() => {
		testing = new Testing();
		events = [
			{
				id: "m1",
				at: second(3.5),
				action: "merge",
				task: "alpha",
				reason: "conflict",
				conversation: "c1",
				base: "main",
				files: ["a.ts"],
				attemptsLeft: 2,
				failedTests: [],
			},
			{
				id: "m2",
				at: second(4),
				action: "merge",
				task: "alpha",
				reason: null,
				conversation: "c1",
				base: "main",
				commit: "abc1234",
				files: ["a.ts"],
				attemptsLeft: 2,
				failedTests: [],
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens a conversation drawing `refused`, and its line's Why. */
	async function why(refused: Event): Promise<HTMLElement> {
		const view = await testing.openConversations([
			{ ...turn(["Merging."]), events: [refused] },
		]);
		fireEvent.click(
			await waitFor(() => view.getByRole("button", { name: "Why" })),
		);
		return waitFor(() => view.getByRole("dialog"));
	}

	it("draws a merge as landed and a refused one as failed", async () => {
		const view = await testing.openConversations([
			{
				...turn([
					tool({
						id: "x1",
						command: "splates merge",
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
					"Merging.",
				]),
				events,
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Merge failedalphaWhy",
			"Mergedalpha",
		]);
	});

	it("opens why a refused merge failed from its line, and none for a landed one", async () => {
		const view = await testing.openConversations([
			{ ...turn(["Merging."]), events },
		]);
		const lines = await waitFor(() => {
			const found = view.getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(
			within(lines[1] as HTMLElement).queryByRole("button", { name: "Why" }),
		).toBeNull();

		fireEvent.click(
			within(lines[0] as HTMLElement).getByRole("button", { name: "Why" }),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("Rebasing onto main conflicted.");
		expect(
			within(dialog).getByRole("region", { name: "Conflicted files" })
				.textContent,
		).toContain("a.ts");
		expect(dialog.textContent).toContain("2 merge attempts left.");
	});

	it("shows each failed test, whom the gate blamed and what it printed", async () => {
		const failed: Event = {
			id: "m3",
			at: second(3.5),
			action: "merge",
			task: "alpha",
			reason: "tests_failed",
			conversation: "c1",
			base: "main",
			files: [],
			attemptsLeft: 1,
			failedTests: [{ name: "a > b", message: "Expected: 1\nReceived: 2" }],
			failureAttribution: "task",
			output: "1 fail",
		};

		const dialog = await why(failed);

		expect(
			within(dialog).getByRole("region", { name: "Failed tests (1)" })
				.textContent,
		).toBe("Failed tests (1)a > bExpected: 1\nReceived: 2");
		expect(
			within(dialog).getByRole("region", { name: "Blamed on" }).textContent,
		).toContain("The task: the failing tests pass on main");
		expect(
			within(dialog).getByRole("region", { name: "Output" }).textContent,
		).toBe("Output1 fail");
		expect(dialog.textContent).toContain("1 merge attempt left.");
	});

	it("opens an older refusal with only what it kept", async () => {
		const older: Event = {
			id: "m4",
			at: second(3.5),
			action: "merge",
			task: "alpha",
			reason: "merge_failed",
			conversation: "c1",
		};

		const dialog = await why(older);

		expect(dialog.textContent).toContain(
			"Git could not rebase the task onto the base or land it there.",
		);
		expect(within(dialog).queryByRole("region")).toBeNull();
	});
});

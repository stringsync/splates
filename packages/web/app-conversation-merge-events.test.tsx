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
			await waitFor(() => view.getByRole("button", { name: "alpha" })),
		);
		return waitFor(() => view.getByRole("dialog"));
	}

	it("keeps batch companions out of merge summaries", async () => {
		const batched = events.map((event) => ({
			...event,
			batch: ["alpha", "beta", "gamma"],
		}));
		const view = await testing.openConversations([
			{ ...turn(["Merged."]), events: batched },
		]);
		await waitFor(() =>
			expect(view.queryByText("· gated with beta, gamma")).toBeNull(),
		);
	});

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
			"Merge failedalpha",
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
			(lines[1] as HTMLElement).querySelector('button[title="alpha"]'),
		).toBeNull();

		fireEvent.click(
			within(lines[0] as HTMLElement).getByRole("button", { name: "alpha" }),
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

	it.each([true, false])(
		"shows landed commit identities below failed tests (filtered: %s)",
		async (filtered) => {
			const dialog = await why({
				id: "landed",
				action: "merge",
				at: second(3.5),
				task: "alpha",
				conversation: "c1",
				base: "main",
				reason: "tests_failed",
				failedTests: [{ name: "a > b", message: "Expected: 1" }],
				landed: {
					from: "11111111",
					to: "22222222",
					total: 3,
					filtered,
					commits: [
						{ commit: "abc1234", task: "fix-header", subject: "Fix header" },
						{ commit: "def5678", task: null, subject: "Update docs" },
					],
				},
			});
			const landed = within(dialog).getByRole("region", {
				name: "Landed since your last base",
			});
			expect(landed.textContent).toContain("3 commits landed on main");
			expect(
				within(landed)
					.getAllByRole("listitem")
					.map((li) => li.textContent),
			).toEqual(["abc1234 fix-header Fix header", "def5678 - Update docs"]);
			expect(landed.textContent).toContain(
				filtered
					? "Commits touching the failing test files"
					: "None touched the failing test files",
			);
			const sections = within(dialog).getAllByRole("region");
			expect(sections.indexOf(landed)).toBe(
				sections.findIndex(
					(section) =>
						section.getAttribute("aria-label") === "Failed tests (1)",
				) + 1,
			);
		},
	);

	it("shows only the count when the unfiltered landed range has no commit list", async () => {
		const dialog = await why({
			id: "landed",
			action: "merge",
			at: second(3.5),
			task: "alpha",
			conversation: "c1",
			base: "main",
			reason: "tests_failed",
			landed: {
				from: "11111111",
				to: "22222222",
				total: 42,
				filtered: false,
				commits: [],
			},
		});
		const landed = within(dialog).getByRole("region", {
			name: "Landed since your last base",
		});
		expect(landed.textContent).toBe(
			"Landed since your last base42 commits landed on main since your last base.",
		);
		expect(within(landed).queryByRole("list")).toBeNull();
	});
});

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Event } from "@stringsync/splates-server/records";
import { unfoldCards, workTimeline, workTimelines } from "./drivers";
import {
	act,
	cleanup,
	fireEvent,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's work row", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const opened = async (state: ConversationState) => {
		const view = await testing.openConversations([state]);
		return await waitFor(() =>
			view.getByRole("region", { name: state.title ?? "" }),
		);
	};
	/** Each row's line, as it reads folded. */
	const lines = (list: Element) =>
		[...list.children].map(
			(row) => (row.querySelector("summary") ?? row).textContent,
		);

	it("folds intermediate words and calls into one closed row, leaving the final reply in the thread", async () => {
		const thread = await opened(
			turn([
				{ type: "thought", text: "Which tests?", at: second(1) },
				"Let me run them.",
				tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
				tool({
					id: "x1",
					command: "bun test",
					status: "failed",
					at: second(2),
					until: second(30),
				}),
				{ type: "thought", text: "The parser.", at: second(30) },
				"One fails: fixing it.",
				tool({
					id: "e1",
					kind: "edit",
					paths: ["/repo/src/a.ts"],
					edits: [{ path: "/repo/src/a.ts", old: "one", new: "two" }],
				}),
				tool({
					id: "x2",
					command: "bun test",
					at: second(31),
					until: second(60),
				}),
				"All tests pass.",
			]),
		);

		await waitFor(() =>
			expect(within(thread).queryAllByText(/^Worked/)).toHaveLength(1),
		);
		expect(thread.textContent).not.toContain("Let me run them.");
		expect(thread.textContent).not.toContain("One fails: fixing it.");
		const timeline = workTimeline(thread);
		expect(lines(timeline)).toEqual([
			"Let me run them.",
			"Reada.ts",
			"Failed to runbun test28s",
			"One fails: fixing it.",
			"Editeda.ts",
			"Ranbun test29s",
		]);
		expect(thread.textContent?.match(/All tests pass\./g)).toHaveLength(1);
		expect(thread.textContent).toContain("All tests pass.");
		expect(thread.textContent).not.toContain("Which tests?");
		expect(thread.textContent).not.toContain("The parser.");
	});

	it("shows the task the agent added along the way as splates's line between its work, its Goal on the task", async () => {
		const thread = await opened({
			...turn([
				tool({
					id: "x1",
					command: "splates add upload-limit",
					at: second(2),
					until: second(3),
				}),
				tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"], at: second(5) }),
				"It stops now.",
			]),
			events: [added(3)],
		});

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "splates" }),
		);
		expect(line.textContent).toBe("Addedupload-limit");
		expect(
			within(line).getByTitle(
				"Task upload-limit: Stop retrying an upload refused as too big.",
			),
		).toBeTruthy();
		const works = workTimelines(thread);
		expect(works.map(lines)).toEqual([
			["Ransplates add upload-limit1s"],
			["Reada.ts"],
		]);
		expect(thread.textContent).toMatch(
			/splates add upload-limit.*Addedupload-limit.*Reada\.ts.*It stops now\./,
		);
	});

	// scry-ignore simple-test-setup: its layout spy is its own, which no other test shares
	it("shows the task added along the way beside the thread while its line is scrolled up out of sight, until a report that it merged comes up", async () => {
		const thread = await opened({
			...turn([
				tool({
					id: "x1",
					command: "splates add upload-limit",
					at: second(2),
					until: second(3),
				}),
				tool({ id: "x2", command: "splates merge", at: second(5) }),
				"## ✅ Merged upload-limit onto main\n\nUploads stop retrying.",
			]),
			events: [added(3)],
		});
		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "splates" }),
		);
		const merged = within(thread).getByRole("region", {
			name: "merged upload-limit",
		});
		const viewport = thread.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;
		// Laid out, as happy-dom never does: the thread 800px tall, the
		// Added line in view or above it, the report below or in view.
		const card = line.parentElement as HTMLElement;
		const report = merged.parentElement as HTMLElement;
		Object.defineProperty(card, "offsetHeight", { value: 120 });
		let cardTop = 200;
		let reportTop = 2000;
		const rect = HTMLElement.prototype.getBoundingClientRect;
		// scry-ignore fakes-over-mocks: happy-dom lays nothing out, so where each card sits has to be spied
		const placed = spyOn(
			HTMLElement.prototype,
			"getBoundingClientRect",
		).mockImplementation(function (this: HTMLElement) {
			return this === viewport
				? new DOMRect(0, 0, 600, 800)
				: this === card
					? new DOMRect(0, cardTop, 600, 120)
					: this === report
						? new DOMRect(0, reportTop, 600, 120)
						: rect.call(this);
		});
		const current = () =>
			view().queryByRole("region", {
				name: "current upload-limit",
				hidden: true,
			});
		const view = () => within(document.body);
		const shown = () => current()?.parentElement?.getAttribute("aria-hidden");
		const scroll = () => act(async () => fireEvent.scroll(viewport));
		try {
			await scroll();
			expect(current()).toBeNull();

			cardTop = -500;
			await scroll();
			await waitFor(() => expect(shown()).toBe("false"));
			expect(current()?.textContent).toContain(
				"Stop retrying an upload refused as too big.",
			);

			// Over once its merge comes into view.
			reportTop = 400;
			await scroll();
			await waitFor(() => expect(shown()).toBe("true"));

			// And back when scrolled up above the merge again.
			reportTop = 2000;
			await scroll();
			await waitFor(() => expect(shown()).toBe("false"));

			// Fading out, the line saying it in the thread again.
			cardTop = 200;
			await scroll();
			await waitFor(() => expect(shown()).toBe("true"));
		} finally {
			placed.mockRestore();
		}
	});

	// scry-ignore simple-test-setup: its layout spy is its own, which no other test shares
	it("shows the task the agent claimed beside the thread, not one it added for another agent after", async () => {
		const thread = await opened({
			...turn([
				tool({
					id: "x1",
					command: "splates claim upload-limit",
					at: second(2),
				}),
				tool({
					id: "x2",
					command: "splates add sibling --agent claude",
					at: second(4),
				}),
				"Handed sibling out.",
			]),
			events: [
				{
					id: "claim",
					at: second(3),
					action: "claim",
					task: "upload-limit",
					reason: null,
					conversation: "c1",
					goal: "Stop retrying an upload refused as too big.",
				},
				{
					id: "add",
					at: second(5),
					action: "add",
					task: "sibling",
					reason: null,
					conversation: "c1",
					base: "main",
					tasks: [],
					goal: "Size the upload limit.",
					subjects: [],
					agent: "claude",
					model: null,
				},
			],
		});
		const notes = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(1);
			return found;
		});
		expect(notes.map((note) => note.textContent)).toEqual([
			"Claimedupload-limit",
		]);
		expect(
			within(thread).getByRole("button", { name: "quiet events" }).textContent,
		).toBe("Details");
		const viewport = thread.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;
		// happy-dom lays nothing out, so the height stands in for the claimed task scrolled out of sight.
		const lines = notes.map((note) =>
			Object.defineProperty(note.parentElement as HTMLElement, "offsetHeight", {
				value: 40,
			}),
		);
		const rect = HTMLElement.prototype.getBoundingClientRect;
		// scry-ignore fakes-over-mocks: happy-dom lays nothing out, so where each card sits has to be spied
		const placed = spyOn(
			HTMLElement.prototype,
			"getBoundingClientRect",
		).mockImplementation(function (this: HTMLElement) {
			return this === viewport
				? new DOMRect(0, 0, 600, 800)
				: lines.includes(this)
					? new DOMRect(0, -500 + 100 * lines.indexOf(this), 600, 40)
					: rect.call(this);
		});
		const view = within(document.body);
		try {
			await act(async () => fireEvent.scroll(viewport));
			const current = await waitFor(() =>
				view.getByRole("region", { name: "current upload-limit" }),
			);
			expect(current.textContent).toContain(
				"Stop retrying an upload refused as too big.",
			);
			expect(
				view.queryByRole("region", { name: "current sibling", hidden: true }),
			).toBeNull();
		} finally {
			placed.mockRestore();
		}
	});

	it("shows the last thing the agent said in the thread, even with tool calls after it", async () => {
		const thread = await opened(
			turn([
				"Let me look.",
				tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
				"No, I'm not waiting on you.",
				tool({ id: "x1", command: "bun test" }),
			]),
		);

		await waitFor(() =>
			expect(thread.textContent).toContain("No, I'm not waiting on you."),
		);
		const all = workTimelines(thread);
		expect(all.map((each) => each.textContent)).toEqual([
			expect.stringContaining("Let me look."),
			expect.stringContaining("bun test"),
		]);
		expect(thread.textContent).toMatch(
			/Worked.*Let me look\..*No, I'm not waiting on you\..*Worked/,
		);
	});

	it("stops saying it is thinking once it replies", async () => {
		const thread = await opened(
			turn(
				[
					{ type: "thought", text: "Which tests?", at: second(1) },
					"Tests pass.",
				],
				{ status: "running" },
			),
		);

		await waitFor(() => expect(thread.textContent).toContain("Tests pass."));
		expect(thread.textContent).not.toContain("Thinking");
	});

	it("folds a subagent's calls into its row", async () => {
		const thread = await opened(
			turn([
				tool({ id: "a1", kind: "think", title: "Find the callers" }),
				tool({ id: "g1", kind: "search", title: "grep fold", parent: "a1" }),
				tool({ id: "g2", kind: "read", title: "Read a.ts", parent: "a1" }),
				"Two callers.",
			]),
		);

		const timeline = await waitFor(() => workTimeline(thread));
		expect(lines(timeline)).toEqual([
			"Ran subagentFind the callers· 2 tool calls",
		]);
		unfoldCards(timeline);
		expect(lines(timeline.querySelector("details ul") as Element)).toEqual([
			"Searchedgrep fold",
			"Read",
		]);
	});
});

/** The event of the agent adding upload-limit, `secs` into its turn. */
function added(secs: number): Event {
	return {
		id: "add",
		at: second(secs),
		action: "add",
		task: "upload-limit",
		reason: null,
		conversation: "c1",
		base: "main",
		tasks: [],
		goal: "Stop retrying an upload refused as too big.",
		subjects: [],
		agent: null,
		model: null,
	};
}

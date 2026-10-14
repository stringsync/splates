import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "../conversations";
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

	it("folds everything before the agent's reply, its words along the way included, into one line", async () => {
		const thread = await opened(
			turn([
				{ type: "thought", text: "Which tests?", at: second(1) },
				"Let me run them.",
				tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
				tool({ id: "r2", kind: "read", paths: ["/repo/b.ts"] }),
				tool({
					id: "x1",
					command: "bun test",
					status: "failed",
					at: second(2),
					until: second(30),
				}),
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
			expect(within(thread).getByText("Worked 1m 0s").tagName).toBe("SPAN"),
		);
		expect(within(thread).queryAllByText(/^Worked/)).toHaveLength(1);
		const work = within(thread).getByRole("list", { name: "timeline" });
		expect((work.closest("details") as HTMLDetailsElement).open).toBe(false);
		expect(lines(work)).toEqual([
			"Thought for 1s",
			"Let me run them.",
			"Reada.ts",
			"Readb.ts",
			"Failed to runbun test28s",
			"Editeda.ts",
			"Ranbun test29s",
		]);
		// Its reply, under the line.
		expect(thread.textContent).toMatch(
			/Worked 1m 0s.*Ranbun test29s.*All tests pass\./,
		);
		expect(work.textContent).not.toContain("All tests pass.");
	});

	it("shows the task the agent added along the way as a card between its work", async () => {
		const thread = await opened(
			turn([
				tool({ id: "x1", command: "arbor add upload-limit" }),
				"## 🌱 Added upload-limit\n\nStop retrying an upload refused as too big.",
				tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
				"It stops now.",
			]),
		);

		const added = await waitFor(() =>
			within(thread).getByRole("region", { name: "added upload-limit" }),
		);
		expect(added.textContent).toContain("Added");
		expect(added.textContent).toContain(
			"Stop retrying an upload refused as too big.",
		);
		const works = within(thread).getAllByRole("list", { name: "timeline" });
		expect(works.map(lines)).toEqual([
			["Ranarbor add upload-limit"],
			["Reada.ts"],
		]);
		expect(thread.textContent).toMatch(
			/arbor add upload-limit.*Added.*Reada\.ts.*It stops now\./,
		);
		expect(thread.textContent).not.toContain("## 🌱");
	});

	it("shows the task added along the way beside the thread while its card is scrolled up out of sight, until a report that it merged comes up", async () => {
		const thread = await opened(
			turn([
				tool({ id: "x1", command: "arbor add upload-limit" }),
				"## 🌱 Added upload-limit\n\nStop retrying an upload refused as too big.",
				tool({ id: "x2", command: "arbor merge" }),
				"## ✅ Merged upload-limit onto main\n\nUploads stop retrying.",
			]),
		);
		const added = await waitFor(() =>
			within(thread).getByRole("region", { name: "added upload-limit" }),
		);
		const merged = within(thread).getByRole("region", {
			name: "merged upload-limit",
		});
		const viewport = thread.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;
		// Laid out, as happy-dom never does: the thread 800px tall, the
		// Added card in view or above it, the report below or in view.
		const card = added.parentElement as HTMLElement;
		const report = merged.parentElement as HTMLElement;
		Object.defineProperty(card, "offsetHeight", { value: 120 });
		let cardTop = 200;
		let reportTop = 2000;
		const rect = HTMLElement.prototype.getBoundingClientRect;
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

			// Fading out, the card saying it in the thread again.
			cardTop = 200;
			await scroll();
			await waitFor(() => expect(shown()).toBe("true"));
		} finally {
			placed.mockRestore();
		}
	});

	it("shows the lanes an orchestrator started beside the thread while its card is scrolled up out of sight, until its finished report comes up", async () => {
		const thread = await opened(
			turn([
				tool({ id: "x1", command: "arbor lane show 20" }),
				"## 🌱 Started lanes Stats, Licensing\n\nMake the Stats page say what to act on.",
				tool({ id: "x2", command: "arbor wait stats-action-oriented" }),
				"## 🏁 Finished lanes Stats, Licensing\n\nBoth landed.",
			]),
		);
		const started = await waitFor(() =>
			within(thread).getByRole("region", {
				name: "started Stats, Licensing",
			}),
		);
		expect(within(started).getByTitle("Stats").textContent).toContain("Lane");
		const finished = within(thread).getByRole("region", {
			name: "finished Stats, Licensing",
		});
		const viewport = thread.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;
		const card = started.parentElement as HTMLElement;
		const report = finished.parentElement as HTMLElement;
		Object.defineProperty(card, "offsetHeight", { value: 120 });
		let cardTop = -500;
		let reportTop = 2000;
		const rect = HTMLElement.prototype.getBoundingClientRect;
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
			within(document.body).queryByRole("region", {
				name: "current Stats, Licensing",
				hidden: true,
			});
		const shown = () => current()?.parentElement?.getAttribute("aria-hidden");
		const scroll = () => act(async () => fireEvent.scroll(viewport));
		try {
			await scroll();
			await waitFor(() => expect(shown()).toBe("false"));
			expect(current()?.textContent).toContain(
				"Make the Stats page say what to act on.",
			);

			// Over once the finished report comes into view.
			reportTop = 400;
			await scroll();
			await waitFor(() => expect(shown()).toBe("true"));

			// Back in sight, the card says it in the thread again.
			reportTop = 2000;
			cardTop = 200;
			await scroll();
			await waitFor(() => expect(shown()).toBe("true"));
		} finally {
			placed.mockRestore();
		}
	});

	it("keeps words along the way that say a task was added folded in while they are still being written", async () => {
		const thread = await opened(
			turn(
				[
					tool({ id: "x1", command: "arbor add upload-limit" }),
					"## 🌱 Added upload-limit\n\nStop retrying",
				],
				{ status: "running" },
			),
		);

		await waitFor(() =>
			expect(
				within(thread).getAllByRole("list", { name: "timeline" }),
			).toHaveLength(1),
		);
		expect(
			within(thread).queryByRole("region", { name: "added upload-limit" }),
		).toBeNull();
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
		const timelines = within(thread).getAllByRole("list", {
			name: "timeline",
		});
		expect(timelines.map((each) => each.textContent)).toEqual([
			"Let me look.Reada.ts",
			expect.stringContaining("bun test"),
		]);
		expect(thread.textContent).toMatch(
			/Worked.*No, I'm not waiting on you\..*Worked/,
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

		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		expect(lines(timeline)).toEqual([
			"Ran subagentFind the callers· 2 tool calls",
		]);
		expect(lines(timeline.querySelector("details ul") as Element)).toEqual([
			"Searchedgrep fold",
			"Read",
		]);
	});
});

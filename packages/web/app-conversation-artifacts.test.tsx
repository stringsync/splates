import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Artifact, ArtifactVersion } from "@splates/server/artifacts";
import type { Event } from "@splates/server/records";
import { workTimeline } from "./drivers";
import {
	act,
	cleanup,
	details,
	fireEvent,
	resize,
	second,
	Testing,
	turn,
	typeIn,
	waitFor,
	within,
} from "./testing";

/** The lines of the quiet events in the thread's opened work timeline. */
function quietLines(thread: HTMLElement): HTMLElement[] {
	return [
		...workTimeline(thread).querySelectorAll<HTMLElement>(
			'[data-slot="quiet-event"]',
		),
	];
}

describe("App's artifacts", () => {
	let testing: Testing;
	/** Each link the page followed, as its address and the name it downloads under. */
	let followed: { href: string; download: string }[];
	let click: { mockRestore(): void };

	beforeEach(() => {
		testing = new Testing();
		followed = [];
		// A download leaves the page.
		// vet-ignore fakes-over-mocks
		click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			function (this: HTMLAnchorElement) {
				followed.push({ href: this.href, download: this.download });
			},
		);
	});

	afterEach(() => {
		click.mockRestore();
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	/** The page open on conversation c1 keeping `artifacts`, after `events`. */
	const opened = async (artifacts: Artifact[], events: Event[] = []) => {
		const view = await testing.openConversations([
			{ ...turn(["Done."]), artifacts, events },
		]);
		return {
			view,
			thread: await waitFor(() => view.getByRole("region", { name: "Tests" })),
		};
	};

	it("draws an add and a remove as the artifact, opening the version it names", async () => {
		const { thread } = await opened(
			[artifact("report.html", [version(1), version(2)])],
			[
				added(1, "report.html", 1),
				added(2, "report.html", 2),
				removed(3, "report.html", 2),
				{ ...added(4, "big.png", 1), reason: "too_large" },
			],
		);

		const lines = await waitFor(() => {
			const found = quietLines(thread);
			expect(found).toHaveLength(4);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Addedreport.html",
			"Addedreport.html(v2)",
			"Removedreport.html",
			"artifact add: too_large",
		]);
		await act(async () =>
			fireEvent.click(
				within(lines[1] as HTMLElement).getByRole("button", {
					name: "report.html",
				}),
			),
		);
		expect(followed).toEqual([
			{
				href: expect.stringContaining(
					"/api/conversations/c1/artifacts/report.html/2",
				),
				download: "report.html",
			},
		]);
	});

	it("lists the artifacts it keeps beside the thread, each opening its current version", async () => {
		const { view } = await opened([
			artifact("report.html", [version(1, 300), version(2, 4096)]),
			artifact("shot.png", [version(1, 3 * 1024 * 1024)]),
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		const listed = within(card).getByRole("list", { name: "listed artifacts" });
		expect(
			within(listed)
				.getAllByRole("listitem")
				.map((row) => row.textContent),
		).toEqual(["report.htmlv2 · 4 KBDelete", "shot.png3.0 MBDelete"]);
		await act(async () =>
			fireEvent.click(
				within(listed).getByRole("button", { name: "report.html v2" }),
			),
		);
		expect(followed.map((each) => each.href)).toEqual([
			expect.stringContaining("/artifacts/report.html/2"),
		]);
	});

	it("keeps removed artifacts and replaced versions behind a Removed row, a gone one a placeholder", async () => {
		const { view } = await opened([
			artifact("report.html", [
				{ ...version(1, 300), gone: { at: second(5), why: "evicted" } },
				version(2, 500),
			]),
			{ ...artifact("old.png", [version(1, 2048)]), removedAt: second(6) },
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		expect(
			within(card).queryByRole("list", { name: "removed artifacts" }),
		).toBe(null);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Removed 2" })),
		);
		const hidden = within(card).getByRole("list", {
			name: "removed artifacts",
		});
		expect(
			within(hidden)
				.getAllByRole("listitem")
				.map((row) => row.textContent?.replace(/\d+\w ago/, "ago")),
		).toEqual([
			"report.htmlevicted for space agov1 · 300 B",
			"old.pngv1 · 2 KBDelete",
		]);
		// The gone one has nothing to open; the removed one still opens.
		const [gone] = within(hidden).getAllByRole("listitem");
		expect(within(gone as HTMLElement).queryByRole("button")).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(hidden).getByRole("button", { name: "old.png v1" }),
			),
		);
		expect(followed.map((each) => each.href)).toEqual([
			expect.stringContaining("/artifacts/old.png/1"),
		]);
		// Toggling, so one row serves to open and close the shelf.
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Removed 2" })),
		);
		expect(
			within(card).queryByRole("list", { name: "removed artifacts" }),
		).toBeNull();
	});

	it("deletes a version's bytes after a confirm on its row, and not a gone one", async () => {
		const { view } = await opened([
			artifact("report.html", [
				{ ...version(1, 300), gone: { at: second(5), why: "evicted" } },
				version(2, 500),
			]),
		]);
		const card = view.getByRole("region", { name: "artifacts" });
		expect(
			within(card).queryByRole("button", { name: /Delete .*v1/ }),
		).toBeNull();

		const button = within(card).getByRole("button", {
			name: "Delete report.html v2",
		});
		await act(async () => fireEvent.click(button));
		expect(
			testing.posted("/api/conversations/c1/artifacts/report.html/2"),
		).toEqual([]);
		expect(button.textContent).toBe("Delete?");
		testing.holdWrites();
		await act(async () => fireEvent.click(button));
		// Pending, not deleted, while the server has yet to say.
		expect(button.textContent).toBe("Deleting");
		expect(
			testing.posted("/api/conversations/c1/artifacts/report.html/2"),
		).toEqual([{ method: "DELETE", body: {} }]);
	});

	it("says a version was not deleted when the server refuses, why on hover", async () => {
		const { view } = await opened([
			artifact("report.html", [version(1, 300), version(2, 500)]),
		]);
		testing.refuseWrites = { reason: "not_found", message: "no version 2" };
		const card = view.getByRole("region", { name: "artifacts" });
		const button = within(card).getByRole("button", {
			name: "Delete report.html v2",
		});

		await act(async () => fireEvent.click(button));
		await act(async () => fireEvent.click(button));

		await waitFor(() => expect(button.textContent).toBe("Not deleted"));
		expect(button.getAttribute("title")).toBe("no version 2");
	});

	it("opens a page in a sandboxed frame that may run scripts and nothing more", async () => {
		const { view } = await opened([
			artifact("report.html", [
				version(1, 10, "text/html"),
				version(2, 10, "text/html"),
			]),
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: "report.html v2" }),
			),
		);
		const viewer = await waitFor(() =>
			view.getByRole("dialog", { name: "report.html v2" }),
		);
		const frame = within(viewer).getByTitle("report.html v2");
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
		expect(frame.getAttribute("src")).toContain(
			"/api/conversations/c1/artifacts/report.html/2",
		);
		expect(followed).toEqual([]);
		await act(async () =>
			fireEvent.click(within(viewer).getByRole("button", { name: "close" })),
		);
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "report.html v2" })).toBeNull(),
		);
	});

	it("opens an approval question's plan page in the lightbox, only its own question under it, outside the page's frame", async () => {
		const view = await testing.openConversations([
			{
				...turn([
					[
						"1. Which backfill?",
						"   - (a) Batch",
						"   - (b) Job",
						"2. Do you approve a users.last_seen column?",
						"   Plan: plan.html",
						"   - (a) Yes, approve it (chosen)",
						"   - (b) No",
					].join("\n"),
				]),
				artifacts: [artifact("plan.html", [version(1, 10, "text/html")])],
			},
		]);

		const tile = await waitFor(() =>
			view.getByRole("button", { name: "open plan" }),
		);
		expect(tile.querySelector("iframe")?.getAttribute("sandbox")).toBe(
			"allow-scripts",
		);
		await act(async () => fireEvent.click(tile));
		let lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "plan.html" }),
		);
		expect(within(lightbox).queryByRole("button", { name: "Send" })).toBeNull();
		// Only the approval question shows, folded until opened.
		expect(within(lightbox).queryByLabelText("Anything else")).toBeNull();
		const expand = within(lightbox).getByRole("button", {
			name: "Do you approve a users.last_seen column?",
		});
		expect(expand.getAttribute("aria-expanded")).toBe("false");
		await act(async () => fireEvent.click(expand));
		expect(expand.getAttribute("aria-expanded")).toBe("true");
		const frame = within(lightbox).getByTitle("plan.html");
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("src")).toContain(
			"/api/conversations/c1/artifacts/plan.html/1",
		);
		expect(within(lightbox).queryByText("Which backfill?")).toBeNull();
		expect(within(lightbox).getAllByRole("listitem")).toHaveLength(1);
		// Decided from the card's footer: the question takes words, not choices.
		expect(within(lightbox).queryByText("No")).toBeNull();
		await typeIn(
			within(lightbox).getByRole("textbox", { name: "Answer to 2" }),
			"Approve, with an index.",
		);
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "close" })),
		);
		// What was written there is the card's: Reject stays visible and Approve switches to Send.
		expect(view.getByRole("button", { name: "Reject" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Send" })).toBeTruthy();
		expect(view.queryByRole("button", { name: "Approve" })).toBeNull();
		await act(async () => fireEvent.click(tile));
		lightbox = view.getByRole("dialog", { name: "plan.html" });
		await act(async () =>
			fireEvent.click(
				within(lightbox).getByRole("button", {
					name: "Do you approve a users.last_seen column?",
				}),
			),
		);
		const words = within(lightbox).getByRole("textbox", {
			name: "Answer to 2",
		});
		expect(words.textContent).toBe("Approve, with an index.");
		// The question is the page's own, not the frame's.
		expect(frame.contains(words)).toBe(false);
		// Its footer goes back to the card's questions rather than sending.
		expect(within(lightbox).queryByRole("button", { name: "Send" })).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(lightbox).getByRole("button", { name: "Back to questions" }),
			),
		);
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "plan.html" })).toBeNull(),
		);
		expect(view.getByRole("listitem", { name: "question 2" })).toBeTruthy();
	});

	it("offers Comment on a selection the plan's frame reports, keeping the comment in the sheet", async () => {
		const view = await testing.openConversations([
			{
				...turn([
					[
						"1. Do you approve a users.last_seen column?",
						"   Plan: plan.html",
						"   - (a) Yes, approve it",
						"   - (b) No",
					].join("\n"),
				]),
				artifacts: [artifact("plan.html", [version(1, 10, "text/html")])],
			},
		]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "open plan" })),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "plan.html" }),
		);
		const frame = within(lightbox).getByTitle("plan.html") as HTMLIFrameElement;
		// A page asks for the report, and only its own frame is heard.
		expect(frame.getAttribute("src")).toContain("?select");
		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						splates: "selection",
						text: "backfill it",
						rect: { x: 10, y: 50, w: 40, h: 10 },
					},
					source: window,
				}),
			);
		});
		expect(
			within(lightbox).queryByRole("button", { name: "comment on selection" }),
		).toBeNull();
		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						splates: "selection",
						text: "backfill it",
						rect: { x: 10, y: 50, w: 40, h: 10 },
					},
					source: frame.contentWindow,
				}),
			);
		});
		await act(async () =>
			fireEvent.click(
				within(lightbox).getByRole("button", { name: "comment on selection" }),
			),
		);
		const note = within(lightbox).getByLabelText("comment 1");
		await act(async () =>
			fireEvent.change(note, { target: { value: "In a job?" } }),
		);
		expect(within(lightbox).getByText("“backfill it”")).toBeTruthy();
		expect((note as HTMLTextAreaElement).value).toBe("In a job?");
	});

	it("opens an approval question with no plan page as text in the lightbox, its questions under it", async () => {
		const view = await testing.openConversations(
			[
				{
					...turn([
						[
							"1. Do you approve retrying failed scans?",
							"   - (a) Yes, approve it (chosen)",
							"   - (b) No",
						].join("\n"),
					]),
					task: "alpha",
					name: "Fix scans",
				},
			],
			undefined,
			{
				tasks: [
					details({
						task: "alpha",
						lease: "held",
						plan: "## Before\n\nA failed scan is lost.\n\n## After\n\nFailed scans **retry** three times.\n\n![the retry run](/tmp/run.webm)",
					}),
				],
			},
		);

		await waitFor(() => view.getByText("Request full plan"));
		const tile = await waitFor(() =>
			view.getByRole("button", { name: "open plan" }),
		);
		expect(tile.querySelector("iframe")).toBeNull();
		await act(async () => fireEvent.click(tile));
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "alpha" }),
		);
		// Markdown: bold is a strong element, not asterisks.
		expect(lightbox.querySelector("strong")?.textContent).toBe("retry");
		expect(lightbox.querySelector("strong")?.parentElement?.textContent).toBe(
			"Failed scans retry three times.",
		);
		const words = lightbox.querySelector("strong")
			?.parentElement as HTMLElement;
		await act(async () => {
			window.getSelection()?.selectAllChildren(words);
			document.dispatchEvent(new Event("selectionchange"));
		});
		await act(async () =>
			fireEvent.click(
				within(lightbox).getByRole("button", { name: "comment on selection" }),
			),
		);
		expect(
			within(lightbox).getByText("“Failed scans retry three times.”"),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				within(lightbox).getByRole("button", {
					name: "Do you approve retrying failed scans?",
				}),
			),
		);
		expect(
			within(lightbox).getByRole("button", { name: "Back to questions" }),
		).toBeTruthy();
		// Media in the plan opens in a lightbox of its own, above the plan's.
		await act(async () =>
			fireEvent.click(
				within(lightbox).getByRole("button", {
					name: "expand the retry run",
				}),
			),
		);
		await waitFor(() =>
			expect(
				view
					.getAllByRole("dialog")
					.some((each) => each.textContent?.includes("the retry run")),
			).toBe(true),
		);
	});

	it("offers to request a full plan on an approval question with no plan page", async () => {
		const view = await testing.openConversations([
			turn([
				[
					"1. Do you approve renaming the Stop button?",
					"   - (a) Yes, approve it (chosen)",
					"   - (b) No",
				].join("\n"),
			]),
		]);

		await waitFor(() => view.getByText("Request full plan"));
		expect(view.getByText("No full plan")).toBeTruthy();
		expect(view.queryByRole("button", { name: "open plan" })).toBeNull();
	});

	const planned = turn([
		[
			"## 📝 Plan: rename the Stop button",
			"",
			"### Approach",
			"",
			"Rename it Pause.",
			"",
			"1. Do you approve renaming the Stop button?",
			"   - (a) Yes, approve it",
			"   - (b) No",
		].join("\n"),
	]);
	it("renders consecutive plan fields as separate paragraphs", async () => {
		const view = await testing.openConversations([
			turn([
				[
					"## 📝 Plan: try a cheaper lineup",
					"",
					"**Goal:** Find cells that can use a cheaper lineup.",
					"**After:** Some tasks start one lineup down.",
					"**Approach:** Record `holdout: true` on the outcome.",
					"**Hard to undo:** A migration records the outcome.",
					"",
					"1. Do you approve trying a cheaper lineup?",
					"   - (a) Yes, approve it",
					"   - (b) No",
				].join("\n"),
			]),
		]);

		await waitFor(() => view.getByText("Awaiting approval"));
		const paragraphs = ["Goal:", "After:", "Approach:", "Hard to undo:"].map(
			(label) => view.getByText(label).closest("p"),
		);
		expect(paragraphs.every((paragraph) => paragraph !== null)).toBe(true);
		expect(new Set(paragraphs).size).toBe(paragraphs.length);
		expect(view.getByText("holdout: true").tagName).toBe("CODE");
	});

	const prompts = () =>
		testing
			.posted("/api/conversations/c1/prompt")
			.map((post) => (post.body as { text: string }).text);

	it("heads a plan's questions with the plan and approves it from the footer", async () => {
		const view = await testing.openConversations([planned]);

		await waitFor(() => view.getByText("Plan: rename the Stop button"));
		expect(view.getByText("Awaiting approval")).toBeTruthy();
		expect(view.getByText("Rename it Pause.")).toBeTruthy();
		expect(view.getByText("Anything else?")).toBeTruthy();
		expect(
			view.queryByText("Do you approve renaming the Stop button?"),
		).toBeNull();
		// The plan is in the card: no tile for the task's record, and Reject + Request full plan sit in the footer.
		expect(view.queryByText("No full plan")).toBeNull();
		expect(
			view.getByRole("button", { name: "Request full plan" }),
		).toBeTruthy();
		expect(view.getByRole("button", { name: "Reject" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve" })),
		);

		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("Yes, approve it");
	});

	it("switches Approve to Send without implicit approval when Anything else has text", async () => {
		const view = await testing.openConversations([planned]);

		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "Anything else" }),
		);
		expect(view.getByRole("button", { name: "Approve" })).toBeTruthy();
		await typeIn(box, "Approve, but call it Hold.");
		expect(view.getByRole("button", { name: "Reject" })).toBeTruthy();
		expect(view.queryByRole("button", { name: "Approve" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);

		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("Approve, but call it Hold.");
		expect(prompts()[0]).not.toContain("Yes, approve it");
	});

	it("switches back to Approve when Anything else is cleared", async () => {
		const view = await testing.openConversations([planned]);

		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "Anything else" }),
		);
		await typeIn(box, "Call it Hold.");
		expect(view.getByRole("button", { name: "Send" })).toBeTruthy();
		await typeIn(box, "");
		expect(view.getByRole("button", { name: "Approve" })).toBeTruthy();
		expect(view.queryByRole("button", { name: "Send" })).toBeNull();
	});

	it("rejects a plan card even when a question was only typed in a preceding question", async () => {
		const view = await testing.openConversations([
			turn([
				[
					"## 📝 Plan: rename the Stop button",
					"",
					"### Approach",
					"",
					"Rename it Pause.",
					"",
					"1. Should the shortcut change too?",
					"   - (a) Keep Esc (chosen)",
					"   - (b) Use Space",
					"2. Do you approve renaming the Stop button?",
					"   - (a) Yes, approve it",
					"   - (b) No",
				].join("\n"),
			]),
		]);

		const q1Box = await waitFor(() =>
			view.getByRole("textbox", { name: "Answer to 1" }),
		);
		await typeIn(q1Box, "Why not keep Esc only while running?");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Reject" })),
		);

		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("Why not keep Esc only while running?");
		expect(prompts()[0]).toContain("No");
		expect(prompts()[0]).not.toContain("Yes, approve it");
	});

	it("approves on Enter in a plan card's Anything else box when empty, and sends feedback when text is present", async () => {
		const view = await testing.openConversations([planned]);

		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "Anything else" }),
		);
		await act(async () =>
			fireEvent.keyDown(box, { key: "Enter", shiftKey: true }),
		);
		expect(prompts()).toEqual([]);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("Yes, approve it");
	});

	it("sends feedback on Enter in a plan card's Anything else box when text is present", async () => {
		const view = await testing.openConversations([planned]);

		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "Anything else" }),
		);
		await typeIn(box, "Call it Hold instead.");
		await act(async () =>
			fireEvent.keyDown(box, { key: "Enter", shiftKey: true }),
		);
		expect(prompts()).toEqual([]);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("Call it Hold instead.");
		expect(prompts()[0]).not.toContain("Yes, approve it");
	});

	// vet-ignore simple-test-setup: one artifact of each kind is what this test alone opens
	it("keeps Reject and Request full plan in the ellipsis menu beside Approve on a phone", async () => {
		resize(390, 844);
		const view = await testing.openConversations([planned]);

		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: /plan for you/ }),
		);
		expect(
			within(sheet).queryByRole("button", { name: "Request full plan" }),
		).toBeNull();
		expect(within(sheet).queryByRole("button", { name: "Reject" })).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "More actions" }),
			),
		);
		expect(view.getByRole("menuitem", { name: "Reject" })).toBeTruthy();
		const item = await waitFor(() =>
			view.getByRole("menuitem", { name: "Request full plan" }),
		);
		await act(async () => fireEvent.click(item));

		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("Request a full plan");
	});

	it("rejects from the ellipsis menu beside Approve on a phone", async () => {
		resize(390, 844);
		const view = await testing.openConversations([planned]);

		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: /plan for you/ }),
		);
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "More actions" }),
			),
		);
		const reject = await waitFor(() =>
			view.getByRole("menuitem", { name: "Reject" }),
		);
		await act(async () => fireEvent.click(reject));

		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("No");
		expect(prompts()[0]).not.toContain("Yes, approve it");
	});

	it("switches Approve to Send without implicit approval on a phone when Anything else has text", async () => {
		resize(390, 844);
		const view = await testing.openConversations([planned]);

		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: /plan for you/ }),
		);
		const box = within(sheet).getByRole("textbox", { name: "Anything else" });
		await typeIn(box, "Looks good, ship it.");
		expect(within(sheet).queryByRole("button", { name: "Approve" })).toBeNull();
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: "Send" })),
		);

		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(prompts()[0]).toContain("Looks good, ship it.");
		expect(prompts()[0]).not.toContain("Yes, approve it");
	});

	it("opens an image or a recording in the lightbox among the others beside it, and downloads anything else", async () => {
		const { view } = await opened([
			artifact("a.png", [version(1, 10, "image/png")]),
			artifact("notes.pdf", [version(1, 10, "application/pdf")]),
			artifact("run.mp4", [version(1, 10, "video/mp4")]),
			artifact("page.html", [version(1, 10, "text/html")]),
			{
				...artifact("old.png", [version(1, 10, "image/png")]),
				removedAt: second(9),
			},
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "run.mp4" })),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "run.mp4" }),
		);
		expect(lightbox.querySelector("video")?.getAttribute("src")).toContain(
			"/artifacts/run.mp4/1",
		);
		// The listed images and recordings, the removed one apart.
		expect(within(lightbox).getByText("2 of 2")).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "next" })),
		);
		await waitFor(() => view.getByRole("dialog", { name: "a.png" }));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "close" })),
		);

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "notes.pdf" })),
		);
		expect(followed).toEqual([
			{
				href: expect.stringContaining("/artifacts/notes.pdf/1"),
				download: "notes.pdf",
			},
		]);

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Removed 1" })),
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "old.png v1" })),
		);
		const removed = await waitFor(() =>
			view.getByRole("dialog", { name: "old.png v1" }),
		);
		expect(within(removed).queryByText(/of \d/)).toBeNull();
	});

	it("opens an artifact's chip in a line in its viewer", async () => {
		const { thread } = await opened(
			[artifact("shot.png", [version(1, 10, "image/png")])],
			[added(1, "shot.png", 1)],
		);
		const line = await waitFor(() => {
			const [found] = quietLines(thread);
			expect(found).toBeDefined();
			return found as HTMLElement;
		});
		await act(async () =>
			fireEvent.click(within(line).getByRole("button", { name: "shot.png" })),
		);
		await waitFor(() =>
			within(document.body).getByRole("dialog", { name: "shot.png" }),
		);
		expect(followed).toEqual([]);
	});

	it("shows no card while it keeps no artifacts", async () => {
		const { view } = await opened([]);
		expect(view.queryByRole("region", { name: "artifacts" })).toBeNull();
	});

	it("opens the artifacts on a phone from the widgets in its header", async () => {
		resize(390, 844);
		const { view } = await opened([artifact("shot.png", [version(1, 10)])]);
		const widgets = view.getByRole("region", { name: "widgets" });
		expect(widgets.inert).toBe(true);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Widgets" })),
		);
		expect(widgets.inert).toBe(false);
		await act(async () =>
			fireEvent.click(
				within(widgets).getByRole("button", { name: "shot.png" }),
			),
		);
		expect(followed.map((each) => each.download)).toEqual(["shot.png"]);
	});
});

/** An artifact listed at the last of `versions`. */
function artifact(name: string, versions: ArtifactVersion[]): Artifact {
	return {
		name,
		current: versions.length,
		versions,
		removedAt: null,
	};
}

/** Version `number` of an artifact, `bytes` long of `mimeType`, its bytes kept. */
function version(
	number: number,
	bytes = 100,
	mimeType = "application/octet-stream",
): ArtifactVersion {
	return {
		version: number,
		file: `id${number}`,
		mimeType,
		bytes,
		addedAt: second(number),
		gone: null,
	};
}

/** A `splates artifact add` at `secs` that made `version` of `name`. */
function added(secs: number, name: string, version: number): Event {
	return {
		id: `add${secs}`,
		at: second(secs),
		action: "artifact add",
		task: "alpha",
		reason: null,
		conversation: "c1",
		name,
		version,
		bytes: 100,
	};
}

/** A `splates artifact remove` at `secs` of `name`, current at `version`. */
function removed(secs: number, name: string, version: number): Event {
	return {
		id: `remove${secs}`,
		at: second(secs),
		action: "artifact remove",
		task: "alpha",
		reason: null,
		conversation: "c1",
		name,
		version,
	};
}

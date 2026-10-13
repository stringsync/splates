import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "../conversations";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	todo,
	tool,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's conversations", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});
	describe("question cards", () => {
		const report = [
			"## ⚠️ Escalated header: waiting on two calls",
			"",
			"The header wraps now.",
			"",
			"1. Which pages need it?",
			"   - [a] Todos",
			"   - [b] Tasks",
			"2. How should a stale todo be shown?",
			"   - (a) A muted card",
			"   - (b) A badge",
			"3. Ready to merge?",
		].join("\n");
		const asking = (status: ConversationState["status"] = "idle") =>
			conversation({
				title: "Header",
				status,
				messages: [message("user", "fix the header"), message("agent", report)],
			});
		const box = (view: ConversationsView) =>
			view.getByRole("textbox", {
				name: "Message input",
			});

		it("shows each question as a card, the text around them as written", async () => {
			const view = await testing.openConversations([asking()]);

			const cards = await waitFor(() =>
				view.getByRole("list", { name: "questions" }),
			);
			expect(
				within(cards)
					.getAllByRole("listitem")
					.map((card) => card.getAttribute("aria-label")),
			).toEqual(["question 1", "question 2", "question 3"]);
			expect(view.getByText("The header wraps now.")).toBeTruthy();
			expect(view.queryByText("- (a) A muted card")).toBeNull();
		});

		it("asks an escalation's questions in its card, headed as the escalation", async () => {
			const view = await testing.openConversations([asking()]);

			const escalated = await waitFor(() =>
				view.getByRole("region", { name: "escalated header" }),
			);
			expect(escalated.textContent).toContain("Escalated");
			expect(escalated.textContent).toContain("waiting on two calls");
			expect(escalated.textContent).toContain("The header wraps now.");
			expect(
				within(escalated).getByRole("list", { name: "questions" }),
			).toBeTruthy();
			expect(view.getAllByRole("region", { name: /escalated/ })).toHaveLength(
				1,
			);
			expect(
				view.queryByRole("region", { name: "questions for you" }),
			).toBeNull();
		});

		it("asks questions outside an escalation in a card of their own", async () => {
			const view = await testing.openConversations([
				conversation({
					messages: [
						message("user", "fix the header"),
						message(
							"agent",
							"Working on it.\n\n1. Which pages need it?\n2. Should it wrap?",
						),
					],
				}),
			]);

			const asked = await waitFor(() =>
				view.getByRole("region", { name: "questions for you" }),
			);
			expect(
				within(asked).getByRole("list", { name: "questions" }),
			).toBeTruthy();
			expect(view.queryByRole("region", { name: /escalated/ })).toBeNull();
		});

		const card = (view: ConversationsView, question: string) =>
			view.getByRole("listitem", { name: `question ${question}` });

		it("renders markdown in a question's subject and choices", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message(
							"agent",
							[
								"1. Should `Header` wrap?",
								"   - (a) **Always**",
								"   - (b) Only below `md`",
							].join("\n"),
						),
					],
				}),
			]);

			const asked = await waitFor(() => card(view, "1"));
			expect(
				[...asked.querySelectorAll("code")].map((code) => code.textContent),
			).toEqual(["Header", "md"]);
			expect(asked.querySelector("strong")?.textContent).toBe("Always");
			expect(asked.textContent).not.toContain("`");
		});

		it("shows a screenshot indented under a choice with that choice", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Actions",
					messages: [
						message("user", "restyle the actions"),
						message(
							"agent",
							[
								"1. Which style should the actions take?",
								"   - (a) A rail",
								"     ![rail](/abs/rail.png)",
								"   - (b) A panel",
								"     ![panel](/abs/panel.png)",
							].join("\n"),
						),
					],
				}),
			]);

			const asked = await waitFor(() => card(view, "1"));
			const frame = (name: string) =>
				within(asked).getByRole("button", { name: new RegExp(name) })
					.parentElement as HTMLElement;
			// Under the choice, as its alt text where the file will not load.
			expect(frame("A rail").lastElementChild?.textContent).toContain("rail");
			expect(frame("A panel").lastElementChild?.textContent).toContain("panel");
			// The screenshots are no choices of their own.
			expect(
				within(asked)
					.getAllByRole("button", { pressed: false })
					.map((each) => each.textContent),
			).toEqual(["aA rail", "bA panel"]);
		});

		it("keeps the answers in the card, never the composer, and sends them from it with anything else", async () => {
			const QUOTED = [
				"Also the footer.",
				"",
				"> **Which pages need it?**",
				"",
				"- (a) Todos",
				"- (b) Tasks",
				"",
				"> **How should a stale todo be shown?**",
				"",
				"- (a) A muted card",
				"",
				"only on phones",
			].join("\n");
			const view = await testing.openConversations([asking()]);
			await waitFor(() => card(view, "2"));
			const choice = async (question: string, name: string) =>
				act(async () =>
					fireEvent.click(
						within(card(view, question)).getByRole("button", {
							name: new RegExp(name),
						}),
					),
				);
			const send = view.getByRole("button", {
				name: "Send",
			}) as HTMLButtonElement;
			expect(send.disabled).toBe(true);

			await choice("2", "A badge");
			await choice("1", "Tasks");
			await choice("1", "Todos");
			await choice("2", "A muted card");
			expect(
				within(card(view, "2"))
					.getByRole("button", { name: /A muted card/ })
					.getAttribute("aria-pressed"),
			).toBe("true");
			// Answered, it keeps its number.
			expect(card(view, "2").textContent).toStartWith("2 answered");
			const note = (question: string) =>
				within(card(view, question)).getByRole(
					"textbox",
				) as HTMLTextAreaElement;
			await act(async () =>
				fireEvent.change(note("2"), { target: { value: "only on phones" } }),
			);
			await act(async () =>
				fireEvent.change(note("3"), {
					target: { value: "after a\nphone check" },
				}),
			);
			expect(note("2").value).toBe("only on phones");
			expect(view.getByText("3 of 3 answered")).toBeTruthy();
			await act(async () =>
				fireEvent.change(note("3"), { target: { value: "" } }),
			);
			expect(view.getByText("2 of 3 answered")).toBeTruthy();
			await act(async () =>
				fireEvent.change(view.getByRole("textbox", { name: "Anything else" }), {
					target: { value: "Also the footer." },
				}),
			);
			expect(textIn(box(view))).toBe("");
			expect(
				localStorage.getItem("arbor.draft.c1:questions:1:Which pages need it?"),
			).toBe(QUOTED);
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);

			await act(async () => fireEvent.click(send));

			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: { text: QUOTED },
				},
			]);
		});

		it("answers by keyboard alone: letters pick, Enter goes on, and sends from anything else", async () => {
			const view = await testing.openConversations([asking()]);
			const first = await waitFor(() =>
				within(card(view, "1")).getByRole("button", { name: /Todos/ }),
			);
			// Ready to answer as soon as it shows.
			await waitFor(() => expect(document.activeElement === first).toBe(true));
			const key = async (key: string, options = {}) =>
				act(async () =>
					fireEvent.keyDown(document.activeElement as Element, {
						key,
						...options,
					}),
				);

			await key("b");
			await key("a");
			expect(
				within(card(view, "1"))
					.getAllByRole("button")
					.map((each) => each.getAttribute("aria-pressed")),
			).toEqual(["true", "true"]);
			expect(document.activeElement === first).toBe(true);
			await key("Enter");
			expect(document.activeElement?.textContent).toContain("A muted card");
			await key("ArrowDown");
			expect(document.activeElement?.textContent).toContain("A badge");
			await key("b");
			await key("Enter");
			expect(
				document.activeElement === within(card(view, "3")).getByRole("textbox"),
			).toBe(true);
			await act(async () =>
				fireEvent.change(document.activeElement as Element, {
					target: { value: "soon" },
				}),
			);
			await key("Enter");
			const more = view.getByRole("textbox", { name: "Anything else" });
			expect(document.activeElement === more).toBe(true);
			await act(async () =>
				fireEvent.change(more, { target: { value: "Thanks" } }),
			);
			await key("Enter", { shiftKey: true });
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
			await key("Enter");

			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: [
							"Thanks",
							"",
							"> **Which pages need it?**",
							"",
							"- (a) Todos",
							"- (b) Tasks",
							"",
							"> **How should a stale todo be shown?**",
							"",
							"- (b) A badge",
							"",
							"> **Ready to merge?**",
							"",
							"soon",
						].join("\n"),
					},
				},
			]);
		});

		it("scrolls the card to its top as it arrives, clear of the person's message", async () => {
			const scrolled: Element[] = [];
			const scroll = spyOn(
				HTMLElement.prototype,
				"scrollIntoView",
			).mockImplementation(function (this: HTMLElement) {
				scrolled.push(this);
			});
			try {
				const view = await testing.openConversations([asking()]);
				const first = await waitFor(() =>
					within(card(view, "1")).getByRole("button", { name: /Todos/ }),
				);
				await waitFor(() =>
					expect(document.activeElement === first).toBe(true),
				);
				const asked = view.getByRole("region", { name: "escalated header" });
				expect(scrolled).toEqual([asked]);
				expect(asked.style.scrollMarginTop).toMatch(/^\d+(\.\d+)?px$/);
			} finally {
				scroll.mockRestore();
			}
		});

		it("scrolls the whole next question into view on Enter, clear of the composer", async () => {
			const view = await testing.openConversations([asking()]);
			const first = await waitFor(() =>
				within(card(view, "1")).getByRole("button", { name: /Todos/ }),
			);
			await waitFor(() => expect(document.activeElement === first).toBe(true));
			const scrolled: Element[] = [];
			const scroll = spyOn(
				HTMLElement.prototype,
				"scrollIntoView",
			).mockImplementation(function (this: HTMLElement) {
				scrolled.push(this);
			});
			try {
				await act(async () => fireEvent.keyDown(first, { key: "Enter" }));
				await act(async () =>
					fireEvent.keyDown(document.activeElement as Element, {
						key: "Enter",
					}),
				);
			} finally {
				scroll.mockRestore();
			}

			expect(scrolled).toEqual([card(view, "2"), card(view, "3")]);
			const thread = view.container.ownerDocument.querySelector(
				'[data-slot="aui_thread-viewport"]',
			) as HTMLElement;
			expect(thread.style.scrollPaddingBottom).toMatch(/^\d+px$/);
		});

		it("sends with ⌘Enter from any question", async () => {
			const view = await testing.openConversations([asking()]);
			const note = await waitFor(
				() =>
					within(card(view, "3")).getByRole("textbox") as HTMLTextAreaElement,
			);
			await act(async () =>
				fireEvent.change(note, { target: { value: "after a check" } }),
			);
			await act(async () =>
				fireEvent.keyDown(note, { key: "Enter", metaKey: true }),
			);

			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: { text: "> **Ready to merge?**\n\nafter a check" },
				},
			]);
		});

		it("keeps a note that starts like a choice as typed, picking nothing", async () => {
			const view = await testing.openConversations([asking()]);
			const second = await waitFor(() => card(view, "2"));
			const note = within(second).getByRole("textbox") as HTMLTextAreaElement;

			for (const typed of ["a", "a ", "a lot"]) {
				await act(async () =>
					fireEvent.change(note, { target: { value: typed } }),
				);
				expect(note.value).toBe(typed);
			}
			expect(
				within(second)
					.getByRole("button", { name: /A muted card/ })
					.getAttribute("aria-pressed"),
			).toBe("false");
		});

		it("labels how each question picks, and marks the agent's pick", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message(
							"agent",
							[
								"1. How should a stale todo be shown?",
								"   - (a) A muted card (chosen)",
								"   - (b) A badge",
							].join("\n"),
						),
					],
				}),
			]);
			const first = await waitFor(() => card(view, "1"));

			expect(within(first).getByText("Pick one")).toBeTruthy();
			expect(
				within(first).getByRole("button", { name: /A muted card/ }).textContent,
			).toContain("Recommended");
			expect(within(first).queryByText(/\(chosen\)/)).toBeNull();
			expect(
				within(card(view, "1")).queryByText("Select all that apply"),
			).toBeNull();
		});

		it("puts an order question's choices in order by its buttons and Alt with the arrows, sending the letters", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Settings",
					messages: [
						message("user", "add settings pages"),
						message(
							"agent",
							[
								"1. In what order should the pages land?",
								"   - a. Profile",
								"   - b. Billing",
								"   - c. Notifications",
							].join("\n"),
						),
					],
				}),
			]);
			const first = await waitFor(() => card(view, "1"));
			const order = () =>
				within(first)
					.getAllByRole("listitem")
					.map(
						(row) =>
							row.textContent?.match(/Profile|Billing|Notifications/)?.[0],
					);

			expect(
				within(first).getByText("Put in order, first at the top"),
			).toBeTruthy();
			await act(async () =>
				fireEvent.click(
					within(first).getByRole("button", { name: "Move c up" }),
				),
			);
			expect(order()).toEqual(["Profile", "Notifications", "Billing"]);
			const top = within(first).getAllByRole("listitem")[0] as HTMLElement;
			await act(async () => top.focus());
			await act(async () =>
				fireEvent.keyDown(top, { key: "ArrowDown", altKey: true }),
			);
			expect(order()).toEqual(["Notifications", "Profile", "Billing"]);
			await act(async () =>
				fireEvent.keyDown(top, { key: "Enter", metaKey: true }),
			);

			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: [
							"> **In what order should the pages land?**",
							"",
							"1. (c) Notifications",
							"2. (a) Profile",
							"3. (b) Billing",
						].join("\n"),
					},
				},
			]);
		});

		it("answers an order question with the order as it stands", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Settings",
					messages: [
						message("user", "add settings pages"),
						message(
							"agent",
							"1. In what order?\n   - a. Profile\n   - b. Billing",
						),
					],
				}),
			]);
			const first = await waitFor(() => card(view, "1"));
			await act(async () =>
				fireEvent.click(
					within(first).getByRole("button", { name: "Keep this order" }),
				),
			);

			expect(
				within(first).getByRole("button", { name: "Clear order" }),
			).toBeTruthy();
			expect(view.getByText("1 of 1 answered")).toBeTruthy();
		});

		it("folds questions once replied to, opening on the answers sent, never asking them again", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Header",
					messages: [
						message("user", "fix the header"),
						message("agent", report),
						message(
							"user",
							"1. a, b\n2. b: only on phones\n\nAlso the footer.",
						),
						message("agent", "Done."),
					],
				}),
			]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "escalated header" }),
			);
			const fold = within(panel).getByRole("button", {
				name: /Escalated/,
			});
			expect(fold.getAttribute("aria-expanded")).toBe("false");
			expect(fold.textContent).toContain("2 of 3 answered");
			expect(view.queryByRole("list", { name: "questions" })).toBeNull();

			await act(async () => fireEvent.click(fold));

			const second = within(panel).getByRole("listitem", {
				name: "question 2",
			});
			const badge = within(second).getByRole("button", {
				name: /A badge/,
			}) as HTMLButtonElement;
			expect(badge.getAttribute("aria-pressed")).toBe("true");
			expect(badge.disabled).toBe(true);
			expect(within(second).getByText("only on phones")).toBeTruthy();
			expect(within(panel).queryByRole("textbox")).toBeNull();
			expect(within(panel).getByText("Also the footer.")).toBeTruthy();
			expect(textIn(box(view))).toBe("");
		});

		it("waits for the agent to finish writing before showing cards", async () => {
			const view = await testing.openConversations([asking("running")]);
			await waitFor(() =>
				expect(view.getByText(/The header wraps now/)).toBeTruthy(),
			);
			expect(view.queryByRole("list", { name: "questions" })).toBeNull();

			await testing.say(asking("idle"));

			await waitFor(() =>
				expect(view.getByRole("list", { name: "questions" })).toBeTruthy(),
			);
		});
	});

	describe("work row", () => {
		const second = (secs: number) =>
			new Date(Date.parse("2026-10-11T10:00:00Z") + secs * 1000).toISOString();
		const turn = (
			parts: Parameters<typeof message>[1][],
			{
				status = "idle" as ConversationState["status"],
				plan = null as
					| null
					| { text: string; status: "pending" | "in_progress" | "completed" }[],
			} = {},
		) =>
			conversation({
				title: "Tests",
				status,
				messages: [
					{
						...message("user", "run the tests"),
						at: second(0),
						until: second(0),
					},
					{
						...message("agent", ...parts),
						plan,
						at: second(1),
						until: second(65),
					},
				],
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

		it("says what each call does while it runs, and what it did once done", async () => {
			const calls = (status: "in_progress" | "completed") => [
				tool({
					id: "r1",
					kind: "read",
					title: "Read /repo/a.ts (1 - 80)",
					paths: ["/repo/a.ts"],
					status,
				}),
				tool({ id: "g1", kind: "search", target: "fold\\(", status }),
				tool({
					id: "m1",
					kind: "other",
					title: "mcp__playwright__browser_click",
					status,
				}),
				tool({ id: "x1", kind: "execute", title: "Terminal", status }),
			];
			const thread = await opened(
				turn(calls("in_progress"), { status: "running" }),
			);
			const rows = () =>
				lines(within(thread).getByRole("list", { name: "timeline" }));

			await waitFor(() =>
				expect(rows()).toEqual([
					"Readinga.ts#L1-80",
					"Searchingfold\\(",
					"Usingbrowser_click (playwright)",
					"Running",
				]),
			);

			await testing.say(turn([...calls("completed"), "Done."]));
			await waitFor(() =>
				expect(rows()).toEqual([
					"Reada.ts#L1-80",
					"Searchedfold\\(",
					"Usedbrowser_click (playwright)",
					"Ran",
				]),
			);
		});

		const reading = () =>
			turn([
				tool({
					id: "r1",
					kind: "read",
					title: "Read /repo/src/a.ts (12 - 80)",
					paths: ["/repo/src/a.ts"],
				}),
				"Done.",
			]);

		it("opens a file chip in the editor the settings pick", async () => {
			localStorage.setItem(
				"arbor.settings",
				JSON.stringify({ "editor.opener": "vscode" }),
			);
			const thread = await opened(reading());

			const chip = await waitFor(() => within(thread).getByRole("link"));
			expect(chip.getAttribute("href")).toBe("vscode://file/repo/src/a.ts:12");
		});

		it("shows each file a call names as a chip, opening in Zed at its lines", async () => {
			const thread = await opened(
				turn([
					tool({
						id: "r1",
						kind: "read",
						title: "Read /repo/src/a.ts (12 - 80)",
						paths: ["/repo/src/a.ts"],
					}),
					tool({ id: "r2", kind: "read", paths: ["/repo/notes.xyz"] }),
					"Done.",
				]),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			const [code, other] = within(timeline).getAllByRole("link");
			expect([code?.textContent, code?.getAttribute("href")]).toEqual([
				"a.ts#L12-80",
				"zed://file/repo/src/a.ts:12",
			]);
			// TypeScript's icon, not the plain page of a file it cannot tell.
			const icon = (chip: Element | undefined) =>
				chip?.querySelector("img")?.getAttribute("src");
			expect(icon(code)).toStartWith("data:image/svg+xml,");
			expect(icon(code)).not.toBe(icon(other));
			expect(other?.textContent).toBe("notes.xyz");
		});

		it("gives a caret only to a row that opens to more", async () => {
			const thread = await opened(
				turn([
					tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"], output: "x" }),
					tool({ id: "x1", command: "bun test", output: "1 pass" }),
					"Done.",
				]),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			const [read, command] = within(timeline).getAllByRole("listitem");
			expect(read?.querySelector("details")).toBeNull();
			expect(read?.querySelector(".lucide-chevron-right")).toBeNull();
			expect(
				command?.querySelector("summary .lucide-chevron-right"),
			).not.toBeNull();
		});

		it("warns of a command that did to git what it should not have, opening to the command", async () => {
			const thread = await opened(
				turn([
					tool({ id: "x1", command: "git status" }),
					tool({
						id: "x2",
						command: "git stash && cd /repo && touch stray.txt",
						flags: [
							{ type: "stashed", count: 1 },
							{ type: "outside", paths: ["stray.txt"] },
						],
					}),
					"Done.",
				]),
			);

			const warnings = await waitFor(() =>
				within(thread).getByRole("list", { name: "warnings" }),
			);
			expect(
				within(warnings).getAllByRole("listitem")[0]?.textContent,
			).toContain(
				"Stashed changes and left them there · Changed 1 file in the main tree",
			);
			expect(warnings.textContent).toContain(
				"$ git stash && cd /repo && touch stray.txt",
			);
			expect(
				within(warnings).getByRole("list", {
					name: "files changed in the main tree",
				}).textContent,
			).toBe("stray.txt");
			expect(warnings.textContent).not.toContain("git status");
		});

		it("shows how each permission the agent asked was answered, above its call", async () => {
			const at = "2026-10-11T12:00:00.000Z";
			const thread = await opened(
				turn([
					tool({
						id: "x1",
						command: "rm -rf build",
						decision: {
							option: { name: "Allow", kind: "allow_once" },
							at,
						},
					}),
					tool({
						id: "x2",
						command: "git push",
						status: "failed",
						decision: {
							option: { name: "Reject", kind: "reject_once" },
							at,
						},
					}),
					tool({ id: "x3", command: "deploy", decision: { option: null, at } }),
					"Done.",
				]),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(
				within(timeline)
					.getAllByRole("listitem")
					.map((each) => each.textContent),
			).toEqual([
				"Allowed for this sessionrm -rf build",
				expect.stringContaining("rm -rf build"),
				"Deniedgit push",
				expect.stringContaining("git push"),
				"Dismisseddeploy",
				expect.stringContaining("deploy"),
			]);
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

		it("marks a command the agent never finished as stopped once its turn is over", async () => {
			const thread = await opened(
				turn([
					tool({ id: "x1", command: "bun test" }),
					tool({ id: "x2", command: "bun run demo", status: "in_progress" }),
					"Done.",
				]),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(within(timeline).getByText("Ran")).toBeTruthy();
			expect(within(timeline).getByText("Stopped running")).toBeTruthy();
			expect(within(timeline).queryByText("Running")).toBeNull();
			expect(within(timeline).getByText("No output")).toBeTruthy();
		});

		it("counts a command run again in a row, and opens it to its output", async () => {
			const thread = await opened(
				turn([
					tool({ id: "x1", command: "bun test", status: "failed" }),
					tool({ id: "x2", command: "bun test", status: "failed" }),
					tool({
						id: "x3",
						command: "bun test",
						status: "failed",
						output: "\u001b[31m1 fail\u001b[39m",
					}),
					"Still failing.",
				]),
			);

			const row = await waitFor(() => within(thread).getByText("×3"));
			const command = row.closest("details") as HTMLDetailsElement;
			expect(within(command).getByText("Failed to run")).toBeTruthy();
			expect(within(command).getByLabelText("output").textContent).toBe(
				"1 fail",
			);
		});

		it("names each edited file in its row by its name alone, the whole path its tooltip, opening to the edit", async () => {
			const thread = await opened(
				turn([
					tool({
						id: "e1",
						kind: "edit",
						paths: ["/repo/src/a.ts"],
						edits: [{ path: "/repo/src/a.ts", old: "one", new: "two" }],
					}),
					tool({
						id: "e2",
						kind: "edit",
						paths: ["/repo/src/a.ts"],
						edits: [{ path: "/repo/src/a.ts", old: "two", new: "three" }],
					}),
					tool({
						id: "e3",
						kind: "edit",
						paths: ["/repo-arbor/gone/lib/b.ts"],
						edits: [
							{ path: "/repo-arbor/gone/lib/b.ts", old: null, new: "new" },
						],
					}),
					tool({
						id: "e4",
						kind: "edit",
						paths: ["/tmp/c.ts"],
						edits: [{ path: "/tmp/c.ts", old: null, new: "new" }],
					}),
					"Done.",
				]),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(
				within(thread).queryByRole("list", { name: "edited files" }),
			).toBeNull();
			expect(
				within(timeline)
					.getAllByRole("link")
					.map((chip) => [chip.title, chip.textContent]),
			).toEqual([
				["/repo/src/a.ts", "a.ts"],
				["/repo/src/a.ts", "a.ts"],
				["/repo-arbor/gone/lib/b.ts", "b.ts"],
				["/tmp/c.ts", "c.ts"],
			]);
			const first = within(timeline).getAllByRole("listitem")[0] as HTMLElement;
			await act(async () => {
				(first.querySelector("details") as HTMLDetailsElement).open = true;
			});
			expect(
				within(first)
					.getAllByLabelText("edit to /repo/src/a.ts")
					.map((edit) => edit.textContent),
			).toEqual(["src/a.ts+1 −1−one+two"]);
		});

		it("says only how long it has worked while it works, shimmering, with its plan", async () => {
			const thread = await opened(
				turn(
					[
						tool({
							id: "x1",
							command: "bun test",
							status: "in_progress",
							at: second(20),
						}),
					],
					{
						status: "running",
						plan: [
							{ text: "Run the tests", status: "in_progress" },
							{ text: "Fix what fails", status: "pending" },
						],
					},
				),
			);

			const line = await waitFor(() => within(thread).getByText(/^Working /));
			expect(line.textContent).not.toContain("bun test");
			expect(line.className).toContain("shimmer");
			expect(
				within(thread).getByRole("list", { name: "plan" }).textContent,
			).toBe("Run the testsFix what fails");
		});

		it("says Working once while it works, on its line rather than under it too", async () => {
			const thread = await opened(
				turn([tool({ id: "x1", command: "bun test", status: "in_progress" })], {
					status: "running",
				}),
			);

			await waitFor(() => within(thread).getByText(/^Working /));
			expect(thread.textContent?.match(/Working/g)).toHaveLength(1);
		});

		it("stays folded while the agent works, and once it replies", async () => {
			const working = turn([tool({ id: "x1", command: "bun test" })], {
				status: "running",
			});
			const thread = await opened(working);
			const details = () =>
				within(thread)
					.getByRole("list", { name: "timeline" })
					.closest("details") as HTMLDetailsElement;
			await waitFor(() => within(thread).getByText(/^Working/));
			expect(details().open).toBe(false);

			await testing.say(
				turn([tool({ id: "x1", command: "bun test" }), "Tests pass."], {
					status: "running",
				}),
			);
			await waitFor(() => expect(thread.textContent).toContain("Tests pass."));
			expect(details().open).toBe(false);
		});

		it("keeps the agent's latest words in the row while it works, until a moment passes with nothing after them", async () => {
			const thread = await opened(
				turn(
					[
						tool({ id: "x1", command: "bun test" }),
						{
							type: "text",
							text: "Now the fix.",
							at: new Date(Date.now() - 500).toISOString(),
						},
					],
					{ status: "running" },
				),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(timeline.textContent).toContain("Now the fix.");
			expect(within(thread).getByText(/^Working /)).toBeTruthy();
			await waitFor(
				() =>
					expect(
						within(thread).getByRole("list", { name: "timeline" }).textContent,
					).not.toContain("Now the fix."),
				{ timeout: 2000 },
			);
			await waitFor(() => expect(thread.textContent).toContain("Now the fix."));
			expect(within(thread).queryByText(/^Working /)).toBeNull();
		});

		it("folds what the agent said before its latest call into the row while it works", async () => {
			const thread = await opened(
				turn(
					[
						"Let me look.",
						tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
						{ type: "thought", text: "Which tests?", at: second(1) },
					],
					{ status: "running" },
				),
			);

			const timeline = await waitFor(() =>
				within(thread).getByRole("list", { name: "timeline" }),
			);
			expect(timeline.textContent).toContain("Let me look.");
			expect(within(thread).getAllByText("Let me look.")).toHaveLength(1);
		});

		it("folds the row once the agent speaks, taking in its words as it goes on, and one opened again stays open", async () => {
			const thread = await opened(
				turn([tool({ id: "x1", command: "bun test" }), "Checking."], {
					status: "running",
				}),
			);
			const timelines = () =>
				within(thread).getAllByRole("list", { name: "timeline" });
			const details = () =>
				timelines()[0]?.closest("details") as HTMLDetailsElement;
			await waitFor(() => expect(thread.textContent).toContain("Checking."));
			expect(details().open).toBe(false);
			expect(timelines()[0]?.textContent).not.toContain("Checking.");
			await act(async () => {
				details().open = true;
				details().dispatchEvent(new Event("toggle"));
			});

			await testing.say(
				turn(
					[
						tool({ id: "x1", command: "bun test" }),
						"Checking.",
						tool({ id: "x2", command: "bun run demo" }),
					],
					{ status: "running" },
				),
			);
			await waitFor(() => expect(thread.textContent).toContain("bun run demo"));
			expect(timelines()).toHaveLength(1);
			expect(timelines()[0]?.textContent).toContain("Checking.");
			expect(details().open).toBe(true);
			await testing.say(
				turn(
					[
						tool({ id: "x1", command: "bun test" }),
						"Checking.",
						tool({ id: "x2", command: "bun run demo" }),
						"Still checking.",
					],
					{ status: "running" },
				),
			);
			await waitFor(() =>
				expect(thread.textContent).toContain("Still checking."),
			);
			expect(timelines()).toHaveLength(1);
			expect(timelines()[0]?.textContent).not.toContain("Still checking.");
			expect(details().open).toBe(true);
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

	describe("review panel", () => {
		const reviewing = conversation({
			title: "Header",
			messages: [
				message(
					"agent",
					[
						"## 🔍 Ready to merge header onto main",
						"",
						"The header wraps on phones.",
						"",
						"Open the page at 390px wide.",
						"",
						'Reply "merge", or say what to change.',
					].join("\n"),
				),
			],
		});
		const box = (view: ConversationsView) =>
			view.getByRole("textbox", {
				name: "Message input",
			});

		it("shows a review apart from questions, merging from the card", async () => {
			const view = await testing.openConversations([reviewing]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review header" }),
			);
			expect(
				within(panel).getByText("The header wraps on phones."),
			).toBeTruthy();
			expect(view.queryByText(/Reply "merge"/)).toBeNull();
			expect(view.queryByRole("list", { name: "questions" })).toBeNull();

			await act(async () =>
				fireEvent.click(within(panel).getByRole("button", { name: "Merge" })),
			);

			expect(textIn(box(view))).toBe("");
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "merge" } },
			]);
		});

		it("says what to change from the card by keyboard, kept as a draft until sent", async () => {
			const view = await testing.openConversations([reviewing]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review header" }),
			);
			const changes = within(panel).getByRole("textbox", {
				name: "Changes to header",
			}) as HTMLTextAreaElement;
			// Ready to answer as soon as it shows.
			await waitFor(() =>
				expect(document.activeElement === changes).toBe(true),
			);
			const merge = within(panel).getByRole("button", {
				name: "Merge",
			}) as HTMLButtonElement;
			expect(merge.disabled).toBe(false);

			await act(async () =>
				fireEvent.change(changes, {
					target: { value: "merge the header first" },
				}),
			);
			expect(changes.value).toBe("merge the header first");
			// Merging would leave the changes unsaid.
			expect(merge.disabled).toBe(true);
			expect(textIn(box(view))).toBe("");
			expect(localStorage.getItem("arbor.draft.c1:review:0")).toBe(
				"merge the header first",
			);
			await act(async () =>
				fireEvent.keyDown(changes, { key: "Enter", shiftKey: true }),
			);
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
			await act(async () => fireEvent.keyDown(changes, { key: "Enter" }));

			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "merge the header first" } },
			]);
		});

		it("folds once the person has replied, opening on the reply that was sent, whatever is typed after", async () => {
			const view = await testing.openConversations([
				conversation({
					...reviewing,
					messages: [
						...reviewing.messages,
						message("user", "merge"),
						message("agent", "Merged."),
					],
				}),
			]);
			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review header" }),
			);
			const fold = within(panel).getByRole("button", {
				name: /Ready to merge/,
			});
			expect(fold.getAttribute("aria-expanded")).toBe("false");
			expect(fold.textContent).toContain("Merge approved");
			expect(panel.textContent).not.toContain("The header wraps on phones.");

			await typeIn(box(view), "merge");
			await act(async () => fireEvent.click(fold));

			expect(panel.textContent).toContain("The header wraps on phones.");
			expect(
				within(panel).queryByRole("button", { name: /^Merge/ }),
			).toBeNull();
			expect(within(panel).queryByRole("textbox")).toBeNull();
		});
	});

	describe("report cards", () => {
		it("shows how each task ended, or what it waits on, as a card", async () => {
			await testing.openConversations([
				conversation({
					title: "Reports",
					messages: [
						message(
							"agent",
							[
								"## ✅ Merged header onto main",
								"",
								"The header wraps now.",
								"",
								"## 🛑 Removed footer: superseded by a fix on main",
								"",
								"It set out to move the footer.",
								"",
								"## ⚠️ Escalated sidebar: needs a call on the width",
								"",
								"The sidebar folds on phones.",
							].join("\n"),
						),
					],
				}),
			]);
			const view = document.body;

			const merged = await waitFor(() =>
				within(view).getByRole("region", { name: "merged header" }),
			);
			expect(merged.textContent).toContain("Merged");
			expect(merged.textContent).toContain("main");
			expect(merged.textContent).toContain("The header wraps now.");
			const removed = within(view).getByRole("region", {
				name: "removed footer",
			});
			expect(removed.textContent).toContain("superseded by a fix on main");
			expect(removed.textContent).toContain("It set out to move the footer.");
			const escalated = within(view).getByRole("region", {
				name: "escalated sidebar",
			});
			expect(escalated.textContent).toContain("needs a call on the width");
			expect(view.textContent).not.toContain("## ✅");
		});

		/** Records each element scrolled into view while `run` runs, in `scrolled`. */
		const scrollingIntoView = async (
			run: (scrolled: Element[]) => Promise<void>,
		) => {
			const scrolled: Element[] = [];
			const scroll = spyOn(
				HTMLElement.prototype,
				"scrollIntoView",
			).mockImplementation(function (this: HTMLElement) {
				scrolled.push(this);
			});
			try {
				await run(scrolled);
			} finally {
				scroll.mockRestore();
			}
			return scrolled;
		};

		const talk = [
			message("user", "fix the footer"),
			message("agent", "It moved."),
			message("user", "fix the header"),
			message("agent", "It wraps."),
		];

		it("opens an unread conversation at the first message its person has yet to see, clear of their message", async () => {
			let reply: Element | null = null;
			const scrolled = await scrollingIntoView(async (seen) => {
				await testing.openConversations([
					conversation({ messages: talk, unread: true, seen: 3 }),
				]);
				reply = await waitFor(() => {
					const found = document.querySelector(
						'[data-role="assistant"][data-message-id="3"]',
					);
					expect(found).not.toBeNull();
					return found;
				});
				await waitFor(() => expect(seen.at(-1)).toBe(reply as Element));
			});

			expect(new Set<Element | null>(scrolled)).toEqual(new Set([reply]));
			expect((reply as HTMLElement | null)?.style.scrollMarginTop).toMatch(
				/^\d+(\.\d+)?px$/,
			);
		});

		it("opens a conversation read to its end at the bottom", async () => {
			const scrolled = await scrollingIntoView(async () => {
				await testing.openConversations([
					conversation({ messages: talk, unread: false, seen: 1 }),
				]);
				await waitFor(() =>
					expect(within(document.body).getByText("It wraps.")).toBeTruthy(),
				);
				await act(() => new Promise((done) => requestAnimationFrame(done)));
			});

			expect(scrolled).toEqual([]);
		});

		it("keeps the thread clear of the composer only while the focus is elsewhere, so typing never scrolls it", async () => {
			// The footer's height, which the page has no layout to give.
			const height = Object.getOwnPropertyDescriptor(
				HTMLElement.prototype,
				"offsetHeight",
			) as PropertyDescriptor;
			Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
				configurable: true,
				get: () => 120,
			});
			try {
				const view = await testing.openConversations([
					conversation({
						messages: [
							message("user", "fix the footer"),
							message("agent", "## ✅ Merged footer onto main\n\nIt moved."),
						],
					}),
				]);
				const thread = await waitFor(
					() =>
						document.querySelector(
							'[data-slot="aui_thread-viewport"]',
						) as HTMLElement,
				);
				const composer = within(view.container).getByRole("textbox", {
					name: "Message input",
				});
				const archive = await waitFor(() =>
					within(view.getByRole("region", { name: "merged footer" })).getByRole(
						"button",
						{ name: "Archive" },
					),
				);

				act(() => composer.focus());
				expect(thread.style.scrollPaddingBottom).toBe("0px");
				act(() => archive.focus());
				expect(thread.style.scrollPaddingBottom).toBe("120px");
			} finally {
				Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
			}
		});

		it("shows a report's markdown as the agent wrote it in place of its body, to copy, until toggled back", async () => {
			const written = [
				"## ✅ Merged header onto main",
				"",
				"The header **wraps** now.",
			].join("\n");
			const view = await testing.openConversations([
				conversation({
					messages: [
						message(
							"agent",
							`${written}\n\n### 📝 Fold the sidebar [#7]\n\nNext.`,
						),
					],
				}),
			]);
			const copied: string[] = [];
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: { writeText: async (text: string) => void copied.push(text) },
			});
			const card = await waitFor(() =>
				view.getByRole("region", { name: "merged header" }),
			);
			const toggle = within(card).getByRole("button", { name: "Show source" });
			expect(toggle.getAttribute("aria-pressed")).toBe("false");
			expect(card.querySelector("pre")).toBeNull();

			act(() => fireEvent.click(toggle));

			expect(toggle.getAttribute("aria-pressed")).toBe("true");
			expect(card.querySelector("pre")?.textContent).toBe(written);
			expect(card.querySelector("strong")).toBeNull();
			await act(async () =>
				fireEvent.click(within(card).getByRole("button", { name: "Copy" })),
			);
			expect(copied).toEqual([written]);
			expect(
				within(card).getByRole("button", { name: "Copied" }),
			).not.toBeNull();

			act(() => fireEvent.click(toggle));

			expect(card.querySelector("pre")).toBeNull();
			expect(card.querySelector("strong")?.textContent).toBe("wraps");
		});

		it("offers to archive the conversation from each report of a task that is over, then goes on to a new one with none waiting", async () => {
			const view = await testing.openConversations([
				conversation({
					messages: [
						message(
							"agent",
							"## ✅ Merged header onto main\n\nThe header wraps now.",
						),
						message("user", "now the footer"),
						message(
							"agent",
							[
								"## ⚠️ Escalated footer: needs a call on the color",
								"",
								"The footer is gray.",
								"",
								"## 🛑 Removed sidebar: superseded by a fix on main",
								"",
								"It set out to fold the sidebar.",
							].join("\n"),
						),
					],
				}),
			]);
			const archive = (name: string) =>
				within(view.getByRole("region", { name })).queryByRole("button", {
					name: "Archive",
				});

			const removed = await waitFor(() =>
				within(view.getByRole("region", { name: "removed sidebar" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			);
			expect(archive("merged header")).not.toBeNull();
			expect(archive("escalated footer")).toBeNull();

			await act(async () => fireEvent.click(removed));

			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]);
			await waitFor(() => expect(location.hash).toBe("#conversations/new"));
			expect(view.getByText("Start a conversation with")).toBeTruthy();
		});
	});

	describe("demo cards", () => {
		const demo = [
			"### 🎬 Demo: dragging a card",
			"",
			"Open http://localhost:4310 (a demo repo).",
			"",
			"1. Press and hold a card.",
			"   It lifts.",
			"2. Drag it to another lane.",
			"   It lands where you drop it.",
		];

		it("shows a demo as steps to tick off, where it runs a click away", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Demo",
					messages: [message("agent", demo.join("\n"))],
				}),
			]);

			const card = await waitFor(() =>
				view.getByRole("region", { name: "demo dragging a card" }),
			);
			expect(
				within(card).getByRole("link", { name: "Open" }).getAttribute("href"),
			).toBe("http://localhost:4310");
			expect(card.textContent).toContain("It lands where you drop it.");
			expect(card.textContent).toContain("0 of 2 tried");
			const first = within(card).getByRole("checkbox", {
				name: "Step 1 tried",
			}) as HTMLInputElement;

			await act(async () => fireEvent.click(first));

			expect(first.checked).toBe(true);
			expect(card.textContent).toContain("1 of 2 tried");
		});

		it("shows an escalation's demo in its questions' card, above them", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Demo",
					messages: [
						message(
							"agent",
							[
								"## ⚠️ Escalated board: needs a phone check",
								"",
								"Cards drag on phones now.",
								"",
								...demo,
								"",
								"1. Does dragging feel right?",
							].join("\n"),
						),
					],
				}),
			]);

			const card = await waitFor(() =>
				view.getByRole("region", { name: "escalated board" }),
			);
			const shown = within(card).getByRole("region", {
				name: "demo dragging a card",
			});
			expect(shown.textContent).toContain("Press and hold a card.");
			expect(card.textContent).toContain("Does dragging feel right?");
			expect(view.getAllByRole("region", { name: /^demo/ })).toEqual([shown]);
		});

		it("shows a review's demo in its panel, above Merge", async () => {
			const view = await testing.openConversations([
				conversation({
					title: "Demo",
					messages: [
						message(
							"agent",
							[
								"## 🔍 Ready to merge board onto main",
								"",
								"Cards drag on phones now.",
								"",
								...demo,
								"",
								'Reply "merge", or say what to change.',
							].join("\n"),
						),
					],
				}),
			]);

			const panel = await waitFor(() =>
				view.getByRole("region", { name: "review board" }),
			);
			expect(
				within(panel).getByRole("region", { name: "demo dragging a card" })
					.textContent,
			).toContain("Drag it to another lane.");
			expect(within(panel).getByRole("button", { name: "Merge" })).toBeTruthy();
		});
	});

	describe("todo cards", () => {
		const proposing = conversation({
			title: "Next",
			messages: [
				message(
					"agent",
					[
						"### 📝 Retry the upload [#12]",
						"",
						"It fails on a 413. It touches the retry loop.",
						"",
						"### 📝 Show the size limit [#14]",
						"",
						"Says how big a file may be.",
						"",
						"### 📝 Tidy the logs [#15]",
						"",
						"Already done.",
					].join("\n"),
				),
			],
		});

		const board = {
			todos: [
				todo({ id: 12, subject: "Retry the upload on a 413", lane: 3 }),
				todo({ id: 14, subject: "Show the size limit", takenBy: "limits" }),
			],
			lanes: [{ id: 3, name: "Uploads" }],
		};

		it("shows a proposed todo as the board has it, with Start sending its reference at once", async () => {
			const view = await testing.openConversations(
				[proposing],
				undefined,
				board,
			);
			const open = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);
			// Live: the subject as the board has it now, and its lane.
			expect(open.textContent).toContain("Retry the upload on a 413");
			expect(open.textContent).toContain("Uploads");
			expect(open.textContent).toContain("It fails on a 413.");
			const taken = view.getByRole("region", { name: "todo 14" });
			expect(taken.textContent).toContain("limits");
			expect(within(taken).queryByRole("button", { name: /Start/ })).toBeNull();
			const gone = view.getByRole("region", { name: "todo 15" });
			expect(gone.textContent).toContain("archived");
			expect(within(gone).queryByRole("button")).toBeNull();
			const box = view.getByRole("textbox", {
				name: "Message input",
			});
			await typeIn(box, "half a thought");

			await act(async () =>
				fireEvent.click(within(open).getByRole("button", { name: "Start" })),
			);

			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[ARBOR TODO #12]" } },
			]);
			expect(textIn(box)).toBe("half a thought");
		});

		it("opens a new conversation with a proposed todo's reference typed in, ahead of its draft, and this conversation's agent picked", async () => {
			const view = await testing.openConversations(
				[conversation({ ...proposing, agent: "codex" })],
				undefined,
				board,
			);
			const open = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);
			const taken = view.getByRole("region", { name: "todo 14" });
			expect(
				within(taken).queryByRole("button", {
					name: "Start in a new conversation",
				}),
			).toBeNull();
			localStorage.setItem("arbor.draft.new:", "and keep it small");

			await act(async () =>
				fireEvent.click(
					within(open).getByRole("button", {
						name: "Start in a new conversation",
					}),
				),
			);

			expect(location.hash).toBe("#conversations/new/codex");
			expect(
				within(
					view.getByText("Start a conversation with")
						.parentElement as HTMLElement,
				).getByLabelText("Codex"),
			).toBeTruthy();
			expect(textIn(view.getByRole("textbox", { name: "Message input" }))).toBe(
				"[ARBOR TODO #12]\n\nand keep it small",
			);
			expect(view.getByTitle("[ARBOR TODO #12]")).toBeTruthy();
			expect(testing.posted("/api/conversations")).toEqual([]);
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
		});

		it("keeps a todo as proposed once the person has replied, and says whether it was started", async () => {
			const view = await testing.openConversations(
				[
					conversation({
						...proposing,
						messages: [
							...proposing.messages,
							message("user", "[ARBOR TODO #12]"),
						],
					}),
				],
				undefined,
				board,
			);
			const started = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);

			expect(started.textContent).toContain("Retry the upload");
			// As proposed, not as the board has it now.
			expect(started.textContent).not.toContain("Uploads");
			expect(started.textContent).toContain("Started");
			expect(
				within(started).queryByRole("button", { name: /Start/ }),
			).toBeNull();
			const other = view.getByRole("region", { name: "todo 15" });
			expect(other.textContent).not.toContain("archived");
			expect(other.textContent).not.toContain("Started");
		});

		it("gathers the todos the reply's task added while it ran under the lane they went to, and not one from before or elsewhere", async () => {
			const at = (minute: number) =>
				new Date(Date.UTC(2026, 9, 13, 12, minute)).toISOString();
			const proposed = (id: number) => `### 📝 Todo ${id} [#${id}]\n\nWhy.`;
			const view = await testing.openConversations(
				[
					conversation({
						task: "uploads",
						lastTask: "uploads",
						messages: [
							{
								...message("user", "Fix the backoff"),
								at: at(0),
								until: at(0),
							},
							{
								...message(
									"agent",
									[12, 13, 14, 15, 16].map(proposed).join("\n\n"),
								),
								at: at(1),
								until: at(9),
							},
						],
					}),
				],
				undefined,
				{
					todos: [
						todo({ id: 12, from: "uploads", createdAt: at(5), lane: 3 }),
						todo({ id: 13, from: "uploads", createdAt: at(6), lane: 3 }),
						todo({ id: 14, from: "uploads", createdAt: at(7) }),
						// Added by the task, but in an earlier turn.
						todo({ id: 15, from: "uploads", createdAt: at(-30) }),
						// Added in the turn, by another task.
						todo({ id: 16, from: "logs", createdAt: at(5) }),
					],
					lanes: [{ id: 3, name: "Uploads" }],
				},
			);
			await waitFor(() => view.getByRole("region", { name: "todo 12" }));

			// Each line, with the cards on the rail under it.
			const groups = view.getAllByText(/^Added /).map((each) => {
				const line = each.closest("p");
				return [
					line?.textContent,
					[...(line?.nextElementSibling?.children ?? [])].map((card) =>
						card.getAttribute("aria-label"),
					),
				];
			});
			expect(groups).toEqual([
				["Added 2 to Uploads by this task", ["todo 12", "todo 13"]],
				["Added to Untriaged by this task", ["todo 14"]],
			]);
			expect(view.getByRole("region", { name: "todo 16" })).toBeTruthy();
		});

		it("opens a proposed todo from its subject, over the conversation", async () => {
			const view = await testing.openConversations(
				[proposing],
				undefined,
				board,
			);
			const open = await waitFor(() =>
				view.getByRole("region", { name: "todo 12" }),
			);

			await act(async () =>
				fireEvent.click(
					within(open).getByRole("button", {
						name: "Retry the upload on a 413",
					}),
				),
			);

			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: /Todo 12/ }),
			);
			expect(
				(
					within(dialog).getByRole("textbox", {
						name: "subject",
					}) as HTMLInputElement
				).value,
			).toBe("Retry the upload on a 413");
			// Over the conversation, which stays where it was.
			expect(location.hash).toStartWith("#conversations/");

			// Starting it in a new conversation leaves the dialog behind.
			await act(async () =>
				fireEvent.click(within(dialog).getByRole("button", { name: "Start" })),
			);
			const codex = await waitFor(() =>
				view.getByRole("menuitem", { name: /Codex/ }),
			);
			await act(async () => fireEvent.click(codex));
			expect(location.hash).toBe("#conversations/new/codex");
			await waitFor(() =>
				expect(view.queryByRole("dialog", { name: /Todo 12/ })).toBeNull(),
			);
		});

		it("opens a todo mentioned in a message, and shows one that is gone as archived", async () => {
			const view = await testing.openConversations(
				[
					conversation({
						title: "Mentions",
						messages: [
							message("user", "[ARBOR TODO #14] and #15"),
							message("agent", "Took #12, but not `#14`. #15 merged."),
						],
					}),
				],
				undefined,
				board,
			);
			const twelve = await waitFor(() =>
				view.getByRole("button", { name: "#12" }),
			);
			expect(twelve.title).toBe("Retry the upload on a 413");
			// In code, it is only what was typed.
			expect(view.getByText("#14", { selector: "code" })).toBeTruthy();
			// Gone from the list, in both the person's words and the agent's.
			expect(
				view.getAllByTitle("#15 is archived: merged or removed"),
			).toHaveLength(2);

			// The directive it starts with is a chip, which opens it too.
			await act(async () =>
				fireEvent.click(view.getByTitle("[ARBOR TODO #14]")),
			);
			await waitFor(() =>
				expect(view.getByRole("dialog", { name: /Todo 14/ })).toBeTruthy(),
			);
			await act(async () => fireEvent.click(twelve));
			await waitFor(() =>
				expect(view.getByRole("dialog", { name: /Todo 12/ })).toBeTruthy(),
			);
		});
	});
});

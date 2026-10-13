import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "../conversations";
import {
	AGENTS,
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	newWith,
	Testing,
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
	describe("the sidebar's marks", () => {
		const ask = {
			type: "permission" as const,
			id: "t1",
			at: "2026-10-11T10:00:00.000Z",
			title: "rm -rf build",
			options: [{ id: "yes", name: "Allow", kind: "allow_once" as const }],
		};

		/** Opens the page on Conversations, holding `held`, with `tasks` live. */
		const sidebar = async (
			held: ConversationState[],
			tasks = [details({ task: "alpha" })],
		) => {
			testing.talk = { agents: AGENTS, conversations: held };
			const view = await testing.open({ tasks });
			await act(async () =>
				fireEvent.click(
					await waitFor(() => view.getByRole("tab", { name: /Conversations/ })),
				),
			);
			return view;
		};

		/** Started a minute apart, the first last, so the list shows them in order. */
		const newestFirst = (held: ConversationState[]) =>
			held.map((each, at) => ({
				...each,
				createdAt: new Date(Date.UTC(2026, 9, 11, 10, 59 - at)).toISOString(),
			}));

		const PLAN = `# a task

## Goal

Cap upload retries

## Done

- [x] find the retry loop

## Next

- [ ] cap retries
- [ ] tell the user

## Blocked

- [ ] 1. How many retries?
`;

		/** The actions' first button: what the agent waits on you for. */
		const questionsButton = (view: Awaited<ReturnType<typeof sidebar>>) =>
			within(view.getByRole("navigation", { name: "actions" })).getAllByRole(
				"button",
			)[0] as HTMLElement;

		const rows = (view: Awaited<ReturnType<typeof sidebar>>) =>
			within(view.getByRole("navigation", { name: "conversations" }))
				.getAllByRole("listitem")
				.map((row) => [
					row.textContent,
					within(row).queryByRole("status")?.getAttribute("aria-label") ?? null,
				]);

		it("marks each agent waiting on you or working, and an idle one not at all", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Asks", status: "running", ask }),
					conversation({ id: "c2", title: "Runs", status: "running" }),
					conversation({ id: "c3", title: "Rests" }),
					conversation({ id: "c4", title: "Broke", status: "failed" }),
					conversation({ id: "c5", task: "alpha", title: "Plans" }),
				]),
			);

			expect(rows(view)).toEqual([
				["Asks", "waiting on you"],
				["Runs", "working"],
				["Rests", null],
				["Broke", "waiting on you"],
				["alpha", null],
			]);
		});

		it("marks a conversation whose task merged with the merge icon until the person carries on, one that escalated as waiting on you, and one removed not at all", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({
						id: "c1",
						title: "Landed",
						messages: [
							message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
						],
					}),
					conversation({
						id: "c2",
						title: "Dropped",
						messages: [
							message(
								"agent",
								"## 🛑 Removed footer: superseded\n\nIt moved the footer.",
							),
						],
					}),
					conversation({
						id: "c3",
						title: "Carried on",
						messages: [
							message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
							message("user", "now the footer"),
						],
					}),
					conversation({
						id: "c4",
						task: "alpha",
						title: "Stuck",
						messages: [
							message(
								"agent",
								"## ⚠️ Escalated sidebar: needs a call\n\nIt folds.",
							),
						],
					}),
				]),
				[
					details({
						task: "alpha",
						status: "escalated",
						escalation: "needs a call",
						escalatedAt: "2026-10-11T10:00:00.000Z",
					}),
				],
			);
			const marks = Object.fromEntries(
				within(view.getByRole("navigation", { name: "conversations" }))
					.getAllByRole("listitem")
					.map((row) => [
						row.textContent,
						(
							within(row).queryByRole("img", { name: "merged" }) ??
							within(row).queryByRole("status")
						)?.getAttribute("aria-label") ?? null,
					]),
			);

			expect(marks).toEqual({
				Landed: "merged",
				Dropped: null,
				"Carried on": null,
				alpha: "waiting on you",
			});
		});

		it("marks an agent that answered unseen with a blue dot, though not over a merge, waiting on you, or working", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Answered", unread: true }),
					conversation({
						id: "c2",
						title: "Landed",
						unread: true,
						messages: [
							message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
						],
					}),
					conversation({
						id: "c3",
						title: "Broke",
						status: "failed",
						unread: true,
					}),
					conversation({
						id: "c4",
						title: "Runs",
						status: "running",
						unread: true,
					}),
				]),
				[],
			);

			expect(rows(view)).toEqual([
				["Answered", "unread"],
				["Landed", null],
				["Broke", "waiting on you"],
				["Runs", "working"],
			]);
			expect(view.getByRole("img", { name: "merged" })).toBeDefined();
		});

		it("lists a task whose agent runs outside the page as working elsewhere, waiting once it escalates, and opens it alone with its questions, not its plan", async () => {
			const view = await sidebar(
				[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
				[
					details({ task: "alpha" }),
					details({ task: "beta", createdAt: "2026-10-11T09:58:00.000Z" }),
					details({
						task: "gamma",
						status: "escalated",
						escalation: "needs a call",
						escalatedAt: "2026-10-11T10:00:00.000Z",
						plan: PLAN,
					}),
				],
			);

			expect(rows(view)).toEqual([
				["alpha", null],
				["beta", "working elsewhere"],
				["gamma", "waiting on you"],
			]);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /gamma/ })),
			);
			expect(location.hash).toBe("#conversations/task/gamma");
			const alone = view.getByRole("region", { name: "gamma" });
			// Not its ARBOR.md, which the task line opens: what the page knows of the agent.
			expect(alone.textContent).not.toContain("Cap upload retries");
			expect(alone.textContent).toContain("Escalated: needs a call");
			expect(alone.textContent).toContain("Its agent runs outside the page");
			expect(
				within(alone).getByRole("list", { name: "questions" }).textContent,
			).toContain("How many retries?");
			// Its agent cannot be messaged: the cards copy their reply.
			const copied: string[] = [];
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: { writeText: async (text: string) => void copied.push(text) },
			});
			await act(async () =>
				fireEvent.change(
					within(alone).getByRole("textbox", { name: "Answer to 1" }),
					{ target: { value: "three" } },
				),
			);
			await act(async () =>
				fireEvent.click(
					within(alone).getByRole("button", { name: "Copy reply" }),
				),
			);
			expect(copied).toEqual(["> **How many retries?**\n\nthree"]);
			// The only one waiting, ⌥⌘M goes to its open question where it is.
			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "KeyM",
					altKey: true,
					metaKey: true,
				}),
			);
			expect(document.activeElement).toBe(
				within(alone).getByRole("textbox", { name: "Answer to 1" }),
			);
			expect(
				within(alone).getByRole("button", { name: "Copied" }),
			).toBeTruthy();
			await act(async () =>
				fireEvent.click(
					within(alone).getByRole("button", { name: "About gamma" }),
				),
			);
			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: "gamma" }),
			);
			expect(dialog.textContent).toContain("Cap upload retries");
		});

		it("lists the systems an external agent's task touches beside its view", async () => {
			const view = await sidebar(
				[],
				[
					details({
						task: "beta",
						systems: [{ name: "uploads", globs: ["src/upload/**"] }],
					}),
				],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /beta/ })),
			);

			const alone = view.getByRole("region", { name: "beta" });
			expect(
				within(alone).getByRole("region", { name: "systems" }).textContent,
			).toContain("uploads");
			expect(
				within(alone).getByRole("button", { name: "Systems" }),
			).toBeTruthy();
		});

		it("keeps the answers to an external agent across a reload, waiting on you no longer once its questions are seen, and marks its row once the reply is copied, until it asks again", async () => {
			const gamma = (plan: string) =>
				details({
					task: "gamma",
					status: "escalated",
					escalation: "needs a call",
					escalatedAt: "2026-10-11T10:00:00.000Z",
					plan,
				});
			const open = (view: Awaited<ReturnType<typeof sidebar>>) =>
				act(async () =>
					fireEvent.click(view.getByRole("button", { name: /gamma/ })),
				);
			const opened = async (plan: string) => {
				const view = await sidebar([], [gamma(plan)]);
				await open(view);
				return view;
			};
			const answer = (view: Awaited<ReturnType<typeof sidebar>>) =>
				(
					within(view.getByRole("region", { name: "gamma" })).getByRole(
						"textbox",
						{ name: "Answer to 1" },
					) as HTMLTextAreaElement
				).value;
			const next = () =>
				act(async () => {
					fireEvent.keyDown(document.body, {
						code: "KeyM",
						altKey: true,
						metaKey: true,
					});
					fireEvent.keyUp(window, { key: "Alt", metaKey: true });
				});
			const elsewhere = () =>
				act(async () => {
					location.hash = "#conversations/new";
					window.dispatchEvent(new HashChangeEvent("hashchange"));
				});
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: { writeText: async () => {} },
			});

			let view = await sidebar([], [gamma(PLAN)]);
			expect(rows(view)).toEqual([["gamma", "waiting on you"]]);
			await open(view);
			// Seen, it no longer waits on you, nor does ⌥⌘M stop on it.
			await waitFor(() => expect(rows(view)).toEqual([["gamma", null]]));
			expect(view.getByText("Nothing waiting on you")).toBeTruthy();
			expect(document.title).not.toContain("(1)");
			await elsewhere();
			await next();
			expect(location.hash).toBe("#conversations/new");

			await open(view);
			await act(async () =>
				fireEvent.change(view.getByRole("textbox", { name: "Answer to 1" }), {
					target: { value: "three" },
				}),
			);
			cleanup();
			view = await opened(PLAN);
			expect(answer(view)).toBe("three");

			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Copy reply" })),
			);
			await waitFor(() =>
				expect(rows(view)).toEqual([["gamma", "reply copied"]]),
			);
			// Kept, to copy again until its agent records it.
			cleanup();
			view = await opened(PLAN);
			expect(answer(view)).toBe("three");
			expect(rows(view)).toEqual([["gamma", "reply copied"]]);

			// A question asked since waits on you again, until seen.
			cleanup();
			const asked = `${PLAN}- [ ] 2. Which errors count?\n`;
			view = await sidebar([], [gamma(asked)]);
			expect(rows(view)).toEqual([["gamma", "waiting on you"]]);
			await next();
			expect(location.hash).toBe("#conversations/task/gamma");
			expect(answer(view)).toBe("three");
			await waitFor(() => expect(rows(view)).toEqual([["gamma", null]]));
		});

		it("brings a session in from a task whose agent runs outside the page, and opens it", async () => {
			testing.sessions = [
				{
					agent: "claude",
					session: "cli-1",
					title: "Fix the upload",
					updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
				},
			];
			const view = await sidebar([], [details({ task: "beta" })]);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /beta/ })),
			);
			const sessions = await waitFor(() =>
				within(view.getByRole("region", { name: "beta" })).getByRole("region", {
					name: "sessions",
				}),
			);
			await waitFor(() =>
				expect(sessions.textContent).toContain("Fix the upload"),
			);
			expect(sessions.textContent).toContain("5m ago");
			testing.reply = conversation({
				id: "c9",
				task: "beta",
				title: "Fix the upload",
				status: "starting",
			});

			await act(async () =>
				fireEvent.click(
					within(sessions).getByRole("button", { name: "Bring in" }),
				),
			);

			await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
			expect(testing.posts.at(-1)).toMatchObject({
				path: "/api/conversations/sessions",
				method: "POST",
			});
			expect(JSON.parse(String(testing.posts.at(-1)?.body))).toEqual({
				agent: "claude",
				session: "cli-1",
				title: "Fix the upload",
				task: "beta",
			});
			// Its thread, named for its task, as one started here is.
			await waitFor(() =>
				expect(
					within(view.getByRole("region", { name: "beta" })).getByRole(
						"heading",
						{ name: "beta" },
					),
				).toBeTruthy(),
			);
		});

		it("says when no session in a task's tree can be brought in", async () => {
			const view = await sidebar([], [details({ task: "beta" })]);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /beta/ })),
			);

			await waitFor(() =>
				expect(
					view.getByRole("region", { name: "sessions" }).textContent,
				).toContain("None the page could bring in."),
			);
		});

		it("heads a conversation with its branch, which opens its task", async () => {
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						title: "Fix login",
						status: "running",
					}),
				],
				[details({ task: "alpha", plan: PLAN })],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			const about = view.getByRole("button", { name: "About alpha" });

			expect(about.textContent).toBe("task/alpha");
			await act(async () => fireEvent.click(about));
			const dialog = await waitFor(() =>
				view.getByRole("dialog", { name: "alpha" }),
			);
			expect(dialog.textContent).toContain("Cap upload retries");
		});

		it("heads a conversation with its title alone, leaving its task's status to the conversation", async () => {
			const view = await sidebar(
				[conversation({ id: "c1", task: "alpha", name: "Fix login" })],
				[details({ task: "alpha", status: "escalated" })],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude Fix login" })),
			);

			const title = view.getByRole("heading", { name: "Fix login" });
			expect(title.parentElement?.textContent).toBe("Fix login");
		});

		it("scrolls the card asking the open questions to its top from the actions", async () => {
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						messages: [
							message("user", "cap the retries"),
							message(
								"agent",
								"## ⚠️ Escalated alpha: needs a call\n\nIt caps.\n\n1. How many retries?",
							),
						],
					}),
				],
				[details({ task: "alpha", plan: PLAN })],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			const escalated = await waitFor(() =>
				view.getByRole("region", { name: "escalated alpha" }),
			);
			const scrolled: [string | null, unknown][] = [];
			const scroll = spyOn(
				HTMLElement.prototype,
				"scrollIntoView",
			).mockImplementation(function (this: HTMLElement, options) {
				scrolled.push([this.getAttribute("aria-label"), options]);
			});
			try {
				await act(async () => fireEvent.click(questionsButton(view)));
			} finally {
				scroll.mockRestore();
			}

			expect(scrolled).toEqual([
				["escalated alpha", { block: "start", behavior: "smooth" }],
			]);
			expect(escalated.contains(document.activeElement)).toBe(true);
		});

		it("says among a conversation's actions whether it has open questions, opening the plan while no card in the thread asks them", async () => {
			const view = await sidebar(
				[
					conversation({ id: "c1", task: "alpha", status: "running" }),
					conversation({ id: "c2", task: null, title: "Look around" }),
				],
				[details({ task: "alpha", plan: PLAN })],
			);
			await act(async () =>
				fireEvent.click(
					view.getByRole("button", { name: "Claude Look around" }),
				),
			);
			expect(
				view.getByRole("region", { name: "Look around" }).textContent,
			).toContain("No open questions");
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			expect(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /1 open question/ },
				).textContent,
			).toBe("1 open question");
			// At work on a guess, it has asked them only in its plan: no card
			// crowds the conversation.
			expect(
				view.queryByRole("region", { name: "questions for you" }),
			).toBeNull();
			await act(async () => fireEvent.click(questionsButton(view)));
			const plan = await waitFor(() =>
				view.getByRole("dialog", { name: "alpha" }),
			);
			expect(plan.textContent).toContain("How many retries?");
			expect(
				within(plan).queryByRole("textbox", { name: "Answer to 1" }),
			).toBeNull();
		});

		it("passes over an agent asking only in its plan as it works on ⌥⌘M, though not one stopped on its questions", async () => {
			const plan = PLAN.replace(
				"- [ ] 1. How many retries?",
				"- [ ] 3. Cap at three?",
			);
			const view = await sidebar(
				newestFirst([
					conversation({
						id: "c1",
						task: "alpha",
						status: "running",
						messages: [message("user", "cap the retries")],
					}),
					conversation({
						id: "c2",
						task: "beta",
						messages: [message("user", "fix the header")],
					}),
				]),
				[details({ task: "alpha", plan }), details({ task: "beta", plan })],
			);
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);

			expect(location.hash).toBe("#conversations/c2");
			expect(view.queryByRole("dialog")).toBeNull();
			expect(
				view.getByRole("button", { name: /waiting on you/ }).textContent,
			).toContain("1 waiting on you");
		});

		it("goes on ⌥⌘M to the question an external agent asks as it works, on its card", async () => {
			const view = await sidebar(
				[conversation({ id: "c1", title: "Idle" })],
				[details({ task: "alpha", plan: PLAN })],
			);
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);

			expect(location.hash).toBe("#conversations/task/alpha");
			await waitFor(() =>
				expect(
					view
						.getByRole("region", { name: "questions for you" })
						.contains(document.activeElement),
				).toBe(true),
			);
		});

		it("counts only the open questions a reply to a card left unanswered, going to the card that asks them", async () => {
			const blocked = `${PLAN}- [ ] 2. Should it wrap?\n`;
			const asked = message(
				"agent",
				"1. How many retries?\n2. Should it wrap?",
			);
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						title: "Asked",
						messages: [message("user", "cap retries"), asked],
					}),
				],
				[details({ task: "alpha", plan: blocked })],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			// The card the thread ends on asks them all: its action goes there.
			await act(async () => fireEvent.click(questionsButton(view)));
			expect(view.queryByRole("dialog")).toBeNull();
			expect(
				view
					.getByRole("region", { name: "questions for you" })
					.contains(document.activeElement),
			).toBe(true);

			await testing.say(
				conversation({
					id: "c1",
					task: "alpha",
					title: "Asked",
					status: "running",
					messages: [
						message("user", "cap retries"),
						asked,
						message("user", "1. three"),
						message("agent", "Capping them."),
					],
				}),
			);

			await waitFor(() => view.getByText("Capping them."));
			// The one answered waits on the agent, not on you.
			expect(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /1 open question/ },
				),
			).toBeTruthy();
		});

		it("goes to an escalation that did not list the open questions", async () => {
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						title: "Stuck",
						messages: [
							message(
								"agent",
								"## ⚠️ Escalated alpha: needs a call\n\nIt caps.",
							),
						],
					}),
				],
				[
					details({
						task: "alpha",
						status: "escalated",
						escalation: "needs a call",
						escalatedAt: "2026-10-11T10:00:00.000Z",
						plan: PLAN,
					}),
				],
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Claude alpha" })),
			);
			await act(async () =>
				fireEvent.click(
					within(view.getByRole("navigation", { name: "actions" })).getByRole(
						"button",
						{ name: /1 open question/ },
					),
				),
			);

			expect(view.queryByRole("dialog")).toBeNull();
			expect(
				view.getByRole("region", { name: "escalated alpha" }),
			).toBeTruthy();
		});

		it("goes on ⌥⌘M to what the agent asks as it works", async () => {
			const view = await sidebar(
				[
					conversation({
						id: "c1",
						task: "alpha",
						status: "running",
						messages: [message("user", "cap the retries")],
						ask,
					}),
				],
				[details({ task: "alpha", plan: PLAN })],
			);
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);

			expect(location.hash).toBe("#conversations/c1");
			await waitFor(() =>
				expect(
					view
						.getByRole("generic", { name: "permission" })
						.contains(document.activeElement),
				).toBe(true),
			);
			expect(view.queryByRole("dialog")).toBeNull();
		});

		it("counts the agents waiting on you on the tab and in the title", async () => {
			const view = await sidebar(
				[conversation({ id: "c1", title: "Asks", status: "running", ask })],
				[details({ task: "beta", status: "escalated" })],
			);

			expect(view.getByRole("tab", { name: /Conversations/ }).textContent).toBe(
				"Conversations2 waiting on you",
			);
			expect(document.title).toBe("(2) webappwiz");
		});

		it("moves between rows with the arrow keys, and opens the next one waiting with ⌥⌘M", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Runs", status: "running" }),
					conversation({ id: "c2", title: "Asks", status: "running", ask }),
					conversation({ id: "c3", title: "Broke", status: "failed" }),
				]),
			);
			const nav = view.getByRole("navigation", { name: "conversations" });
			const runs = within(nav).getByRole("button", {
				name: "Claude Runs",
			});
			runs.focus();

			await act(async () => fireEvent.keyDown(runs, { key: "ArrowDown" }));
			expect(document.activeElement?.textContent).toBe("Asks");
			// Alt+N alone types a tilde on a Mac, so it opens nothing.
			const before = location.hash;
			await act(async () =>
				fireEvent.keyDown(document.body, { altKey: true, code: "KeyN" }),
			);
			expect(location.hash).toBe(before);
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);
			expect(location.hash).toBe("#conversations/c2");
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);
			expect(location.hash).toBe("#conversations/c3");
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);
			expect(location.hash).toBe("#conversations/c2");
		});

		it("opens merged conversations with ⌥⌘M once none waits on you, then unread ones", async () => {
			const merged = (id: string) =>
				conversation({
					id,
					title: id,
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				});
			await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Unread", unread: true }),
					merged("c2"),
					conversation({ id: "c3", title: "Asks", status: "running", ask }),
					merged("c4"),
				]),
			);
			const press = () =>
				act(async () =>
					fireEvent.keyDown(document.body, {
						altKey: true,
						metaKey: true,
						code: "KeyM",
					}),
				);
			await press();
			expect(location.hash).toBe("#conversations/c3");
			// The one asking still comes first, from wherever you are.
			await press();
			expect(location.hash).toBe("#conversations/c3");
		});

		it("goes round the merged conversations with ⌥⌘M, then the unread ones", async () => {
			const merged = (id: string) =>
				conversation({
					id,
					title: id,
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				});
			await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Unread", unread: true }),
					merged("c2"),
					conversation({ id: "c3", title: "Read" }),
					merged("c4"),
				]),
			);
			const press = () =>
				act(async () =>
					fireEvent.keyDown(document.body, {
						altKey: true,
						metaKey: true,
						code: "KeyM",
					}),
				);
			await press();
			const first = location.hash;
			expect(["#conversations/c2", "#conversations/c4"]).toContain(first);
			await press();
			expect(location.hash).not.toBe(first);
			expect(["#conversations/c2", "#conversations/c4"]).toContain(
				location.hash,
			);
		});

		it("opens an unread conversation with ⌥⌘M once none waits on you or merged", async () => {
			await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Read" }),
					conversation({ id: "c2", title: "Unread", unread: true }),
				]),
			);
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);
			expect(location.hash).toBe("#conversations/c2");
		});

		it("counts the agents waiting on you in the sidebar, and lights the line when ⌥⌘M finds none", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "Runs", status: "running" }),
					conversation({ id: "c2", title: "Broke", status: "failed" }),
				]),
			);
			const nav = view.getByRole("navigation", { name: "conversations" });
			// Under New, as ⌥⌘M under ⌥⌘N.
			const line = within(nav).getByRole("button", { name: /waiting on you/ });
			expect(line.previousElementSibling?.textContent).toContain("New");
			expect(line.textContent).toContain("1 waiting on you");

			await act(async () => fireEvent.click(line));
			expect(location.hash).toBe("#conversations/c2");
			expect(line.hasAttribute("data-lit")).toBe(false);

			view.unmount();
			const quiet = await sidebar([
				conversation({ id: "c1", title: "Runs", status: "running" }),
			]);
			const none = quiet.getByRole("button", { name: /waiting on you/ });
			expect(none.textContent).toContain("Nothing waiting on you");
			const before = location.hash;
			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyM",
				}),
			);
			expect(location.hash).toBe(before);
			expect(none.hasAttribute("data-lit")).toBe(true);
		});

		it("shows each key while ⌥⌘ is held, and opens a row with ⌥⌘ and its digit", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "First" }),
					conversation({ id: "c2", title: "Second" }),
				]),
				[details({ task: "beta", status: "escalated" })],
			);
			const nav = view.getByRole("navigation", { name: "conversations" });
			const keys = () =>
				[...nav.querySelectorAll("kbd")].map((each) => each.textContent);
			expect(keys()).toEqual([]);

			await act(async () =>
				fireEvent.keyDown(window, { key: "Alt", altKey: true, metaKey: true }),
			);
			expect(keys()).toEqual(["N", "M", "0", "1", "2"]);
			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "Digit1",
					altKey: true,
					metaKey: true,
				}),
			);
			expect(location.hash).toBe("#conversations/c2");
			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "Digit2",
					altKey: true,
					ctrlKey: true,
				}),
			);
			expect(location.hash).toBe("#conversations/task/beta");

			await act(async () =>
				fireEvent.keyUp(window, { key: "Alt", metaKey: true }),
			);
			expect(keys()).toEqual([]);
		});

		it("opens the row below with ⌥⌘] and the one above with ⌥⌘[, round past either end", async () => {
			await sidebar(
				newestFirst([
					conversation({ id: "c1", title: "First" }),
					conversation({ id: "c2", title: "Second" }),
				]),
				[details({ task: "beta", status: "escalated" })],
			);
			const press = (code: string) =>
				act(async () =>
					fireEvent.keyDown(document.body, {
						code,
						altKey: true,
						metaKey: true,
					}),
				);
			await press("BracketRight");
			expect(location.hash).toBe("#conversations/c1");
			await press("BracketRight");
			expect(location.hash).toBe("#conversations/c2");
			await press("BracketRight");
			expect(location.hash).toBe("#conversations/task/beta");
			await press("BracketRight");
			expect(location.hash).toBe("#conversations/c1");
			await press("BracketLeft");
			expect(location.hash).toBe("#conversations/task/beta");
		});

		it("opens Todos with ⌥⌘T and Checkpoint with ⌥⌘C, showing a tab's key while ⌥⌘ is held", async () => {
			const view = await sidebar(
				newestFirst([conversation({ id: "c1", title: "First" })]),
			);
			const tab = (name: RegExp) => view.getByRole("tab", { name });
			const key = (name: RegExp) =>
				tab(name).querySelector("kbd")?.textContent ?? null;
			expect(key(/Todos/)).toBeNull();

			await act(async () =>
				fireEvent.keyDown(window, { key: "Alt", altKey: true, metaKey: true }),
			);
			expect(key(/Todos/)).toBe("T");
			expect(key(/Conversations/)).toBeNull();
			expect(key(/Tasks/)).toBeNull();

			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "KeyT",
					altKey: true,
					metaKey: true,
				}),
			);
			expect(tab(/Todos/).getAttribute("aria-selected")).toBe("true");
			await act(async () =>
				fireEvent.keyUp(window, { key: "Alt", metaKey: true }),
			);
			expect(key(/Todos/)).toBeNull();

			await act(async () =>
				fireEvent.keyDown(document.body, {
					code: "KeyC",
					altKey: true,
					ctrlKey: true,
				}),
			);
			expect(
				await waitFor(() => view.getByRole("dialog", { name: /Checkpoint/ })),
			).toBeTruthy();
		});

		it("starts a new conversation with ⌥⌘N, with the agent and model the last one started with", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({
						id: "c1",
						agent: "codex",
						title: "Latest",
						settings: [
							{
								id: "model",
								name: "Model",
								type: "select",
								category: "model",
								current: "small",
								options: [
									{ value: "big", name: "Big", description: null },
									{ value: "small", name: "Small", description: null },
								],
							},
						],
					}),
					conversation({ id: "c2", title: "Earlier", status: "running", ask }),
				]),
			);

			await act(async () =>
				fireEvent.keyDown(document.body, {
					altKey: true,
					metaKey: true,
					code: "KeyN",
				}),
			);
			expect(location.hash).toBe("#conversations/new");
			expect(
				within(
					view.getByText("Start a conversation with")
						.parentElement as HTMLElement,
				).getByLabelText("Codex"),
			).toBeTruthy();
			expect(
				view.getByRole("combobox", { name: "model" }).textContent,
			).toContain("Small");
		});

		it("shows ⌥⌘N in the New menu beside the agent it starts", async () => {
			const view = await sidebar(
				newestFirst([
					conversation({ id: "c1", agent: "codex", title: "Latest" }),
					conversation({ id: "c2", title: "Earlier" }),
				]),
			);

			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "New" })),
			);
			const item = (name: string) =>
				waitFor(() => view.getByRole("menuitem", { name: new RegExp(name) }));
			expect((await item("Codex")).textContent).toContain("⌥⌘N");
			expect((await item("Claude")).textContent).not.toContain("⌥⌘N");
		});

		it("focuses the composer of the agent picked from New, the one shown too", async () => {
			const view = await sidebar([conversation({ id: "c1", title: "Latest" })]);
			const composer = () =>
				within(
					view.getByRole("region", { name: "new conversation" }),
				).getByRole("textbox", { name: "Message input" });

			for (const agent of ["Codex", "Codex"]) {
				view.getByRole("button", { name: "New" }).focus();
				await newWith(view, agent);
				// Not `toBe` the element, whose printout on a failure overwhelms Bun.
				expect(document.activeElement === composer()).toBe(true);
				expect(
					within(
						view.getByText("Start a conversation with")
							.parentElement as HTMLElement,
					).getByLabelText(agent),
				).toBeTruthy();
			}
		});
	});
});

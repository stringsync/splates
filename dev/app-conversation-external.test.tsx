import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's external agents", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

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

	it("lists what a task outside the page assumed, copying a challenge to paste into its session", async () => {
		const view = await testing.openConversations([], null, {
			tasks: [
				details({
					task: "gamma",
					plan: "# gamma\n\n## Assumptions\n\n- [ ] 1. How many retries?\n  - (a) Three (chosen)\n  - (b) Five\n",
				}),
			],
		});
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: /gamma/ }),
			),
		);
		const card = within(view.getByRole("region", { name: "gamma" })).getByRole(
			"region",
			{ name: "assumptions" },
		);
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: "Challenge assumption 1" }),
			),
		);
		// All of them at once, in a dialog, the one clicked first in view.
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(
			within(dialog)
				.getByRole("button", { name: /Three/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: /Five/ })),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Copy challenges" }),
			),
		);

		expect(copied).toEqual(["> **How many retries?**\n\n- (b) Five"]);
		// Kept, to copy again until its agent records it.
		expect(within(dialog).getByRole("button", { name: "Copied" })).toBeTruthy();
	});

	const rows = (view: ConversationsView) =>
		within(view.getByRole("navigation", { name: "conversations" }))
			.getAllByRole("listitem")
			.map((row) => [
				row.textContent,
				within(row).queryByRole("status")?.getAttribute("aria-label") ?? null,
			]);

	it("lists a task whose agent runs outside the page as working elsewhere, waiting once it escalates, and opens it alone with its questions, not its plan", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
			null,
			{
				tasks: [
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
			},
		);

		expect(rows(view)).toEqual([
			["alpha", null],
			["beta", "working elsewhere"],
			["gamma", "waiting on you"],
		]);
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: /gamma/ }),
			),
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
		expect(within(alone).getByRole("button", { name: "Copied" })).toBeTruthy();
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
		const view = await testing.openConversations([], null, {
			tasks: [
				details({
					task: "beta",
					systems: [{ name: "uploads", globs: ["src/upload/**"] }],
				}),
			],
		});
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: /beta/ }),
			),
		);

		const alone = view.getByRole("region", { name: "beta" });
		expect(
			within(alone).getByRole("region", { name: "systems" }).textContent,
		).toContain("uploads");
		expect(within(alone).getByRole("button", { name: "Systems" })).toBeTruthy();
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
		const open = (view: ConversationsView) =>
			act(async () =>
				fireEvent.click(
					within(
						view.getByRole("navigation", { name: "conversations" }),
					).getByRole("button", { name: /gamma/ }),
				),
			);
		const opened = async (plan: string) => {
			const view = await testing.openConversations([], null, {
				tasks: [gamma(plan)],
			});
			await open(view);
			return view;
		};
		const answer = (view: ConversationsView) =>
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

		let view = await testing.openConversations([], null, {
			tasks: [gamma(PLAN)],
		});
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
		view = await testing.openConversations([], null, { tasks: [gamma(asked)] });
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
		const view = await testing.openConversations([], null, {
			tasks: [details({ task: "beta" })],
		});
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: /beta/ }),
			),
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
		const view = await testing.openConversations([], null, {
			tasks: [details({ task: "beta" })],
		});
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: /beta/ }),
			),
		);

		await waitFor(() =>
			expect(
				view.getByRole("region", { name: "sessions" }).textContent,
			).toContain("None the page could bring in."),
		);
	});
});

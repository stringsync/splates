// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "../../../setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { OpenQuestion } from "../inbox";
import type { Entry } from "../journal";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";

// Loaded only once the DOM above is in place. Static imports are evaluated
// before this file's own `setup` import has registered it, and react-dom
// decides at load time whether the browser has `input` events: loaded too
// early, it concludes it does not, and no `onChange` ever fires.
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
	"@testing-library/react"
);
const { App } = await import("./app");

/**
 * The page never touches arbor: it reads a `Snapshot` the server already
 * assembled and posts to two routes. So the fake is the snapshot and a record
 * of the posts, and none of these tests need a repo, a worktree or the CLI.
 * `dev.test.ts` covers the half that does.
 */
let served: Snapshot;
/** Set to fail the next fetch, standing in for a server that went away. */
let down: boolean;
/** Every write the page made, in order. */
let posts: { path: string; body: BodyInit | null | undefined }[];
/** Set to refuse the next write the way the server would. */
let refusal: { reason: string; message: string } | null;
/** The stream the page opened, so a test can push through it. */
let stream: FakeEventSource | null;

/** As much of `EventSource` as `Feed` uses: three handlers and a close. */
class FakeEventSource {
	onmessage: (() => void) | null = null;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor() {
		stream = this;
	}

	close(): void {}
}

const realFetch = globalThis.fetch;
const realEventSource = globalThis.EventSource;

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		repo: "webappwiz",
		todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
		inbox: { questions: [], replied: 0 },
		todos: [],
		tasks: [],
		entries: [],
		...overrides,
	};
}

beforeEach(() => {
	served = snapshot();
	down = false;
	posts = [];
	refusal = null;
	stream = null;
	globalThis.fetch = (async (path: string, init?: RequestInit) => {
		if (down) {
			throw new Error("no server");
		}
		if (init?.method === "POST") {
			posts.push({ path, body: init.body });
			if (refusal) {
				return Response.json(refusal, { status: 409 });
			}
			return Response.json({});
		}
		return Response.json(served);
	}) as unknown as typeof fetch;
	globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
});

afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
	globalThis.EventSource = realEventSource;
});

function question(overrides: Partial<OpenQuestion> = {}): OpenQuestion {
	return {
		task: "alpha",
		status: "escalated",
		lease: "none",
		number: "Q1",
		done: false,
		text: "🎨 Does the header wrap?",
		body: "",
		reply: null,
		choices: [],
		pick: null,
		chosen: [],
		images: [],
		...overrides,
	};
}

function details(overrides: Partial<Details> = {}): Details {
	return {
		task: "alpha",
		status: "working",
		branch: "task/alpha",
		base: "main",
		worktree: "/tmp/repo-arbor/alpha",
		lease: "none",
		ahead: 1,
		added: 2,
		removed: 1,
		age: "3m",
		escalation: null,
		plan: null,
		planProblems: [],
		...overrides,
	};
}

function todo(overrides: Partial<TodoState> = {}): TodoState {
	return {
		id: 1,
		text: "retry the upload",
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		...overrides,
	};
}

function entry(overrides: Partial<Entry> = {}): Entry {
	return {
		at: new Date(Date.now() - 3 * 60_000).toISOString(),
		action: "add",
		task: "alpha",
		reason: null,
		...overrides,
	};
}

/** Renders the page with a snapshot already waiting, and lets it arrive. */
async function open(overrides: Partial<Snapshot> = {}) {
	served = snapshot(overrides);
	const view = render(<App />);
	await waitFor(() =>
		expect(view.getByRole("tab", { name: /inbox/i })).toBeTruthy(),
	);
	return view;
}

async function tab(view: Awaited<ReturnType<typeof open>>, name: RegExp) {
	await act(async () => fireEvent.click(view.getByRole("tab", { name })));
}

describe("inbox", () => {
	it("says so when nothing needs you", async () => {
		const view = await open();

		expect(view.getByText("Nothing needs you")).toBeTruthy();
	});

	it("lists each open question under its task, and counts them in the tab", async () => {
		const view = await open({
			inbox: {
				questions: [
					question({ task: "alpha", number: "Q1", text: "first" }),
					question({ task: "beta", number: "Q4", text: "second" }),
				],
				replied: 0,
			},
		});

		expect(
			within(view.getByRole("region", { name: "alpha" })).getByText("first"),
		).toBeTruthy();
		expect(
			within(view.getByRole("region", { name: "beta" })).getByText("second"),
		).toBeTruthy();
		expect(view.getByRole("tab", { name: /inbox/i }).textContent).toContain(
			"2",
		);
		expect(document.title).toBe("(2) webappwiz");
	});

	it("hides a question once replied, until asked to show those", async () => {
		const view = await open({
			inbox: {
				questions: [
					question({ number: "Q1", text: "waiting" }),
					question({ number: "Q2", text: "answered", reply: "yes" }),
				],
				replied: 1,
			},
		});

		expect(view.queryByText("answered")).toBeNull();
		expect(view.getByRole("tab", { name: /inbox/i }).textContent).toContain(
			"1",
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "show replied" })),
		);

		expect(view.getByText("answered")).toBeTruthy();
		expect(view.getByRole("img", { name: "replied" })).toBeTruthy();
	});

	it("starts from the reply already sent, to change or add to it", async () => {
		const view = await open({
			inbox: {
				questions: [
					question({
						reply: "b (Slack): and log it",
						choices: [
							{ key: "a", text: "Email" },
							{ key: "b", text: "Slack" },
						],
						pick: "any",
						chosen: ["b"],
					}),
				],
				replied: 1,
			},
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "show replied" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Q1/ })),
		);

		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "reply" }),
		);
		expect((box as HTMLTextAreaElement).value).toBe("and log it");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Email/ })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Update" })),
		);

		await waitFor(() => expect(posts).toHaveLength(1));
		const form = posts[0]?.body as FormData;
		expect(form.getAll("choice").sort()).toEqual(["a", "b"]);
		expect(form.get("text")).toBe("and log it");
	});

	it("shows the body, its code and its images, full size on a tap", async () => {
		const view = await open({
			inbox: {
				questions: [
					question({
						body: "Before:\n\n```\nold()\n```\n\n![the header](/tmp/shot.png)",
						images: ["/tmp/shot.png"],
					}),
				],
				replied: 0,
			},
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Q1/ })),
		);

		await waitFor(() =>
			expect(document.querySelector("pre")?.textContent).toBe("old()"),
		);
		const [thumbnail] = await waitFor(() =>
			view.getAllByRole("img", { name: "the header" }),
		);
		expect(thumbnail?.getAttribute("src")).toBe(
			"/api/image?task=alpha&path=%2Ftmp%2Fshot.png",
		);
		await act(async () =>
			fireEvent.click(thumbnail?.closest("button") as HTMLElement),
		);
		// The full-size one, over the thumbnail now inert beneath it.
		await waitFor(() =>
			expect(
				view.getAllByRole("img", { name: "the header", hidden: true }),
			).toHaveLength(2),
		);
		expect(view.getAllByRole("img", { name: "the header" })).toHaveLength(1);
	});

	it("opens the task over the question, which stays open under it", async () => {
		const view = await open({
			inbox: { questions: [question()], replied: 0 },
			tasks: [details({ plan: "# alpha\n\n## Goal\n\nThe goal here." })],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Q1/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Task" })),
			),
		);

		await waitFor(() =>
			expect(document.body.textContent).toContain("The goal here."),
		);
		// Still there under the task, only inert while the task is on top.
		expect(
			view.getByRole("textbox", { name: "reply", hidden: true }),
		).toBeTruthy();
	});

	it("sends a reply to the question opened", async () => {
		const view = await open({
			inbox: { questions: [question()], replied: 0 },
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Q1/ })),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "reply" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "fail: it clips" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);

		await waitFor(() => expect(posts).toHaveLength(1));
		expect(posts[0]?.path).toBe("/api/reply");
		const form = posts[0]?.body as FormData;
		expect(form.get("task")).toBe("alpha");
		expect(form.get("question")).toBe("Q1");
		expect(form.get("text")).toBe("fail: it clips");
	});

	it("picks one choice or none, with words or without", async () => {
		const view = await open({
			inbox: {
				questions: [
					question({
						text: "How do old sessions move over?",
						choices: [
							{ key: "a", text: "Sign in again" },
							{ key: "b", text: "Migrate on next login" },
						],
						pick: "one",
					}),
				],
				replied: 0,
			},
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Q1/ })),
		);
		const send = await waitFor(() =>
			view.getByRole("button", { name: "Send" }),
		);
		expect((send as HTMLButtonElement).disabled).toBe(true);
		// One or none: a second tap unpicks it.
		const migrate = view.getByRole("button", { name: /Migrate/ });
		await act(async () => fireEvent.click(migrate));
		expect((send as HTMLButtonElement).disabled).toBe(false);
		await act(async () => fireEvent.click(migrate));
		expect((send as HTMLButtonElement).disabled).toBe(true);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Sign in/ })),
		);
		await act(async () => fireEvent.click(migrate));
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "reply" }), {
				target: { value: "email them first" },
			}),
		);
		await act(async () => fireEvent.click(send));

		await waitFor(() => expect(posts).toHaveLength(1));
		const form = posts[0]?.body as FormData;
		expect(form.getAll("choice")).toEqual(["b"]);
		expect(form.get("text")).toBe("email them first");
	});

	it("shows why a reply was refused", async () => {
		refusal = { reason: "lease_held", message: "an agent holds 'alpha'" };
		const view = await open({
			inbox: { questions: [question()], replied: 0 },
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Q1/ })),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "reply" }),
		);
		await act(async () => fireEvent.change(box, { target: { value: "pass" } }));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);

		await waitFor(() =>
			expect(document.body.textContent).toContain("an agent holds 'alpha'"),
		);
	});

	it("sends a live session's question to its chat instead", async () => {
		const view = await open({
			inbox: { questions: [question({ lease: "held" })], replied: 0 },
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Q1/ })),
		);

		await waitFor(() =>
			expect(document.body.textContent).toContain("Answer it in that chat"),
		);
		expect(view.queryByRole("textbox", { name: "reply" })).toBeNull();
	});
});

describe("todos", () => {
	it("lists todos with where they came from, and calls old ones stale", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, text: "fresh", from: "alpha" }),
				todo({ id: 2, text: "ancient", createdAt: "2020-01-01T00:00:00Z" }),
				todo({ id: 3, text: "taken", takenBy: "beta" }),
			],
		});

		await tab(view, /todos/i);

		expect(document.body.textContent).toContain("from alpha");
		expect(document.body.textContent).toContain("stale");
		expect(document.body.textContent).toContain("taken by beta");
	});

	it("adds one", async () => {
		const view = await open();
		await tab(view, /todos/i);

		const input = view.getByRole("textbox", { name: "new todo" });
		await act(async () =>
			fireEvent.change(input, { target: { value: "write the docs" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add" })),
		);

		await waitFor(() => expect(posts).toHaveLength(1));
		expect(posts[0]?.path).toBe("/api/todos");
		expect(JSON.parse(String(posts[0]?.body))).toEqual({
			text: "write the docs",
		});
	});
});

describe("tasks", () => {
	it("flags only the statuses that are news, and opens a task's plan", async () => {
		const view = await open({
			tasks: [
				details({ task: "alpha" }),
				details({
					task: "beta",
					status: "escalated",
					escalation: "needs eyes",
					plan: "# beta\n\n## Goal\n\nship the thing\n",
				}),
			],
		});
		await tab(view, /tasks/i);

		expect(view.queryByText("working")).toBeNull();
		expect(view.getByText("escalated")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /beta/ })),
		);

		await waitFor(() =>
			expect(document.body.textContent).toContain("ship the thing"),
		);
		expect(document.body.textContent).toContain("needs eyes");
	});
});

describe("log", () => {
	it("shows the newest first and says only when something failed", async () => {
		const view = await open({
			entries: [
				entry({ action: "add" }),
				entry({ action: "merge", reason: "tests_failed" }),
			],
		});
		await tab(view, /log/i);

		const items = view.getAllByRole("listitem");
		expect(items[0]?.textContent).toContain("merge");
		expect(items[0]?.textContent).toContain("tests_failed");
		expect(items[1]?.textContent).not.toContain("ok");
	});
});

describe("feed", () => {
	it("refetches when the server says something moved", async () => {
		const view = await open();

		served = snapshot({
			inbox: { questions: [question({ text: "new one" })], replied: 0 },
		});
		await act(async () => stream?.onmessage?.());

		await waitFor(() => expect(view.getByText(/new one/)).toBeTruthy());
	});

	it("says it is offline when the server goes away", async () => {
		const view = await open();
		expect(view.queryByRole("status")).toBeNull();

		down = true;
		await act(async () => stream?.onmessage?.());

		await waitFor(() => expect(view.getByText(/Offline/)).toBeTruthy());
	});
});

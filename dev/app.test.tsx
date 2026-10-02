// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "../../../setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Blocker } from "../blocked";
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
let posts: {
	path: string;
	method: string;
	body: BodyInit | null | undefined;
}[];
/** Set to refuse the next write the way the server would. */
let refusal: { reason: string; message: string } | null;
/** What `/api/paths` lists, for `@`. */
let tree: string[];
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
		blocked: [],
		todos: [],
		tasks: [],
		...overrides,
	};
}

beforeEach(() => {
	served = snapshot();
	tree = [];
	down = false;
	posts = [];
	refusal = null;
	stream = null;
	globalThis.fetch = (async (path: string, init?: RequestInit) => {
		if (down) {
			throw new Error("no server");
		}
		if (init?.method !== undefined && init.method !== "GET") {
			posts.push({ path, method: init.method, body: init.body });
			if (refusal) {
				return Response.json(refusal, { status: 409 });
			}
			return Response.json({});
		}
		if (path.startsWith("/api/paths")) {
			return Response.json(tree);
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

function question(overrides: Partial<Blocker> = {}): Blocker {
	return {
		task: "alpha",
		number: "1",
		done: false,
		text: "🎨 Does the header wrap?",
		body: "",
		reply: null,
		followUps: [],
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
		review: null,
		plan: null,
		planProblems: [],
		...overrides,
	};
}

function todo(overrides: Partial<TodoState> = {}): TodoState {
	return {
		id: 1,
		subject: "retry the upload",
		text: "",
		position: 1,
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		files: [],
		...overrides,
	};
}

/**
 * Renders the page with a snapshot already waiting, and lets it arrive. Each
 * task a question names is there too, unless the tasks are given.
 */
async function open(overrides: Partial<Snapshot> = {}) {
	const named = [...new Set((overrides.blocked ?? []).map(({ task }) => task))];
	served = snapshot({
		tasks: named.map((task) => details({ task })),
		...overrides,
	});
	const view = render(<App />);
	await waitFor(() =>
		expect(view.getByRole("tab", { name: /blocked/i })).toBeTruthy(),
	);
	return view;
}

async function tab(view: Awaited<ReturnType<typeof open>>, name: RegExp) {
	await act(async () => fireEvent.click(view.getByRole("tab", { name })));
}

describe("blocked", () => {
	it("says so when nothing needs you", async () => {
		const view = await open();

		expect(view.getByText("Nothing needs you")).toBeTruthy();
	});

	it("lists each open question under its task, and counts them in the tab", async () => {
		const view = await open({
			blocked: [
				question({ task: "alpha", number: "1", text: "first" }),
				question({ task: "beta", number: "4", text: "second" }),
			],
		});

		expect(
			within(view.getByRole("region", { name: "alpha" })).getByText("first"),
		).toBeTruthy();
		expect(
			within(view.getByRole("region", { name: "beta" })).getByText("second"),
		).toBeTruthy();
		expect(view.getByRole("tab", { name: /blocked/i }).textContent).toContain(
			"2",
		);
		expect(document.title).toBe("(2) webappwiz");
	});

	it("shows the body, its code and its images, full size on a tap", async () => {
		const view = await open({
			blocked: [
				question({
					body: "Before:\n\n```\nold()\n```\n\n![the header](/tmp/shot.png)",
					images: ["/tmp/shot.png"],
				}),
			],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^1/ })),
		);

		await waitFor(() =>
			expect(document.querySelector("pre")?.textContent).toBe("old()"),
		);
		const [thumbnail] = await waitFor(() =>
			view.getAllByRole("img", { name: "the header" }),
		);
		expect(thumbnail?.getAttribute("src")).toBe(
			"/api/file?task=alpha&path=%2Ftmp%2Fshot.png",
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

	it("opens a question's task over it, and nowhere else in the list", async () => {
		const view = await open({
			blocked: [question()],
			tasks: [details({ plan: "# alpha\n\n## Goal\n\nThe goal here." })],
		});

		expect(view.queryByRole("button", { name: /View/ })).toBeNull();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^1/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "View" })),
			),
		);
		await waitFor(() =>
			expect(document.body.textContent).toContain("The goal here."),
		);
		// Both rise from the bottom, the task over the question still open under it.
		expect(document.querySelectorAll('[data-side="bottom"]')).toHaveLength(2);
		expect(
			view.getByRole("textbox", { name: "message", hidden: true }),
		).toBeTruthy();
	});

	it("opens the next question on J, down the list and around", async () => {
		const view = await open({
			blocked: [
				question(),
				question({ number: "2", text: "Which font?" }),
				question({ task: "beta", text: "Ship it?" }),
			],
		});
		const heading = () =>
			within(view.getByRole("dialog")).getByRole("heading").textContent;

		expect(view.getByText("opens the next question")).toBeTruthy();
		for (const expected of [
			"Does the header wrap?",
			"Which font?",
			"Ship it?",
			"Does the header wrap?",
		]) {
			await act(async () => fireEvent.keyDown(document.body, { key: "j" }));
			await waitFor(() => expect(heading()).toContain(expected));
		}

		// Written into the reply box, a J is just a letter.
		const box = view.getByRole("textbox", { name: "message" });
		await act(async () => fireEvent.keyDown(box, { key: "j" }));
		expect(heading()).toContain("Does the header wrap?");
	});

	it("sends a reply to the question opened", async () => {
		const view = await open({
			blocked: [question()],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^1/ })),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "message" }),
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
		expect(form.get("question")).toBe("1");
		expect(form.get("text")).toBe("fail: it clips");
	});

	it("picks one choice or none, with words or without", async () => {
		const view = await open({
			blocked: [
				question({
					text: "How do old sessions move over?",
					choices: [
						{ key: "a", text: "Sign in again" },
						{ key: "b", text: "Migrate on next login" },
					],
					pick: "one",
				}),
			],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^1/ })),
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
			fireEvent.change(view.getByRole("textbox", { name: "message" }), {
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
		refusal = { reason: "not_escalated", message: "'alpha' is working" };
		const view = await open({
			blocked: [question()],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^1/ })),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "message" }),
		);
		await act(async () => fireEvent.change(box, { target: { value: "pass" } }));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);

		await waitFor(() =>
			expect(document.body.textContent).toContain("'alpha' is working"),
		);
	});
});

describe("defer and skip", () => {
	for (const [label, path] of [
		["Defer", "/api/defer"],
		["Skip", "/api/skip"],
	] as const) {
		it(`${label.toLowerCase()}s a question in a tap`, async () => {
			const view = await open({
				blocked: [question()],
			});
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: /^1/ })),
			);

			await act(async () =>
				fireEvent.click(
					await waitFor(() => view.getByRole("button", { name: label })),
				),
			);

			await waitFor(() =>
				expect(posts.map((post) => post.path)).toEqual([path]),
			);
			expect(JSON.parse(String(posts[0]?.body))).toEqual({
				task: "alpha",
				question: "1",
			});
		});
	}
});

describe("review", () => {
	const reviewing = () =>
		open({
			blocked: [
				question({
					number: "2",
					text: "✅ Ready to merge?",
					body: "Check the header at 390px.",
				}),
			],
			tasks: [details({ status: "escalated", review: "2" })],
		});

	it("opens like any other question, and approves it", async () => {
		const view = await reviewing();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^2/ })),
		);

		await waitFor(() =>
			expect(document.body.textContent).toContain("Check the header at 390px."),
		);
		expect(view.queryByRole("button", { name: "Defer" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve" })),
		);

		await waitFor(() =>
			expect(posts.map((post) => post.path)).toEqual(["/api/approve"]),
		);
		expect(JSON.parse(String(posts[0]?.body))).toEqual({
			task: "alpha",
			question: "2",
		});
	});

	it("says what to change when changes are requested", async () => {
		const view = await reviewing();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^2/ })),
		);

		await act(async () =>
			fireEvent.change(
				await waitFor(() => view.getByRole("textbox", { name: "message" })),
				{ target: { value: "the logo overlaps" } },
			),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Request changes" })),
		);

		await waitFor(() =>
			expect(posts.map((post) => post.path)).toEqual(["/api/reply"]),
		);
		const form = posts[0]?.body as FormData;
		expect(form.get("question")).toBe("2");
		expect(form.get("text")).toBe("the logo overlaps");
	});
});

describe("header", () => {
	it("has no status line: the tab's count says what waits on you", async () => {
		const view = await open({ blocked: [question()] });

		expect(view.queryByLabelText("banner")).toBeNull();
	});
});

describe("@ files", () => {
	/** Opens question 1 and returns its reply box, with the tree's paths loaded. */
	async function replyBox(paths: string[]) {
		tree = paths;
		const view = await open({
			blocked: [question()],
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^1/ })),
		);
		const box = (await waitFor(() =>
			view.getByRole("textbox", { name: "message" }),
		)) as HTMLTextAreaElement;
		return { view, box };
	}

	/** Types `value` as if the caret ended up at its end. */
	async function type(box: HTMLTextAreaElement, value: string) {
		await act(async () => {
			box.focus();
			fireEvent.change(box, { target: { value } });
			box.setSelectionRange(value.length, value.length);
			fireEvent.select(box);
		});
	}

	it("offers the task's files for an @, best match first, and writes the one picked", async () => {
		const { view, box } = await replyBox([
			"src/",
			"src/app.tsx",
			"src/lib/",
			"src/lib/apply.ts",
			"README.md",
		]);

		await type(box, "see @app");

		const options = await waitFor(() => view.getAllByRole("option"));
		expect(options.map((option) => option.textContent)).toEqual([
			"app.tsxsrc/",
			"apply.tssrc/lib/",
		]);
		await act(async () => fireEvent.keyDown(box, { key: "ArrowDown" }));
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(box.value).toBe("see @src/lib/apply.ts ");
		expect(view.queryByRole("listbox")).toBeNull();
		// Enter picked a file; it did not send the reply.
		expect(posts).toEqual([]);
	});

	it("keeps the list open inside a directory picked", async () => {
		const { view, box } = await replyBox(["src/", "src/lib/", "src/lib/a.ts"]);

		await type(box, "@sr");
		await act(async () =>
			fireEvent.mouseDown(view.getByRole("option", { name: /^src\// })),
		);
		expect(box.value).toBe("@src/");
		await type(box, box.value);

		expect(
			view.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["lib/src/", "a.tssrc/lib/"]);
	});

	it("closes the list on Escape, leaving the question open", async () => {
		const { view, box } = await replyBox(["src/app.tsx"]);

		await type(box, "@app");
		await waitFor(() => view.getByRole("listbox"));
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));

		expect(view.queryByRole("listbox")).toBeNull();
		expect(view.getByRole("textbox", { name: "message" })).toBeTruthy();
		expect(box.value).toBe("@app");
	});

	it("ignores an @ inside a word, like an address", async () => {
		const { view, box } = await replyBox(["example.com"]);

		await type(box, "mail me@example");

		expect(view.queryByRole("listbox")).toBeNull();
	});
});

describe("todos", () => {
	it("lists todos as cards, leaving out where they came from, and calls old ones stale", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "fresh", from: "alpha", text: "more" }),
				todo({
					id: 2,
					subject: "ancient",
					position: 2,
					createdAt: "2020-01-01T00:00:00Z",
				}),
				todo({ id: 3, subject: "taken", position: 3, takenBy: "beta" }),
			],
		});

		await tab(view, /todos/i);

		expect(document.body.textContent).not.toContain("alpha");
		expect(document.body.textContent).toContain("stale");
		expect(document.body.textContent).toContain("taken by beta");
		expect(view.getAllByRole("img", { name: "has detail" })).toHaveLength(1);
	});

	it("adds one", async () => {
		const view = await open();
		await tab(view, /todos/i);

		const input = view.getByRole("textbox", { name: "new todo" });
		await act(async () =>
			fireEvent.change(input, { target: { value: "write the docs" } }),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "new todo detail" }), {
				target: { value: "the CLI first" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add" })),
		);

		await waitFor(() => expect(posts).toHaveLength(1));
		expect(posts[0]?.path).toBe("/api/todos");
		const form = posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("write the docs");
		expect(form.get("text")).toBe("the CLI first");
		expect(form.has("position")).toBe(false);
		expect(form.getAll("file")).toEqual([]);
	});
});

describe("todo edits", () => {
	it("rewords one", async () => {
		const view = await open({
			todos: [todo({ id: 4, subject: "write docs", text: "soon" })],
		});
		await tab(view, /todos/i);

		await act(async () => fireEvent.click(view.getByText("write docs")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "detail" }), {
				target: { value: "" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);

		await waitFor(() => expect(posts).toHaveLength(1));
		expect(posts[0]).toMatchObject({ path: "/api/todos/4", method: "PATCH" });
		const form = posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("write the docs");
		expect(form.get("text")).toBe("");
		// Not moved, so no place is sent to undo a move made elsewhere.
		expect(form.has("position")).toBe(false);
	});

	it("moves one up the list by its grip, from the keyboard", async () => {
		// happy-dom lays nothing out, and a drag goes by where things are: stack
		// the cards 50px apart so there is an above and a below.
		const rect = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = function (this: Element) {
			const card = this.closest("li");
			const at = card
				? [...(card.parentElement?.children ?? [])].indexOf(card)
				: 0;
			return DOMRect.fromRect({ x: 0, y: at * 50, width: 300, height: 40 });
		};
		try {
			const view = await open({
				todos: [
					todo({ id: 1, subject: "first" }),
					todo({ id: 4, subject: "second", position: 2 }),
				],
			});
			await tab(view, /todos/i);

			const grip = view.getByRole("button", { name: "move second" });
			grip.focus();
			for (const code of ["Space", "ArrowUp", "Space"]) {
				await act(async () => {
					fireEvent.keyDown(grip, { code });
					await new Promise((settle) => setTimeout(settle, 20));
				});
			}

			await waitFor(() => expect(posts).toHaveLength(1));
			expect(posts[0]?.path).toBe("/api/todos/4/position");
			expect(posts[0]?.method).toBe("PUT");
			expect(JSON.parse(String(posts[0]?.body))).toEqual({ position: 1 });
			// Where it was let go, before the server says so.
			expect(
				within(view.getByRole("list", { name: "todos" }))
					.getAllByRole("listitem")
					.map((card) => card.textContent),
			).toEqual([
				expect.stringContaining("second"),
				expect.stringContaining("first"),
			]);
		} finally {
			Element.prototype.getBoundingClientRect = rect;
		}
	});

	it("drops a file attached to one", async () => {
		const view = await open({
			todos: [
				todo({
					id: 4,
					subject: "fix the chart",
					files: [
						"/repo/.git/arbor/todos/4/0-a.png",
						"/repo/.git/arbor/todos/4/1-b.log",
					],
				}),
			],
		});
		await tab(view, /todos/i);
		expect(document.body.textContent).toContain("2 files");

		await act(async () => fireEvent.click(view.getByText("fix the chart")));
		const save = await waitFor(() =>
			view.getByRole("button", { name: "Save" }),
		);
		expect((save as HTMLButtonElement).disabled).toBe(true);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "remove b.log" })),
		);
		await act(async () => fireEvent.click(save));

		await waitFor(() => expect(posts).toHaveLength(1));
		expect((posts[0]?.body as FormData | undefined)?.getAll("keep")).toEqual([
			"/repo/.git/arbor/todos/4/0-a.png",
		]);
	});

	it("removes one, asking twice", async () => {
		const view = await open({
			todos: [todo({ id: 4, subject: "write docs" })],
		});
		await tab(view, /todos/i);

		await act(async () => fireEvent.click(view.getByText("write docs")));
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Remove" })),
			),
		);
		expect(posts).toHaveLength(0);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove for good" })),
		);

		await waitFor(() => expect(posts).toHaveLength(1));
		expect(posts[0]).toMatchObject({ path: "/api/todos/4", method: "DELETE" });
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

describe("nav", () => {
	/** happy-dom answers media queries against this, 1024 wide to start. */
	const resize = (width: number) =>
		(
			window as unknown as {
				happyDOM: { setViewport(size: { width: number }): void };
			}
		).happyDOM.setViewport({ width });
	afterEach(() => resize(1024));

	/** Which way the tabs run, from the root that decides it. */
	const orientation = (view: Awaited<ReturnType<typeof open>>) =>
		view
			.getByRole("tablist")
			.closest("[data-slot=tabs]")
			?.getAttribute("data-orientation");

	it("runs along the bottom of a phone, and down the side of anything wider", async () => {
		resize(390);
		expect(orientation(await open())).toBe("horizontal");
		cleanup();

		resize(1280);
		const wide = await open();
		expect(orientation(wide)).toBe("vertical");
		await tab(wide, /todos/i);
		expect(wide.getByRole("textbox", { name: "new todo" })).toBeTruthy();
	});
});

describe("feed", () => {
	it("refetches when the server says something moved", async () => {
		const view = await open();

		served = snapshot({
			blocked: [question({ text: "new one" })],
			tasks: [details()],
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

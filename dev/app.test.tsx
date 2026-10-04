// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "../../../setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
 * assembled and writes todos. So the fake is the snapshot and a record
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
		path: "~/Projects/webappwiz",
		todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
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
	stream = null;
	globalThis.fetch = (async (path: string, init?: RequestInit) => {
		if (down) {
			throw new Error("no server");
		}
		if (init?.method !== undefined && init.method !== "GET") {
			posts.push({ path, method: init.method, body: init.body });
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
		tags: [],
		...overrides,
	};
}

/** Renders the page with a snapshot already waiting, and lets it arrive. */
async function open(overrides: Partial<Snapshot> = {}) {
	served = snapshot(overrides);
	const view = render(<App />);
	await waitFor(() =>
		expect(view.getByRole("region", { name: "Todos" })).toBeTruthy(),
	);
	return view;
}

describe("header", () => {
	it("has no status line, and opens on the todos", async () => {
		const view = await open();

		expect(view.queryByLabelText("banner")).toBeNull();
		expect(view.getByRole("textbox", { name: "new todo" })).toBeTruthy();
		expect(view.queryByRole("tab", { name: /blocked/i })).toBeNull();
	});
});

describe("repo", () => {
	it("names the repo, and shows where it sits", async () => {
		const view = await open();

		expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
			"webappwiz",
		);
		expect(view.getByText("~/Projects/webappwiz")).toBeTruthy();
	});
});

describe("@ files", () => {
	/** The new todo's box, with the tree's paths loaded. */
	async function todoBox(paths: string[]) {
		tree = paths;
		const view = await open();
		const box = view.getByRole("textbox", {
			name: "new todo",
		}) as HTMLInputElement;
		return { view, box };
	}

	/** Types `value` as if the caret ended up at its end. */
	async function type(box: HTMLInputElement, value: string) {
		await act(async () => {
			box.focus();
			fireEvent.change(box, { target: { value } });
			box.setSelectionRange(value.length, value.length);
			fireEvent.select(box);
		});
	}

	it("offers the repo's files for an @, best match first, and writes the one picked", async () => {
		const { view, box } = await todoBox([
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
		// Enter picked a file; it did not add the todo.
		expect(posts).toEqual([]);
	});

	it("keeps the list open inside a directory picked", async () => {
		const { view, box } = await todoBox(["src/", "src/lib/", "src/lib/a.ts"]);

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

	it("closes the list on Escape, leaving the text as typed", async () => {
		const { view, box } = await todoBox(["src/app.tsx"]);

		await type(box, "@app");
		await waitFor(() => view.getByRole("listbox"));
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));

		expect(view.queryByRole("listbox")).toBeNull();
		expect(box.value).toBe("@app");
	});

	it("ignores an @ inside a word, like an address", async () => {
		const { view, box } = await todoBox(["example.com"]);

		await type(box, "mail me@example");

		expect(view.queryByRole("listbox")).toBeNull();
	});
});

describe("todos", () => {
	it("lists todos as cards with a preview and badges, leaving out where they came from", async () => {
		const view = await open({
			todos: [
				todo({
					id: 1,
					subject: "fresh",
					from: "alpha",
					text: "more to say",
					files: ["/tmp/a.png", "/tmp/b.log"],
				}),
				todo({
					id: 2,
					subject: "ancient",
					position: 2,
					createdAt: "2020-01-01T00:00:00Z",
				}),
				todo({ id: 3, subject: "taken", position: 3, takenBy: "beta" }),
			],
		});

		expect(document.body.textContent).not.toContain("alpha");
		const cards = within(view.getByRole("list", { name: "todos" }))
			.getAllByRole("listitem")
			.map((card) => card.textContent);
		expect(cards[0]).toContain("more to say");
		expect(cards[0]).toContain("#1");
		expect(
			view.getByRole("img", { name: "files" }).parentElement?.textContent,
		).toBe("2");
		expect(view.getAllByRole("img", { name: "stale" })).toHaveLength(1);
		expect(view.getByRole("img", { name: "taken by" })).toBeTruthy();
		expect(cards[2]).toContain("Taken by beta");
	});

	it("copies a link to one, without opening it", async () => {
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		const view = await open({ todos: [todo({ id: 7, subject: "fix it" })] });

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "copy a link to todo 7" }),
			),
		);

		expect(copied).toEqual(["[ARBOR TODO #7]"]);
		expect(view.queryByText("Todo 7")).toBeNull();
		expect(view.getByText("Copied [ARBOR TODO #7]")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "fix it" })),
		);
		// The toast is a dialog too.
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: /Todo 7/ }),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "copy a link to todo 7" }),
			),
		);
		expect(copied).toEqual(["[ARBOR TODO #7]", "[ARBOR TODO #7]"]);
	});

	it("opens the task that took one, without opening the todo", async () => {
		const view = await open({
			todos: [todo({ id: 3, subject: "taken", takenBy: "beta" })],
			tasks: [
				details({
					task: "beta",
					plan: "# beta\n\n## Goal\n\nship the thing\n",
				}),
			],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Taken by beta/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("ship the thing");
		expect(view.queryByText("Todo 3")).toBeNull();
	});

	it("adds one", async () => {
		const view = await open();

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
	it("renders a todo's detail as markdown, on its card and when opened", async () => {
		const view = await open({
			todos: [
				todo({ id: 4, subject: "write docs", text: "start with **the CLI**" }),
			],
		});

		expect(view.getByText("the CLI").tagName).toBe("STRONG");
		await act(async () => fireEvent.click(view.getByText("write docs")));
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByText("the CLI").tagName).toBe("STRONG");
		expect(dialog.textContent).toContain("Markdown supported");
	});

	it("rewords one", async () => {
		const view = await open({
			todos: [todo({ id: 4, subject: "write docs", text: "soon" })],
		});

		await act(async () => fireEvent.click(view.getByText("write docs")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		// A todo with detail opens on its preview.
		expect(view.queryByRole("textbox", { name: "detail" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Write" })),
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

	it("tags one from its dialog", async () => {
		const view = await open({
			todos: [todo({ id: 4, subject: "write docs", tags: ["docs"] })],
		});

		await act(async () => fireEvent.click(view.getByText("write docs")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "tags" }),
		);
		expect((box as HTMLInputElement).value).toBe("docs");
		expect(box.getAttribute("aria-describedby")).toBeTruthy();
		expect(view.getByText("Separate tags with commas.")).toBeTruthy();
		await act(async () =>
			fireEvent.change(box, { target: { value: "docs, dev-page" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);

		await waitFor(() => expect(posts).toHaveLength(1));
		const form = posts[0]?.body as FormData;
		expect(form.get("tags")).toBe("docs,dev-page");
	});

	it("moves one to the top or bottom from its dialog", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2, tags: ["docs"] }),
				todo({ id: 6, subject: "third", position: 3 }),
			],
		});

		// Filtered to one tag, the bottom is still the whole list's.
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "docs" })),
		);
		await act(async () => fireEvent.click(view.getByText("second")));
		let dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Move to bottom" }),
			),
		);
		// Done with it, the way saving is.
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		await act(async () => fireEvent.click(view.getByText("second")));
		dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Move to top" }),
			),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		expect(posts.map((post) => post.path)).toEqual([
			"/api/todos/4/position",
			"/api/todos/4/position",
		]);
		expect(posts.map((post) => JSON.parse(String(post.body)))).toEqual([
			{ position: 3 },
			{ position: 1 },
		]);
	});

	it("opens the top todo and steps through the list from the keyboard", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});
		const subject = () =>
			(view.getByRole("textbox", { name: "subject" }) as HTMLInputElement)
				.value;
		const press = (key: string) =>
			act(async () => fireEvent.keyDown(document.body, { key }));

		await press("o");
		await waitFor(() => expect(subject()).toBe("first"));
		await press("]");
		await waitFor(() => expect(subject()).toBe("second"));
		// Nothing below the bottom one.
		await press("]");
		expect(subject()).toBe("second");
		await press("[");
		await waitFor(() => expect(subject()).toBe("first"));
		// The one dialog all along, showing another todo.
		expect(view.getAllByRole("dialog")).toHaveLength(1);
		// A key typed into a field is only typing.
		await act(async () =>
			fireEvent.keyDown(view.getByRole("textbox", { name: "subject" }), {
				key: "]",
			}),
		);
		expect(subject()).toBe("first");
		expect(posts).toHaveLength(0);
	});

	it("lists the keyboard shortcuts on ?", async () => {
		const view = await open({ todos: [todo({ id: 1, subject: "first" })] });

		await act(async () => fireEvent.keyDown(document.body, { key: "?" }));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Keyboard shortcuts" }),
		);
		expect(dialog.textContent).toContain("Open the top todo");
		// Its own keys stay quiet while it is up.
		await act(async () => fireEvent.keyDown(document.body, { key: "o" }));
		expect(view.queryByRole("textbox", { name: "subject" })).toBeNull();
	});

	it("saves what was typed before stepping to the next todo", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("first")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "first, reworded" } }),
		);
		await act(async () => fireEvent.keyDown(document.body, { key: "]" }));

		await waitFor(() =>
			expect(
				(view.getByRole("textbox", { name: "subject" }) as HTMLInputElement)
					.value,
			).toBe("second"),
		);
		expect(posts).toHaveLength(1);
		expect(posts[0]).toMatchObject({ path: "/api/todos/1", method: "PATCH" });
		const form = posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("first, reworded");
	});

	it("moves the open todo to the top or bottom from the keyboard", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
				todo({ id: 6, subject: "third", position: 3 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("second")));
		await waitFor(() => view.getByRole("dialog"));
		await act(async () => fireEvent.keyDown(document.body, { key: "{" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		await act(async () => fireEvent.click(view.getByText("second")));
		await waitFor(() => view.getByRole("dialog"));
		await act(async () => fireEvent.keyDown(document.body, { key: "}" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		expect(posts.map((post) => JSON.parse(String(post.body)))).toEqual([
			{ position: 1 },
			{ position: 3 },
		]);
	});

	it("saves what was typed along with a move", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("second")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "second, reworded" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Move to top" })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(posts).toHaveLength(1);
		expect(posts[0]).toMatchObject({ path: "/api/todos/4", method: "PATCH" });
		const form = posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("second, reworded");
		expect(form.get("position")).toBe("1");
	});

	it("cannot move the top todo up or the bottom one down", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("first")));
		let dialog = await waitFor(() => view.getByRole("dialog"));
		const top = within(dialog).getByRole("button", { name: "Move to top" });
		expect((top as HTMLButtonElement).disabled).toBe(true);
		await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		await act(async () => fireEvent.click(view.getByText("second")));
		dialog = await waitFor(() => view.getByRole("dialog"));
		const bottom = within(dialog).getByRole("button", {
			name: "Move to bottom",
		});
		expect((bottom as HTMLButtonElement).disabled).toBe(true);
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
		expect(
			view.getByRole("img", { name: "files" }).parentElement?.textContent,
		).toBe("2");

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

		expect(view.queryByText("working")).toBeNull();
		expect(view.queryByRole("progressbar")).toBeNull();
		expect(view.getByText("escalated")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /beta/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("ship the thing");
		expect(dialog.textContent).toContain("needs eyes");
	});

	it("fills a bar with the steps its plan has checked off", async () => {
		const view = await open({
			tasks: [
				details({
					task: "alpha",
					plan: "# alpha\n\n## Done\n\n- [x] one\n\n## Next\n\n- [ ] two\n- [ ] three\n- [ ] four\n",
				}),
			],
		});

		const bar = view.getByRole("progressbar", { name: "progress" });
		expect(bar.getAttribute("aria-valuenow")).toBe("1");
		expect(bar.getAttribute("aria-valuemax")).toBe("4");
		expect(view.getByText("1/4")).toBeTruthy();
	});
});

describe("tags", () => {
	it("filters the list by a tag from the row above it, or from a card", async () => {
		const view = await open({
			todos: [
				todo({ id: 1, subject: "page bug", tags: ["page"] }),
				todo({ id: 2, subject: "merge flake", position: 2, tags: ["merge"] }),
			],
		});
		const filter = view.getByRole("group", { name: "filter by tag" });
		const list = view.getByRole("list", { name: "todos" });

		expect(view.queryByRole("progressbar")).toBeNull();
		await act(async () =>
			fireEvent.click(within(filter).getByRole("button", { name: "page" })),
		);
		expect(within(list).queryByText("merge flake")).toBeNull();
		expect(within(list).getByText("page bug")).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(filter).getByRole("button", { name: "All" })),
		);
		expect(within(list).getByText("merge flake")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "show only merge" })),
		);
		expect(within(list).queryByText("page bug")).toBeNull();
		expect(
			within(filter)
				.getByRole("button", { name: "merge" })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});
});

describe("page", () => {
	it("shows the tasks and the todos together, with no tabs", async () => {
		const view = await open({
			tasks: [details({ task: "alpha" })],
			todos: [todo({ subject: "later" })],
		});

		expect(view.queryByRole("tablist")).toBeNull();
		expect(
			within(view.getByRole("region", { name: "Tasks" })).getByText("alpha"),
		).toBeTruthy();
		expect(
			within(view.getByRole("region", { name: "Todos" })).getByText(/later/),
		).toBeTruthy();
	});
});

describe("feed", () => {
	it("refetches when the server says something moved", async () => {
		const view = await open();

		served = snapshot({
			todos: [todo({ subject: "new one" })],
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

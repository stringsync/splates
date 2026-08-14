import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
// Imported for the side effect, and before anything that touches a global:
// `@webappwiz/react/dom` is what puts a DOM on `globalThis` for React to
// render into.
import "@webappwiz/react/dom";
import type { Entry } from "../journal";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import { App } from "./app";

/**
 * The page never touches arbor: it reads a `Snapshot` the server already
 * assembled. So the fake is the snapshot itself, and none of these tests need a
 * repo, a worktree or the CLI. `dev.test.ts` covers the half that does.
 */
let served: Snapshot;
/** Set to fail the next fetch, standing in for a server that went away. */
let down: boolean;
/** The stream the page opened, so a test can push through it. */
let stream: FakeEventSource | null;

/** As much of `EventSource` as `Feed` uses: three handlers and a close. */
class FakeEventSource {
	onmessage: (() => void) | null = null;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;

	constructor() {
		stream = this;
	}

	close(): void {
		this.closed = true;
	}
}

const realFetch = globalThis.fetch;
const realEventSource = globalThis.EventSource;

beforeEach(() => {
	served = { tasks: [], entries: [] };
	down = false;
	stream = null;
	globalThis.fetch = (async () => {
		if (down) {
			throw new Error("no server");
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

/** A task with nothing notable about it, for a test to bend one field of. */
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
async function open(snapshot: Partial<Snapshot> = {}) {
	served = { tasks: [], entries: [], ...snapshot };
	const view = render(<App />);
	// Waits for the snapshot we served to be the one on screen, card for card.
	// Waiting only for "reading the repo" to go would also be satisfied by a
	// container holding nothing at all, which lets the assertions run against a
	// page that never loaded.
	await waitFor(() => {
		expect(view.container.textContent).not.toContain("reading the repo");
		expect(view.container.querySelectorAll("article")).toHaveLength(
			served.tasks.length,
		);
	});
	return view;
}

/** What the server would push after something moved: a new snapshot, then SSE. */
async function push(snapshot: Partial<Snapshot>): Promise<void> {
	served = { tasks: [], entries: [], ...snapshot };
	await act(async () => stream?.onmessage?.());
}

describe("App", () => {
	it("says it is reading the repo until the first snapshot lands", async () => {
		const { container } = render(<App />);

		expect(container.textContent).toContain("reading the repo");

		// Landed before the test ends, so the update does not arrive into a tree
		// that has already been torn down.
		await waitFor(() => expect(container.textContent).toContain("no tasks"));
	});

	it("lists a card per task", async () => {
		const { container } = await open({
			tasks: [details({ task: "alpha" }), details({ task: "beta" })],
		});

		const cards = [...container.querySelectorAll("article")];

		expect(cards).toHaveLength(2);
		expect(cards[0]?.textContent).toContain("alpha");
		expect(cards[1]?.textContent).toContain("beta");
	});

	it("links the sidebar to the heading of every card", async () => {
		const view = await open({
			tasks: [details({ task: "alpha" }), details({ task: "beta" })],
		});

		const links = [
			...view
				.getByRole("navigation", { name: "contents" })
				.querySelectorAll("a"),
		];

		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"#alpha",
			"#beta",
		]);
		expect(
			[...view.container.querySelectorAll("article h2")].map((heading) =>
				heading.getAttribute("id"),
			),
		).toEqual(["alpha", "beta"]);
	});

	it("draws each task's progress in the sidebar", async () => {
		const view = await open({
			tasks: [details({ plan: "# alpha\n\n## Next\n- [x] one\n- [ ] two\n" })],
		});

		const link = view
			.getByRole("navigation", { name: "contents" })
			.querySelector("a");

		expect(link?.textContent).toContain("alpha");
		expect(link?.textContent).toContain("1/2");
	});

	it("leaves the sidebar out when there are no tasks", async () => {
		const view = await open({ tasks: [] });

		expect(view.queryByRole("navigation", { name: "contents" })).toBeNull();
	});

	it("shows the fields `arbor show` prints for a task", async () => {
		const { container, getByText } = await open({ tasks: [details()] });

		const fields = [...container.querySelectorAll("dd")].map(
			(field) => field.textContent,
		);

		expect(fields).toEqual([
			"task/alpha",
			"main",
			"/tmp/repo-arbor/alpha",
			"none",
			"1",
		]);
		expect(getByText("working")).toBeDefined();
		expect(container.textContent).toContain("+2");
		expect(container.textContent).toContain("-1");
		expect(container.textContent).toContain("3m");
	});

	it("shows a question mark for what git could not answer", async () => {
		const { container } = await open({
			tasks: [details({ ahead: null, added: null, removed: null, age: null })],
		});

		const fields = [...container.querySelectorAll("dd")].map(
			(field) => field.textContent,
		);

		expect(fields).toContain("?");
		expect(container.textContent).not.toContain("+");
	});

	it("says how to start one when there are no tasks", async () => {
		const { container } = await open({ tasks: [] });

		expect(container.textContent).toContain("no tasks");
		expect(container.querySelector("code")?.textContent).toBe(
			"arbor add <task>",
		);
	});

	it("leads an escalated card with the reason a person has to answer", async () => {
		const { getByText } = await open({
			tasks: [
				details({ status: "escalated", escalation: "confirm the ordering" }),
			],
		});

		const banner = getByText("reason").parentElement;

		expect(banner?.textContent).toContain("confirm the ordering");
		// Ahead of the field list rather than joining the run of them.
		expect(banner?.nextElementSibling?.tagName).toBe("DL");
	});

	it("draws the bar off the ARBOR.md checkboxes", async () => {
		const { container } = await open({
			tasks: [
				details({
					plan: "# alpha\n\n## Done\n- [x] one\n\n## Next\n- [ ] two\n- [ ] three\n",
				}),
			],
		});

		const bar = container.querySelector("article [role=img]");

		expect(bar?.getAttribute("aria-label")).toBe("1 of 3 done");
		expect(container.textContent).toContain("1/3");
	});

	it("counts only the work sections, so a checklist under Notes cannot skew it", async () => {
		const { container } = await open({
			tasks: [
				details({
					plan: "# alpha\n\n## Next\n- [ ] one\n\n## Notes\n- [x] not work\n",
				}),
			],
		});

		const bar = container.querySelector("article [role=img]");

		expect(bar?.getAttribute("aria-label")).toBe("0 of 1 done");
	});

	it("leaves the bar off a task whose ARBOR.md has no checklist", async () => {
		const { queryByRole } = await open({
			tasks: [details({ plan: "# alpha\n\n## Goal\nland it\n" })],
		});

		expect(queryByRole("img")).toBeNull();
	});

	it("renders the ARBOR.md, minus the title the card already carries", async () => {
		const { container } = await open({
			tasks: [details({ plan: "# alpha\n\n## Goal\nland it\n" })],
		});

		expect(container.querySelector("h1")).toBeNull();
		// The card's own heading first, then the document's sections under it.
		const headings = [...container.querySelectorAll("h2")];
		expect(headings[0]?.textContent).toContain("alpha");
		expect(headings[1]?.textContent).toBe("Goal");
		expect(container.textContent).toContain("land it");
	});

	it("renders markup in an ARBOR.md as text rather than elements", async () => {
		const { container } = await open({
			tasks: [
				details({
					plan: "# alpha\n\n## Next\n- [ ] drop <script>alert(1)</script>\n",
				}),
			],
		});

		expect(container.querySelector("script")).toBeNull();
		expect(container.textContent).toContain("drop <script>alert(1)</script>");
	});

	it("says what is wrong with an ARBOR.md", async () => {
		const { container } = await open({
			tasks: [
				details({ plan: "# alpha\n", planProblems: ["no ## Next section"] }),
			],
		});

		expect(container.textContent).toContain("no ## Next section");
	});

	it("warns when a task has no ARBOR.md, but not when its worktree is gone", async () => {
		const { container } = await open({
			tasks: [
				details({ task: "alpha" }),
				details({ task: "beta", status: "orphaned" }),
			],
		});

		const cards = [...container.querySelectorAll("article")];

		expect(cards[0]?.textContent).toContain("no ARBOR.md");
		expect(cards[1]?.textContent).not.toContain("no ARBOR.md");
	});

	it("shows the log when you pick its tab", async () => {
		const view = await open({
			entries: [entry({ action: "add", task: "alpha" })],
		});

		fireEvent.click(view.getByRole("button", { name: "log" }));

		const row = view.getByRole("table", { name: "log" }).querySelector("tr");

		expect([...(row?.cells ?? [])].map((cell) => cell.textContent)).toEqual([
			"3m",
			"add",
			"alpha",
			"ok",
		]);
	});

	it("shows the newest entry first, though the journal hands them over oldest first", async () => {
		const view = await open({
			entries: [
				entry({ action: "add", task: "alpha" }),
				entry({ action: "merge", task: "alpha" }),
			],
		});

		fireEvent.click(view.getByRole("button", { name: "log" }));

		const rows = [
			...view.getByRole("table", { name: "log" }).querySelectorAll("tr"),
		];

		expect(rows.map((row) => row.cells[1]?.textContent)).toEqual([
			"merge",
			"add",
		]);
	});

	it("shows a refused command's reason in place of ok", async () => {
		const view = await open({
			entries: [entry({ action: "merge", task: null, reason: "tests failed" })],
		});

		fireEvent.click(view.getByRole("button", { name: "log" }));

		const row = view.getByRole("table", { name: "log" }).querySelector("tr");

		expect([...(row?.cells ?? [])].map((cell) => cell.textContent)).toEqual([
			"3m",
			"merge",
			"-",
			"tests failed",
		]);
	});

	it("says nothing is recorded yet when the log is empty", async () => {
		const view = await open({ entries: [] });

		fireEvent.click(view.getByRole("button", { name: "log" }));

		expect(view.container.textContent).toContain("nothing recorded yet");
		expect(view.queryByRole("table")).toBeNull();
	});

	it("refetches when the server says something changed", async () => {
		const view = await open({ tasks: [details({ task: "alpha" })] });

		await push({
			tasks: [details({ task: "alpha" }), details({ task: "beta" })],
		});

		expect(view.container.querySelectorAll("article")).toHaveLength(2);
	});

	it("keeps the tab you picked across a refetch", async () => {
		const view = await open({ entries: [entry()] });
		fireEvent.click(view.getByRole("button", { name: "log" }));

		await push({ entries: [entry(), entry({ action: "merge" })] });

		expect(
			view.getByRole("table", { name: "log" }).querySelectorAll("tr"),
		).toHaveLength(2);
	});

	it("says it is not connected when the stream drops, and stops once it is back", async () => {
		const view = await open({ tasks: [details()] });

		await act(async () => stream?.onerror?.());
		expect(view.container.textContent).toContain("not connected");

		await act(async () => stream?.onopen?.());
		expect(view.container.textContent).not.toContain("not connected");
	});

	it("keeps the last snapshot on screen when a refetch fails", async () => {
		const view = await open({ tasks: [details({ task: "alpha" })] });

		down = true;
		await act(async () => stream?.onmessage?.());

		expect(view.container.textContent).toContain("alpha");
		expect(view.container.textContent).toContain("not connected");
	});

	it("closes the stream when the page goes away", async () => {
		const view = await open({ tasks: [details()] });

		view.unmount();

		expect(stream?.closed).toBe(true);
	});
});

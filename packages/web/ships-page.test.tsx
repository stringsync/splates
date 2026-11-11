import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Cascade, ShipProject } from "@splates/server/ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import type { ConversationFeed } from "./conversation-feed";
import { FakeStream, type Stream } from "./fake-stream";
import { ShipsPage } from "./ships-page";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";

describe("ShipsPage", () => {
	beforeEach(() => {
		globalThis.EventSource = FakeStream as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(answer(String(url), []))) as unknown as typeof fetch;
	});

	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
		globalThis.EventSource = realEventSource;
	});

	it("shows streamed stages and offers Retry and Stop on a stopped ship", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		const posts: string[] = [];
		globalThis.fetch = (async (url: string, opts?: RequestInit) => {
			posts.push(`${opts?.method ?? "GET"} ${String(url)}`);
			return Response.json(answer(String(url), []));
		}) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: stopped, ship: null }),
			}),
		);
		// The plan stays open, with the ship under way pinned above it.
		const card = await view.findByRole("link", {
			name: "example ship stopped: open the ship",
		});
		expect(card.getAttribute("href")).toBe("#ships/active");
		expect(location.hash).not.toBe("#ships/active");
		act(() => {
			location.hash = "#ships/active";
		});
		expect(await view.findByText("Wait for own live")).toBeTruthy();
		fireEvent.click(view.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(posts).toContain("POST /api/ship/steps/retry"));
		fireEvent.click(view.getByRole("button", { name: "Stop" }));
		const dialog = await view.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Stop" }));
		await waitFor(() =>
			expect(posts).toContain("POST /api/ship/steps/abandon"),
		);
		await waitFor(() => expect(location.hash).toBe("#ships"));
	});

	it("sends a stopped ship to an agent on Auto pick, with its logs to examine", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		const bodies: Record<string, string> = {};
		globalThis.fetch = (async (url: string, opts?: RequestInit) => {
			bodies[String(url)] = String(opts?.body ?? "");
			return Response.json(
				String(url) === "/api/conversations/auto"
					? { id: "c1" }
					: answer(String(url), []),
			);
		}) as unknown as typeof fetch;
		const feed = {
			agents: [],
			conversations: [],
			put: () => undefined,
			send: () => ({ id: "m1" }),
			answered: () => undefined,
			refused: () => undefined,
		} as unknown as ConversationFeed;
		location.hash = "#ships/active";
		const view = render(<ShipsPage feed={feed} />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: stopped, ship: null }),
			}),
		);
		fireEvent.click(await view.findByRole("button", { name: "Send to agent" }));
		await waitFor(() => expect(location.hash).toBe("#conversations/c1"));
		const words = JSON.parse(bodies["/api/conversations/auto"] ?? "{}").words;
		expect(words).toContain("Ship `example` stopped at the `live` stage");
		expect(words).toContain("/api/ship/history/example/log");
	});

	it("opens on the plan, with a History row naming the last ship that shipped", async () => {
		location.hash = "#ships";
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				String(url).startsWith("/api/ship/history")
					? [
							{ ...summary, id: "old", status: "stopped" },
							{
								...summary,
								id: "new",
								status: "done",
								started: new Date(Date.now() - 2 * 86_400_000).toISOString(),
							},
						]
					: answer(String(url), []),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(view.queryByRole("link", { name: /^History/ })).toBeNull();
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		const row = await view.findByRole("link", { name: /^History/ });
		expect(row.getAttribute("href")).toBe("#ships/history");
		await waitFor(() =>
			expect(row.textContent).toContain("Last shipped 2d ago"),
		);
		expect(view.queryByRole("list", { name: "Ship steps" })).toBeNull();
	});

	it("shows the ship under way at #ships/active, with a way back to the plan", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		location.hash = "ships/active";
		const view = render(<ShipsPage />);
		expect(await view.findByText("Active ship")).toBeTruthy();
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: stopped, ship: null }),
			}),
		);
		expect(await view.findByText("Wait for own live")).toBeTruthy();
		expect(view.queryByRole("button", { name: "Start" })).toBeNull();
		location.hash = "";
	});

	it("shows only Loading until the ship state arrives, then the plan", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [project({})]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(view.getByText("Loading")).toBeTruthy();
		await new Promise((done) => setTimeout(done, 50));
		expect(view.queryByRole("list", { name: "Ship graph" })).toBeNull();
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		expect(await view.findByRole("list", { name: "Ship graph" })).toBeTruthy();
		expect(view.queryByText("Loading")).toBeNull();
	});

	it("shows no History row while the projects are still loading", async () => {
		location.hash = "#ships";
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = ((url: string) =>
			String(url).startsWith("/api/ship/history")
				? Promise.resolve(Response.json([]))
				: new Promise(() => undefined)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await new Promise((done) => setTimeout(done, 50));
		expect(view.getByText("Loading")).toBeTruthy();
		expect(view.queryByRole("link", { name: /^History/ })).toBeNull();
	});

	it("lists the projects in release order, a Ship checkbox on each that names a ship command", async () => {
		const graph = [
			project({ slug: "wren", packages: ["wren"] }),
			project({
				slug: "sound2score",
				ship: null,
				private: true,
				uses: [{ project: "mdom", pins: [] }],
			}),
			project({
				slug: "mdom",
				packages: ["mdom"],
				uses: [{ project: "wren", pins: [] }],
			}),
		];
		globalThis.fetch = (async (url: string) =>
			Response.json(answer(String(url), graph))) as unknown as typeof fetch;
		const view = renderPlanner();
		const list = await view.findByRole("list", { name: "Ship graph" });
		expect(
			within(list)
				.getAllByRole("listitem")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["wren", "mdom", "sound2score"]);
		expect(
			within(list).getAllByRole("checkbox", { name: /^Ship / }),
		).toHaveLength(2);
	});

	it("marks unshipped commits and distinguishes up-to-date and unknown release history", async () => {
		const graph = [
			project({
				slug: "changed",
				changes: { commits: 3, branch: "master", tag: "v1.0.0", error: null },
			}),
			project({
				slug: "current",
				changes: { commits: 0, branch: "main", tag: "v1.0.0", error: null },
			}),
			project({
				slug: "unknown",
				changes: {
					commits: null,
					branch: "main",
					tag: "v1.0.0",
					error: "Missing release tag",
				},
			}),
		];
		globalThis.fetch = (async (url: string) =>
			Response.json(answer(String(url), graph))) as unknown as typeof fetch;
		const view = renderPlanner();
		expect(await view.findByText("3 commits since v1.0.0")).toBeTruthy();
		expect(view.getByText("Release status unknown").getAttribute("title")).toBe(
			"Missing release tag",
		);
	});

	it("offers no include of every changed project when none changed", async () => {
		const graph = [
			project({
				changes: { commits: 0, branch: "main", tag: "v0.0.53", error: null },
			}),
		];
		globalThis.fetch = (async (url: string) =>
			Response.json(answer(String(url), graph))) as unknown as typeof fetch;
		const view = renderPlanner();
		await view.findByRole("list", { name: "Ship graph" });
		expect(
			view.queryByRole("button", { name: "Include all changed" }),
		).toBeNull();
	});

	it("enables planning and never requests the old run endpoint", async () => {
		const asked: string[] = [];
		globalThis.fetch = (async (url: string) => {
			asked.push(String(url));
			return Response.json(answer(String(url), [project({})]));
		}) as unknown as typeof fetch;
		const view = renderPlanner();
		const list = await view.findByRole("list", { name: "Ship graph" });
		expect(
			within(list)
				.getByRole("checkbox", { name: "Ship wren" })
				.hasAttribute("disabled"),
		).toBe(false);
		expect(asked.some((url) => url.includes("/api/ship/run"))).toBe(false);
	});
});

/** Renders the page once the server has said no ship is under way. */
function renderPlanner(): ReturnType<typeof render> {
	let stream: Stream | null = null;
	globalThis.EventSource = class extends FakeStream {
		constructor() {
			super();
			stream = this;
		}
	} as unknown as typeof EventSource;
	const view = render(<ShipsPage />);
	act(() =>
		stream?.onmessage?.({
			data: JSON.stringify({ cascade: null, ship: null }),
		}),
	);
	return view;
}

function project(over: Partial<ShipProject>): ShipProject {
	return {
		slug: "wren",
		root: "/wren",
		ship: "wiz dev ship",
		version: "0.0.53",
		packages: [],
		private: false,
		uses: [],
		dependents: [],
		...over,
	};
}
/** What the server answers `url`: the graph, else an empty history list. */
function answer(url: string, projects: unknown[]): unknown {
	if (url.startsWith("/api/ship/graph")) {
		return { projects };
	}
	return [];
}

const summary = {
	from: "example",
	started: "2026-10-29T12:00:00Z",
	ended: "2026-10-29T12:10:00Z",
	projects: [],
};

const realFetch = globalThis.fetch;

const realEventSource = globalThis.EventSource;

const stopped: Cascade = {
	id: "example",
	from: "example",
	status: "stopped",
	started: "2026-10-29T12:00:00Z",
	ended: null,
	steps: [
		{
			slug: "example",
			action: "ship",
			from: "1.0.0",
			to: "1.0.1",
			bump: "patch",
			publishes: ["example"],
			takes: [],
			why: "selected",
			status: "failed",
			task: null,
			ship: null,
			published: [],
			note: "provider unreachable",
			stages: [
				{
					key: "live",
					name: "Wait for own live",
					state: "failed",
					started: null,
					ended: null,
					expected: 1000,
					known: false,
					deadline: null,
					check: null,
					log: null,
				},
			],
		},
	],
};

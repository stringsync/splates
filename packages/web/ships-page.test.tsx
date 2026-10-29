import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Cascade, ShipProject } from "@stringsync/splates-server/ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
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

	it("shows streamed stages and offers Retry and Abandon on a stopped ship", async () => {
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
		expect(await view.findByText("Wait for own live")).toBeTruthy();
		fireEvent.click(view.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(posts).toContain("POST /api/ship/steps/retry"));
		fireEvent.click(view.getByRole("button", { name: "Abandon" }));
		await waitFor(() =>
			expect(posts).toContain("POST /api/ship/steps/abandon"),
		);
	});

	it("lists the projects in release order, a switch on each that names a ship command", async () => {
		const graph = [
			project({ slug: "webappwiz", packages: ["webappwiz"] }),
			project({
				slug: "sound2score",
				ship: null,
				private: true,
				uses: [{ project: "mdom", pins: [] }],
			}),
			project({
				slug: "mdom",
				packages: ["mdom"],
				uses: [{ project: "webappwiz", pins: [] }],
			}),
		];
		globalThis.fetch = (async (url: string) =>
			Response.json(answer(String(url), graph))) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		const list = await view.findByRole("list", { name: "Ship graph" });
		expect(
			within(list)
				.getAllByRole("listitem")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["webappwiz", "mdom", "sound2score"]);
		expect(within(list).getAllByRole("switch")).toHaveLength(2);
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
		const view = render(<ShipsPage />);
		expect(await view.findByText("3 unshipped")).toBeTruthy();
		expect(view.getByText("Up to date")).toBeTruthy();
		expect(view.getByText("Release status unknown").getAttribute("title")).toBe(
			"Missing release tag",
		);
	});

	it("disables the include of every changed project when none changed", async () => {
		const graph = [
			project({
				changes: { commits: 0, branch: "main", tag: "v0.0.53", error: null },
			}),
		];
		globalThis.fetch = (async (url: string) =>
			Response.json(answer(String(url), graph))) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(await view.findByText("Every project is up to date")).toBeTruthy();
		expect(
			view
				.getByRole("button", { name: "Include all changed" })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	it("enables planning and never requests the old run endpoint", async () => {
		const asked: string[] = [];
		globalThis.fetch = (async (url: string) => {
			asked.push(String(url));
			return Response.json(answer(String(url), [project({})]));
		}) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		const list = await view.findByRole("list", { name: "Ship graph" });
		expect(within(list).getByRole("switch").hasAttribute("disabled")).toBe(
			false,
		);
		expect(asked.some((url) => url.includes("/api/ship/run"))).toBe(false);
	});
});

function project(over: Partial<ShipProject>): ShipProject {
	return {
		slug: "webappwiz",
		root: "/webappwiz",
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

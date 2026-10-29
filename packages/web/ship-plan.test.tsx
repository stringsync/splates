import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Cascade, ShipProject } from "@stringsync/splates-server/ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import { FakeStream, type Stream } from "./fake-stream";
import { ShipsPage } from "./ships-page";
import { pick } from "./testing";
import { act, cleanup, fireEvent, render, waitFor } from "./testing-library";

describe("Ship plan", () => {
	beforeEach(() => {
		globalThis.EventSource = FakeStream as unknown as typeof EventSource;
	});
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
		globalThis.EventSource = realEventSource;
	});
	it("submits bump and verbatim agent instructions in dependency order only after Start", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		let body: unknown = null;
		globalThis.fetch = (async (url: string, opts?: RequestInit) => {
			// scry-ignore matchers-over-test-logic: the fake transport distinguishes reads from the submitted write
			if (opts?.method === "POST") {
				body = JSON.parse(String(opts.body));
				return new Response("refused", { status: 409 });
			}
			return Response.json(
				answer(String(url), [
					project({
						slug: "base",
						changes: { commits: 2, branch: "main", tag: "v1", error: null },
					}),
					project({ slug: "consumer", uses: [{ project: "base", pins: [] }] }),
				]),
			);
		}) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByText("base");
		fireEvent.click(view.getByRole("button", { name: "Include all changed" }));
		await act(async () =>
			fireEvent.click(
				view.getByRole("combobox", { name: "base version bump" }),
			),
		);
		const minor = await view.findByRole("option", { name: "minor" });
		await pick(minor);
		fireEvent.click(view.getByRole("switch", { name: "Agent task for base" }));
		fireEvent.change(view.getByLabelText("Instructions for base"), {
			target: { value: "  Keep this exactly.\n" },
		});
		expect(body).toBeNull();
		fireEvent.click(view.getByRole("button", { name: /^Start/ }));
		await waitFor(() =>
			expect(body).toEqual({
				projects: [
					{
						slug: "base",
						bump: "minor",
						adopt: "agent",
						instructions: "  Keep this exactly.\n",
					},
					{
						slug: "consumer",
						bump: "patch",
						adopt: "mechanical",
						instructions: "",
					},
				],
			}),
		);
		expect(await view.findByRole("alert")).toBeTruthy();
	});
	it("blocks another start while a ship is stopped", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async () =>
			Response.json({ projects: [project({})] })) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: stopped, ship: null }),
			}),
		);
		expect(await view.findByText("A ship is under way.")).toBeTruthy();
		expect(
			view.getByRole("button", { name: /^Start/ }).hasAttribute("disabled"),
		).toBe(true);
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

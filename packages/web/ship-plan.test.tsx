import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Cascade, ShipProject } from "@splates/server/ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import { FakeStream, type Stream } from "./fake-stream";
import { ShipsPage } from "./ships-page";
import { pick } from "./testing";
import { act, cleanup, fireEvent, render, waitFor } from "./testing-library";

/** Picks `item` from the projects list's ⋯ menu. */
async function choose(
	view: ReturnType<typeof render>,
	item: string,
): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Select projects" })),
	);
	const shown = await waitFor(() => view.getByRole("menuitem", { name: item }));
	await act(async () => fireEvent.click(shown));
}

describe("Ship plan", () => {
	beforeEach(() => {
		globalThis.EventSource = FakeStream as unknown as typeof EventSource;
	});
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
		globalThis.EventSource = realEventSource;
	});
	it("the projects menu selects every shippable project and clears them again", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [
					project({ slug: "base" }),
					project({ slug: "consumer", uses: [{ project: "base", pins: [] }] }),
				]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByText("base");
		await choose(view, "Select all");
		await waitFor(() =>
			expect(ticked(view.getByRole("checkbox", { name: "Ship base" }))).toBe(
				true,
			),
		);
		expect(ticked(view.getByRole("checkbox", { name: "Ship consumer" }))).toBe(
			true,
		);
		await choose(view, "Clear");
		await waitFor(() =>
			expect(ticked(view.getByRole("checkbox", { name: "Ship base" }))).toBe(
				false,
			),
		);
	});
	it("shows a deploy target by its commits since the deployed one, with no bump picker", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [
					project({
						slug: "app",
						version: null,
						private: true,
						deploy: true,
						changes: {
							commits: 3,
							branch: "main",
							tag: "abc123456",
							error: null,
						},
					}),
				]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByText("deploy");
		expect(view.getByText(/3 commits since/)).toBeTruthy();
		expect(view.queryByLabelText("app version bump")).toBeNull();
	});
	// vet-ignore simple-test-setup: this test owns the captured POST body and refused response needed to verify the submission.
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
			// vet-ignore matchers-over-test-logic: the fake transport distinguishes reads from the submitted write
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
		await choose(view, "Select the 1 with changes");
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
		fireEvent.click(view.getByRole("button", { name: /^Review \d/ }));
		expect(body).toBeNull();
		fireEvent.click(
			view.getByRole("button", { name: "Accept and start ship" }),
		);
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
	it("reviews each release on its own page, keeps the picks on Back, and marks a dependent added automatically", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [
					project({ slug: "base" }),
					project({ slug: "consumer", uses: [{ project: "base", pins: [] }] }),
				]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByText("base");
		expect(view.getByText("Nothing chosen")).toBeTruthy();
		fireEvent.click(view.getByRole("checkbox", { name: "Ship base" }));
		expect(
			view.queryByRole("region", { name: "What Start will do" }),
		).toBeNull();
		expect(view.getAllByText("added automatically")).toHaveLength(1);
		fireEvent.click(view.getByRole("button", { name: "Review 2 projects" }));
		const preview = view.getByRole("region", { name: "What Start will do" });
		expect(preview.textContent).toContain("base0.0.53 → 0.0.54");
		expect(preview.textContent).toContain("First: pin base 0.0.54");
		fireEvent.click(view.getByRole("button", { name: "Back" }));
		expect(ticked(view.getByRole("checkbox", { name: "Ship base" }))).toBe(
			true,
		);
		expect(
			view.getByRole("button", { name: "Review 2 projects" }),
		).toBeTruthy();
	});
	it("shows the plan without a steps card", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [
					project({
						slug: "base",
						changes: {
							commits: null,
							branch: "main",
							tag: "v1",
							error: "no tag",
						},
					}),
				]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByText("base");
		expect(view.queryByRole("region", { name: "About shipping" })).toBeNull();
		expect(view.getByText("Release status unknown")).toBeTruthy();
		fireEvent.click(view.getByRole("checkbox", { name: "Ship base" }));
		expect(view.queryByRole("region", { name: "About shipping" })).toBeNull();
	});
	it("blocks another start while a ship is stopped", async () => {
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
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: stopped, ship: null }),
			}),
		);
		expect(
			await view.findByText("You can plan the next ship once this one ends."),
		).toBeTruthy();
		expect(
			view
				.getByRole("button", { name: "A ship is running" })
				.hasAttribute("disabled"),
		).toBe(true);
	});
});

const ticked = (box: HTMLElement) =>
	box.getAttribute("aria-checked") === "true";

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

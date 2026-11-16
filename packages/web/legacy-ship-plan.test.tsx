import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Cascade, ShipProject } from "@splates/server/legacy-ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import { FakeStream, type Stream } from "./fake-stream";
import { ShipPlan } from "./legacy-ship-plan";
import { ShipsPage } from "./legacy-ships-page";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";

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
	// vet-ignore simple-test-setup: capture the graph inputs and submission through the page's real review flow.
	it("renders only the bump input, reviews selections, and submits them without a legacy bump", async () => {
		let body: unknown = null;
		let planned: unknown = null;
		const app = project({
			slug: "app",
			commandPlan: {
				schema: 1,
				identity: { kind: "version", from: "2.0.0", to: "2.1.0" },
				resuming: false,
				inputs: [
					{
						name: "bump",
						label: "Bump",
						type: "choice",
						options: ["patch", "minor", "major"],
						default: "minor",
					},
					{
						name: "prod",
						label: "Production",
						type: "boolean",
						default: false,
					},
					{ name: "region", label: "Region", type: "string", default: "east" },
				],
				steps: [],
			},
		});
		globalThis.fetch = (async (url: string, opts?: RequestInit) => {
			// vet-ignore matchers-over-test-logic: the fake transport records write requests and selected graph reads separately.
			if (opts?.method === "POST") {
				body = JSON.parse(String(opts.body));
				return new Response("refused", { status: 409 });
			}
			const inputs = new URL(String(url), "http://test").searchParams.get(
				"inputs",
			);
			planned = inputs === null ? planned : JSON.parse(inputs);
			return Response.json(answer(String(url), [app]));
		}) as typeof fetch;
		const view = render(
			<ShipPlan
				ship="app"
				endedAt={null}
				busy={false}
				loading={false}
				onStarted={() => {}}
			/>,
		);
		await view.findByLabelText("app version bump");
		expect(
			(view.getByRole("radio", { name: "minor" }) as HTMLInputElement).checked,
		).toBe(true);
		expect(view.queryByLabelText(/release note/i)).toBeNull();
		expect(view.queryByLabelText("app Production")).toBeNull();
		expect(view.queryByLabelText("app Region")).toBeNull();
		fireEvent.click(view.getByRole("button", { name: "Review 1 project" }));
		await view.findByText("Review this ship");
		expect(planned).toEqual({
			app: { bump: "minor", prod: false, region: "east" },
		});
		fireEvent.click(view.getByRole("button", { name: "Back" }));
		fireEvent.click(view.getByRole("button", { name: "Review 1 project" }));
		await view.findByText("Review this ship");
		fireEvent.click(
			view.getByRole("button", { name: "Accept and start ship" }),
		);
		await waitFor(() =>
			expect(body).toEqual({
				projects: [
					{
						slug: "app",
						adopt: "mechanical",
						instructions: "",
						inputs: { bump: "minor", prod: false, region: "east" },
					},
				],
			}),
		);
	});

	it("shows script identities, resuming and live evidence instead of predicting a version", async () => {
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [
					project({
						slug: "app",
						version: "0.0.1",
						resuming: "2.3.0",
						commandPlan: {
							schema: 1,
							identity: { kind: "version", from: "2.0.0", to: "2.3.0" },
							resuming: true,
							inputs: [],
							steps: [],
						},
						commandStatus: {
							identity: { kind: "version", from: "2.0.0", to: "2.0.0" },
							artifacts: [{ name: "cdn", deployed: "1.9.0" }],
						},
					}),
				]),
			)) as typeof fetch;
		const view = render(
			<ShipPlan
				ship="app"
				endedAt={null}
				busy={false}
				loading={false}
				onStarted={() => {}}
			/>,
		);
		await view.findByText("app");

		expect(view.getByText("cdn: 1.9.0")).toBeTruthy();
		expect(
			view.getByText("2.0.0 → 2.3.0 · finishing interrupted release"),
		).toBeTruthy();
		expect(view.queryByLabelText("app version bump")).toBeNull();
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
	it("offers a checkbox for a private target that names a ship command", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [project({ slug: "net", private: true })]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByText("net");
		expect(view.getByRole("checkbox", { name: "Ship net" })).toBeDefined();
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
		expect(view.getByText("3 commits")).toBeTruthy();
		expect(view.queryByLabelText("app version bump")).toBeNull();
		expect(view.getByRole("checkbox", { name: "Ship app" })).toBeDefined();
		act(() => view.getByRole("checkbox", { name: "Ship app" }).click());
		expect(view.queryByLabelText("app version bump")).toBeNull();
		expect(view.queryByText("Release as")).toBeNull();
	});
	it("says a target with a release that died finishes it, with no bump picker", async () => {
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
					project({ slug: "net", version: "1.13.2", resuming: "1.13.3" }),
				]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByRole("checkbox", { name: "Ship net" });
		act(() => view.getByRole("checkbox", { name: "Ship net" }).click());
		expect(
			view.getByText("Finishes 1.13.3, which stopped partway."),
		).toBeTruthy();
		expect(view.queryByLabelText("net version bump")).toBeNull();
		expect(view.queryByText("Release as")).toBeNull();
	});
	// vet-ignore simple-test-setup: this test owns the captured POST body and refused response needed to verify the submission.
	it("submits the bump in dependency order only after Start", async () => {
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
		fireEvent.click(
			within(view.getByRole("group", { name: "base version bump" })).getByRole(
				"radio",
				{ name: "minor" },
			),
		);
		expect(
			view.queryByRole("switch", { name: "Agent task for base" }),
		).toBeNull();
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
						adopt: "mechanical",
						instructions: "",
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
					project({
						slug: "base",
						commandPlan: {
							schema: 1,
							identity: { kind: "version", from: "0.0.53", to: "0.0.54" },
							inputs: [],
							steps: [],
							resuming: false,
						},
					}),
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
		const preview = await view.findByRole("region", {
			name: "What Start will do",
		});
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
	it("pulls in and locks its dependencies, skipping a current one", async () => {
		let stream: Stream | null = null;
		globalThis.EventSource = class extends FakeStream {
			constructor() {
				super();
				stream = this;
			}
		} as unknown as typeof EventSource;
		const changes = (commits: number) => ({
			commits,
			tag: "v1",
			branch: "main",
			error: null,
		});
		globalThis.fetch = (async (url: string) =>
			Response.json(
				answer(String(url), [
					project({
						slug: "web",
						dependencies: ["lib", "db"],
						dependenciesClosure: ["lib", "db"],
						changes: changes(2),
					}),
					project({ slug: "lib", changes: changes(1) }),
					project({ slug: "db", changes: changes(0) }),
				]),
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		act(() =>
			stream?.onmessage?.({
				data: JSON.stringify({ cascade: null, ship: null }),
			}),
		);
		await view.findByText("lib");
		fireEvent.click(view.getByRole("checkbox", { name: "Ship web" }));
		const lib = view.getByRole("checkbox", { name: "Ship lib" });
		expect(ticked(lib)).toBe(true);
		expect(
			lib.hasAttribute("disabled") ||
				lib.getAttribute("aria-disabled") === "true",
		).toBe(true);
		expect(ticked(view.getByRole("checkbox", { name: "Ship db" }))).toBe(false);
		expect(view.getByText("Required by web")).toBeTruthy();
		expect(view.queryByText(/Ships in order/)).toBeNull();
		fireEvent.click(view.getByRole("checkbox", { name: "Ship web" }));
		expect(ticked(view.getByRole("checkbox", { name: "Ship lib" }))).toBe(
			false,
		);
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
		expect(view.getByText("status unknown")).toBeTruthy();
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
	if (url.startsWith("/api/legacy-ship/graph")) {
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

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	Cascade,
	CascadeStep,
	Ship,
	ShipProject,
	Stage,
} from "@stringsync/splates-server/ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import { FakeStream, type Stream } from "./fake-stream";
import { ShipsPage } from "./ships-page";
import { act, cleanup, render, within } from "./testing-library";

describe("ShipsPage", () => {
	beforeEach(() => {
		streams = [];
		globalThis.EventSource = class extends FakeStream {
			constructor(readonly url: string) {
				super();
				streams.push(this);
			}
		} as unknown as typeof EventSource;
		globalThis.fetch = (async () =>
			Response.json([])) as unknown as typeof fetch;
	});

	afterEach(() => {
		cleanup();
		globalThis.EventSource = realSource;
		globalThis.fetch = realFetch;
	});

	it("draws the projects as a dependency tree, a Ship on each that names a ship command", async () => {
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
			Response.json(
				String(url).startsWith("/api/ship/graph") ? { projects: graph } : [],
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		await say({ cascade: null, ship: null });
		const tree = await view.findByRole("list", { name: "Ship graph" });
		const below = within(tree).getByRole("list", {
			name: "webappwiz dependents",
		});
		const mdom = within(below).getByRole("listitem", { name: "mdom" });
		expect(
			within(mdom).getByRole("listitem", { name: "sound2score" }),
		).toBeTruthy();
		expect(within(tree).getAllByRole("button", { name: "Ship" })).toHaveLength(
			2,
		);
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
			Response.json(
				String(url).startsWith("/api/ship/graph") ? { projects: graph } : [],
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		await say({ cascade: null, ship: null });
		expect(await view.findByText("3 unshipped commits")).toBeTruthy();
		expect(view.getByText("Up to date")).toBeTruthy();
		expect(view.getByText("Release status unknown").getAttribute("title")).toBe(
			"Missing release tag",
		);
	});

	it("ships every changed project from one button, which names them", async () => {
		const asked: string[] = [];
		const graph = [
			project({
				slug: "webappwiz",
				changes: { commits: 2, branch: "main", tag: "v0.0.53", error: null },
			}),
			project({
				slug: "mdom",
				uses: [{ project: "webappwiz", pins: [] }],
				changes: { commits: 1, branch: "main", tag: "v0.0.53", error: null },
			}),
			project({
				slug: "vexml",
				changes: { commits: 0, branch: "main", tag: "v0.0.53", error: null },
			}),
		];
		globalThis.fetch = (async (url: string) => {
			asked.push(String(url));
			return Response.json(
				String(url).startsWith("/api/ship/graph") ? { projects: graph } : [],
			);
		}) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		await say({ cascade: null, ship: null });
		expect(
			await view.findByText("2 projects have unshipped commits"),
		).toBeTruthy();
		expect(
			view.getByText(
				"webappwiz, mdom, released dependencies first, then what depends on them.",
			),
		).toBeTruthy();
		await act(async () => {
			view.getByRole("button", { name: "Ship all changed" }).click();
		});
		expect(
			await view.findByRole("heading", { name: "Ship every changed project" }),
		).toBeTruthy();
		expect(asked.some((url) => url.includes("project=%2Bchanged"))).toBe(true);
	});

	it("disables shipping every changed project when none changed", async () => {
		const graph = [
			project({
				changes: { commits: 0, branch: "main", tag: "v0.0.53", error: null },
			}),
		];
		globalThis.fetch = (async (url: string) =>
			Response.json(
				String(url).startsWith("/api/ship/graph") ? { projects: graph } : [],
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		await say({ cascade: null, ship: null });
		expect(await view.findByText("Every project is up to date")).toBeTruthy();
		expect(
			view
				.getByRole("button", { name: "Ship all changed" })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	it("lists every project's steps under way at once, with what waits on the person pinned beneath", async () => {
		const view = render(<ShipsPage />);
		await say({
			cascade: cascade([
				step({
					slug: "webappwiz",
					status: "done",
					stages: [
						stage({ key: "command", name: "Ship command", state: "done" }),
					],
				}),
				step({
					slug: "mdom",
					status: "asking",
					task: 12,
					stages: [stage({ key: "bump", name: "Bump task", state: "asking" })],
				}),
			]),
			ship: null,
		});
		const under = view.getByRole("region", { name: "under way" });
		expect(under.textContent).toContain("1 of 2");
		expect(within(under).getByRole("button", { name: "Abandon" })).toBeTruthy();
		const webappwiz = within(under).getByRole("listitem", {
			name: "webappwiz",
		});
		expect(
			within(webappwiz).getByRole("listitem", { name: "Ship command" }),
		).toBeTruthy();
		const mdom = within(under).getByRole("listitem", { name: "mdom" });
		expect(mdom.textContent).toContain("asks you");
		const needs = within(under).getByRole("status", { name: "needs you" });
		expect(needs.textContent).toContain("mdom's bump task asks you something");
		expect(
			within(needs)
				.getByRole("link", { name: "Answer #12" })
				.getAttribute("href"),
		).toBe("?project=mdom#todos/12");
	});

	it("pins npm's page beneath the steps while a publish waits on the person", async () => {
		const view = render(<ShipsPage />);
		await say({
			cascade: cascade([
				step({ slug: "webappwiz", status: "done" }),
				step({ slug: "mdom", status: "shipping" }),
			]),
			ship: {
				project: "mdom",
				command: "wiz dev ship",
				bump: "patch",
				status: "running",
				step: "ship",
				from: "0.0.50",
				to: null,
				started: "2026-10-27T12:00:01.000Z",
				ended: null,
				waiting: {
					kind: "2fa",
					url: "https://www.npmjs.com/auth/cli/abc",
					since: "2026-10-27T12:00:00.000Z",
				},
				error: null,
				resumed: 0,
			},
		});
		const needs = view.getByRole("status", { name: "needs you" });
		expect(needs.textContent).toContain("Approve mdom on npm");
		expect(
			within(needs)
				.getByRole("link", { name: "Open npm" })
				.getAttribute("href"),
		).toBe("https://www.npmjs.com/auth/cli/abc");
	});

	it("opens a separate recovery plan from the stopped run", async () => {
		localStorage.removeItem("splates.ship.closed");
		const requested: string[] = [];
		globalThis.fetch = (async (url: string) => {
			requested.push(String(url));
			return Response.json(
				String(url).startsWith("/api/ship/plan")
					? {
							from: "webappwiz",
							steps: [],
							recovery: { id: "stopped", inputs: [] },
						}
					: [],
			);
		}) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		await say({
			cascade: {
				...cascade([step({ status: "failed" })]),
				id: "stopped",
				status: "stopped",
			},
			ship: null,
		});
		await act(async () =>
			view.getByRole("button", { name: "Recover" }).click(),
		);
		expect(await view.findByText("Recover ship of webappwiz")).toBeTruthy();
		expect(requested).toContain(
			"/api/ship/plan?project=webappwiz&bump=patch&recovery=stopped",
		);
	});

	it("shows a stopped run until it is closed, with why it stopped and npm's settings when that is the remedy", async () => {
		localStorage.removeItem("splates.ship.closed");
		globalThis.fetch = (async (url: string) =>
			Response.json(
				String(url).startsWith("/api/ship/graph") ? { projects: [] } : [],
			)) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		const stopped = {
			...cascade([
				step({
					slug: "webappwiz",
					status: "failed",
					note: "npm asked for a typed code, which splates never takes: add a security key to your npm 2FA at https://www.npmjs.com/settings/jared/tfa so npm asks on its page",
					stages: [stage({ key: "otp", name: "2FA", state: "failed" })],
				}),
				step({ slug: "mdom", status: "abandoned" }),
			]),
			status: "stopped" as const,
		};
		await say({ cascade: stopped, ship: null });
		const under = view.getByRole("region", { name: "under way" });
		expect(under.textContent).toContain("Stopped at webappwiz");
		expect(
			within(under).getByRole("listitem", { name: "mdom" }).textContent,
		).toContain("not run");
		const needs = within(under).getByRole("status", { name: "needs you" });
		expect(needs.textContent).toContain("webappwiz: 2FA failed");
		expect(needs.textContent).toContain(
			"add a security key to your npm 2FA so npm asks on its page",
		);
		expect(
			within(needs)
				.getByRole("link", { name: "Open npm settings" })
				.getAttribute("href"),
		).toBe("https://www.npmjs.com/settings/jared/tfa");
		expect(within(under).queryByRole("button", { name: "Resume" })).toBeNull();

		await act(async () => {
			within(under).getByRole("button", { name: "Close" }).click();
		});
		expect(view.queryByRole("region", { name: "under way" })).toBeNull();
	});
});

function stage(over: Partial<Stage>): Stage {
	return {
		key: "bump",
		name: "Bump task",
		state: "pending",
		started: null,
		ended: null,
		expected: 240_000,
		known: true,
		deadline: null,
		check: null,
		log: null,
		...over,
	};
}

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

function step(over: Partial<CascadeStep>): CascadeStep {
	return {
		slug: "webappwiz",
		action: "ship",
		from: "1.4.2",
		bump: "patch",
		to: "1.4.3",
		publishes: [],
		takes: [],
		why: "the project shipped",
		status: "waiting",
		task: null,
		ship: null,
		published: [],
		note: null,
		stages: [],
		...over,
	};
}

function cascade(steps: CascadeStep[]): Cascade {
	return {
		id: "2026-10-27T12-00-00-000Z-webappwiz",
		from: steps[0]?.slug ?? "webappwiz",
		status: "running",
		started: "2026-10-27T12:00:00.000Z",
		ended: null,
		steps,
	};
}

const realSource = globalThis.EventSource;
const realFetch = globalThis.fetch;
let streams: (FakeStream & { url: string })[] = [];

/** Has the server say `live`, as its stream does. */
async function say(live: { cascade: Cascade | null; ship: Ship | null }) {
	await act(async () => {
		for (const stream of streams.filter((each) =>
			each.url.startsWith("/api/ship/events"),
		)) {
			(stream.onmessage as unknown as Stream["onmessage"])?.({
				data: JSON.stringify(live),
			});
		}
	});
}

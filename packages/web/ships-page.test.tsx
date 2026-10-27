import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	Cascade,
	CascadeStep,
	Ship,
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

	it("says no ship has run when the server has none", async () => {
		const view = render(<ShipsPage />);
		await say({ cascade: null, ship: null });
		expect(view.getByText(/No ship has run yet/)).toBeTruthy();
	});

	it("pins what waits on the person above the timeline, and lists each project's steps with its time against what is expected", async () => {
		const view = render(<ShipsPage />);
		await say({
			cascade: cascade([
				step({ slug: "webappwiz", status: "done" }),
				step({
					slug: "mdom",
					status: "asking",
					task: 12,
					stages: [stage({ key: "bump", name: "Bump task", state: "asking" })],
				}),
			]),
			ship: null,
		});
		const needs = view.getByRole("region", { name: "needs you" });
		expect(
			within(needs).getByRole("link", { name: "#12" }).getAttribute("href"),
		).toBe("?project=mdom#todos/12");
		expect(within(needs).getByRole("button", { name: "Abandon" })).toBeTruthy();
		const mdom = view.getByRole("listitem", { name: "mdom" });
		expect(mdom.textContent).toContain("asks you");
	});

	it("offers Resume and Drop for a project that failed, and npm's page while a publish waits", async () => {
		const view = render(<ShipsPage />);
		await say({
			cascade: cascade([
				step({ slug: "webappwiz", status: "failed", note: "boom" }),
			]),
			ship: {
				project: "webappwiz",
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
		const needs = view.getByRole("region", { name: "needs you" });
		expect(within(needs).getByRole("button", { name: "Resume" })).toBeTruthy();
		expect(within(needs).getByRole("button", { name: "Drop" })).toBeTruthy();
		expect(
			within(needs).getByRole("link", { name: "Open" }).getAttribute("href"),
		).toBe("https://www.npmjs.com/auth/cli/abc");
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

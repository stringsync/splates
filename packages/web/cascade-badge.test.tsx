import { afterEach, describe, expect, it } from "bun:test";
import type {
	Cascade,
	CascadeStep,
	Ship,
} from "@stringsync/splates-server/ship";
// Before the badge: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import type { MachineStatus } from "./api";
import { CascadeBadge } from "./cascade-badge";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

afterEach(cleanup);

describe("CascadeBadge", () => {
	it("shows nothing when no ship ever cascaded, or on an older server", () => {
		expect(badge(null).container.textContent).toBe("");
		cleanup();
		expect(badge({ cascade: null, ship: null }).container.textContent).toBe("");
	});

	it("counts the projects through, and lists where each stands with its bump task", async () => {
		const view = await opened({
			cascade: cascade([
				cascadeStep({ slug: "webappwiz", status: "done" }),
				cascadeStep({ slug: "mdom", status: "bumping", task: 12 }),
				cascadeStep({ slug: "vexml", status: "waiting" }),
			]),
			ship: null,
		});
		expect(
			view.getByTitle("Shipping webappwiz and 2 projects downstream")
				.textContent,
		).toBe("Shipping 1/3");
		const mdom = view.getByRole("listitem", { name: "mdom" });
		expect(mdom.textContent).toContain("bumping");
		expect(
			within(mdom).getByRole("link", { name: "#12" }).getAttribute("href"),
		).toBe("?project=mdom#todos/12");
	});

	it("goes amber while npm waits on the person, opening npm's page", async () => {
		const view = await opened({
			cascade: cascade([
				cascadeStep({ slug: "webappwiz", status: "shipping" }),
			]),
			ship: ship({
				waiting: {
					kind: "2fa",
					url: "https://www.npmjs.com/auth/cli/abc",
					since: "2026-10-27T12:00:00.000Z",
				},
			}),
		});
		expect(view.getByText("npm 2FA")).toBeTruthy();
		expect(view.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
			"https://www.npmjs.com/auth/cli/abc",
		);
	});

	it("says where it stopped and why, and drops that project from the run", async () => {
		const view = await opened({
			cascade: cascade([
				cascadeStep({ slug: "webappwiz", status: "done" }),
				cascadeStep({
					slug: "mdom",
					status: "stopped",
					task: 12,
					note: "its bump task 12 was removed without merging",
				}),
			]),
			ship: null,
		});
		expect(view.getByText("Ship stopped at mdom")).toBeTruthy();
		const mdom = view.getByRole("listitem", { name: "mdom" });
		expect(mdom.textContent).toContain(
			"its bump task 12 was removed without merging",
		);
		const fetch = globalThis.fetch;
		const asked: string[] = [];
		globalThis.fetch = (async (input: string, init?: RequestInit) => {
			asked.push(`${init?.method ?? "GET"} ${input}`);
			return Response.json(null);
		}) as typeof globalThis.fetch;
		try {
			await act(async () =>
				fireEvent.click(within(mdom).getByRole("button", { name: "Drop" })),
			);
		} finally {
			globalThis.fetch = fetch;
		}

		expect(mdom.textContent).toContain("dropped");
		expect(within(mdom).queryByRole("button", { name: "Drop" })).toBeNull();
		expect(asked).toContain("DELETE /api/ship/cascade?project=mdom");
	});

	it("says it shipped once every project is through", () => {
		const view = badge({
			cascade: {
				...cascade([cascadeStep({ slug: "webappwiz", status: "done" })]),
				status: "done",
				ended: new Date().toISOString(),
			},
			ship: null,
		});
		expect(view.getByTitle("Shipped webappwiz").textContent).toBe(
			"Shipped webappwiz",
		);
	});
});

/** The badge, its popover opened. */
async function opened(ship: MachineStatus["ship"]) {
	const view = badge(ship ?? null);
	await act(async () => fireEvent.click(view.getByRole("button")));
	return view;
}

function badge(ship: MachineStatus["ship"] | null) {
	const machine = {
		queue: [],
		...(ship === null ? {} : { ship }),
	} as unknown as MachineStatus;
	return render(<CascadeBadge machine={machine} />);
}

function step(over: Partial<CascadeStep>): CascadeStep {
	return {
		slug: "webappwiz",
		action: "ship",
		from: "1.4.2",
		to: "1.4.3",
		publishes: [],
		takes: [],
		why: "the project shipped",
		status: "waiting",
		task: null,
		ship: null,
		published: [],
		note: null,
		...over,
	};
}

function cascadeStep(over: Partial<CascadeStep>): CascadeStep {
	return step(over);
}

function cascade(steps: CascadeStep[]): Cascade {
	return {
		from: steps[0]?.slug ?? "webappwiz",
		status: "running",
		started: "2026-10-27T12:00:00.000Z",
		ended: null,
		steps,
	};
}

function ship(over: Partial<Ship>): Ship {
	return {
		project: "webappwiz",
		command: "wiz dev ship",
		status: "running",
		step: "ship",
		from: "0.0.50",
		to: null,
		started: "2026-10-27T12:00:01.000Z",
		ended: null,
		waiting: null,
		error: null,
		resumed: 0,
		...over,
	};
}

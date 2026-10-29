import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ShipProject } from "@stringsync/splates-server/ship";
// Before the page: base-ui reads the DOM as it loads, so a file run alone
// needs it registered first.
import "./register-dom";
import { ShipsPage } from "./ships-page";
import { cleanup, render, within } from "./testing-library";

describe("ShipsPage", () => {
	beforeEach(() => {
		globalThis.fetch = (async (url: string) =>
			Response.json(answer(String(url), []))) as unknown as typeof fetch;
	});

	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
	});

	it("lists the projects in release order, a Ship on each that names a ship command", async () => {
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
		expect(within(list).getAllByRole("button", { name: "Ship" })).toHaveLength(
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
			Response.json(answer(String(url), graph))) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(await view.findByText("3 unshipped")).toBeTruthy();
		expect(view.getByText("Up to date")).toBeTruthy();
		expect(view.getByText("Release status unknown").getAttribute("title")).toBe(
			"Missing release tag",
		);
	});

	it("disables the pick of every changed project when none changed", async () => {
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
				.getByRole("button", { name: "Ship all changed" })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	it("keeps planning disabled and never requests the old run endpoint", async () => {
		const asked: string[] = [];
		globalThis.fetch = (async (url: string) => {
			asked.push(String(url));
			return Response.json(answer(String(url), [project({})]));
		}) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		const list = await view.findByRole("list", { name: "Ship graph" });
		expect(
			within(list)
				.getByRole("button", { name: "Ship" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(view.getByText("Ship-step planning is coming.")).toBeTruthy();
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

import { afterEach, describe, expect, test } from "bun:test";
import { ShipsPage } from "./ships-page";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";

const realFetch = globalThis.fetch;

const plan = (name: string, bump?: "patch" | "minor" | "major") => ({
	command: "bin/x ship",
	plan: { name, ...(bump ? { bump } : {}), dependencies: [], steps: [] },
});

describe("ShipsPage", () => {
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
	});

	const serve = (listing: unknown) => {
		globalThis.fetch = (async () =>
			Response.json(listing)) as unknown as typeof fetch;
	};

	test("lists every target flat, a deploy marked, and Next waits on a pick", async () => {
		serve({
			targets: [plan("@stringsync/mdom", "patch"), plan("net-staging")],
			errors: [],
		});
		const view = render(<ShipsPage />);
		expect(await view.findByText("@stringsync/mdom")).toBeTruthy();
		expect(view.getByText("deploy")).toBeTruthy();
		expect(view.queryByRole("group", { name: /bump/ })).toBeNull();
		const next = view.getByRole("button", { name: "Next" });
		expect(next.hasAttribute("disabled")).toBe(true);

		fireEvent.click(view.getByRole("checkbox", { name: "net-staging" }));
		await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));
		expect(view.queryByRole("group", { name: /bump/ })).toBeNull();
	});

	test("a picked package offers patch, minor and major, its own bump chosen", async () => {
		serve({
			targets: [
				plan("@stringsync/mdom", "minor"),
				plan("@stringsync/vexml", "patch"),
			],
			errors: [],
		});
		const view = render(<ShipsPage />);
		fireEvent.click(
			await view.findByRole("checkbox", { name: "@stringsync/mdom" }),
		);
		// Tapping the name picks the line too.
		fireEvent.click(view.getByText("@stringsync/vexml"));

		const mdom = await view.findByRole("group", {
			name: "@stringsync/mdom's bump",
		});
		const pressed = (group: HTMLElement) =>
			[...group.querySelectorAll("[aria-pressed=true]")].map(
				(button) => button.textContent,
			);
		expect(pressed(mdom)).toEqual(["minor"]);

		fireEvent.click(within(mdom).getByRole("button", { name: "major" }));
		await waitFor(() => expect(pressed(mdom)).toEqual(["major"]));
		const vexml = view.getByRole("group", { name: "@stringsync/vexml's bump" });
		expect(pressed(vexml)).toEqual(["patch"]);

		fireEvent.click(view.getByRole("checkbox", { name: "@stringsync/mdom" }));
		await waitFor(() =>
			expect(
				view.queryByRole("group", { name: "@stringsync/mdom's bump" }),
			).toBeNull(),
		);
	});

	test("a command that failed shows its error beside the targets", async () => {
		serve({
			targets: [plan("@stringsync/mdom", "patch")],
			errors: [{ command: "bin/net ship", error: "exited 1" }],
		});
		const view = render(<ShipsPage />);
		expect(await view.findByText("@stringsync/mdom")).toBeTruthy();
		expect(view.getByText(/exited 1/)).toBeTruthy();
	});

	/** Serves `listing` for the targets and answers each plan with `compose` of its picks. */
	const serveFlow = (
		listing: unknown,
		compose: (picks: { name: string; bump?: string }[]) => unknown,
	) => {
		const asked: unknown[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (String(url).includes("/api/ship/plan")) {
				const { picks } = JSON.parse(String(init?.body));
				asked.push(picks);
				return Response.json(compose(picks));
			}
			return Response.json(listing);
		}) as unknown as typeof fetch;
		return asked;
	};

	const composed = (
		waves: string[][],
		offered: { name: string; for: string[] }[] = [],
	) => ({
		waves,
		targets: waves.flat().map((name) => ({
			name,
			command: "bin/x ship",
			dependencies: [],
			steps: [
				{ id: "test", does: `Test ${name}` },
				{ id: "publish", does: `Publish ${name}`, dependencies: ["test"] },
			],
			waves: [["test"], ["publish"]],
		})),
		offered,
		errors: [],
	});

	test("Needed first offers each dependency, added at its bump unless skipped", async () => {
		const asked = serveFlow(
			{
				targets: [
					plan("@stringsync/mdom", "patch"),
					plan("net-staging"),
					plan("s2s-staging"),
				],
				errors: [],
			},
			(picks) =>
				picks.length === 1
					? composed(
							[["s2s-staging"]],
							[
								{ name: "@stringsync/mdom", for: ["s2s-staging"] },
								{ name: "net-staging", for: ["s2s-staging"] },
							],
						)
					: composed([
							picks.slice(0, -1).map((pick) => pick.name),
							["s2s-staging"],
						]),
		);
		const view = render(<ShipsPage />);
		fireEvent.click(await view.findByRole("checkbox", { name: "s2s-staging" }));
		fireEvent.click(view.getByRole("button", { name: "Next" }));

		await view.findByRole("checkbox", {
			name: "@stringsync/mdom",
		});
		expect(view.getAllByText(/s2s-staging depends on it/)).toHaveLength(2);
		fireEvent.click(view.getByRole("button", { name: "minor" }));
		const net = view.getByRole("checkbox", { name: "net-staging" });
		fireEvent.click(net);
		await waitFor(() => expect(net.getAttribute("aria-checked")).toBe("false"));
		expect(
			view
				.getByRole("checkbox", { name: "@stringsync/mdom" })
				.getAttribute("aria-checked"),
		).toBe("true");
		fireEvent.click(view.getByRole("button", { name: "Next" }));

		expect(await view.findByText("Review")).toBeTruthy();
		expect(asked[1]).toEqual([
			{ name: "@stringsync/mdom", bump: "minor" },
			{ name: "s2s-staging" },
		]);
		const first = view.getByRole("region", { name: "Step 1" });
		expect(within(first).getByText("Publish @stringsync/mdom")).toBeTruthy();
		expect(view.getByRole("region", { name: "Step 2" })).toBeTruthy();

		fireEvent.click(view.getByRole("button", { name: "Needed first" }));
		expect(await view.findByText("Needed first")).toBeTruthy();
		expect(
			view.getByText(/unshipped changes that your picks depend on/),
		).toBeTruthy();
	});

	test("Review shows every step in order, parallel ones grouped, with no Needed first when nothing is", async () => {
		serveFlow(
			{
				targets: [plan("@stringsync/mdom", "patch"), plan("net-staging")],
				errors: [],
			},
			() => composed([["@stringsync/mdom", "net-staging"]]),
		);
		const view = render(<ShipsPage />);
		fireEvent.click(await view.findByRole("checkbox", { name: "net-staging" }));
		fireEvent.click(view.getByRole("checkbox", { name: "@stringsync/mdom" }));
		fireEvent.click(view.getByRole("button", { name: "Next" }));

		const step = await view.findByRole("region", { name: "Step 1" });
		expect(within(step).getByText(/2 at the same time/)).toBeTruthy();
		const net = within(step).getByRole("article", { name: "net-staging" });
		const lines = [...net.querySelectorAll("li")].map((li) => li.textContent);
		expect(lines).toEqual(["Test net-staging", "Publish net-staging"]);

		fireEvent.click(view.getByRole("button", { name: "Ships" }));
		expect(
			await view.findByRole("checkbox", { name: "net-staging" }),
		).toBeTruthy();
	});

	test("the browser's Back moves one screen at a time", async () => {
		serveFlow({ targets: [plan("net-staging")], errors: [] }, () =>
			composed([["net-staging"]]),
		);
		const view = render(<ShipsPage />);
		fireEvent.click(await view.findByRole("checkbox", { name: "net-staging" }));
		fireEvent.click(view.getByRole("button", { name: "Next" }));
		expect(await view.findByText("Review")).toBeTruthy();

		history.back();
		expect(
			await view.findByRole("checkbox", { name: "net-staging" }),
		).toBeTruthy();
	});

	test("a plan the server refuses shows why and stays on the pick", async () => {
		globalThis.fetch = (async (url: string) =>
			String(url).includes("/api/ship/plan")
				? Response.json(
						{ error: "the targets depend on each other" },
						{ status: 400 },
					)
				: Response.json({
						targets: [plan("net-staging")],
						errors: [],
					})) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		fireEvent.click(await view.findByRole("checkbox", { name: "net-staging" }));
		fireEvent.click(view.getByRole("button", { name: "Next" }));
		expect(
			await view.findByText("the targets depend on each other"),
		).toBeTruthy();
		expect(view.getByRole("checkbox", { name: "net-staging" })).toBeTruthy();
	});

	/** Serves the pick, its plan, and `start` for the start route, recording what that was sent. */
	const serveStart = (start: Response) => {
		const started: unknown[] = [];
		const routes: Record<string, (init?: RequestInit) => Response> = {
			"/api/ship/plan": () => Response.json(composed([["net-staging"]])),
			"/api/ship/runs": (init) => {
				if (init?.method !== "POST") {
					return Response.json({ runs: [] });
				}
				started.push(JSON.parse(String(init?.body)).picks);
				return start;
			},
		};
		globalThis.fetch = (async (url: string, init?: RequestInit) =>
			(routes[String(url)] ?? (() => Response.json(listed)))(
				init,
			)) as unknown as typeof fetch;
		return started;
	};
	const listed = { targets: [plan("net-staging")], errors: [] };

	const reviewed = async (onRun: (id: string) => void = () => {}) => {
		const view = render(<ShipsPage onRun={onRun} />);
		fireEvent.click(await view.findByRole("checkbox", { name: "net-staging" }));
		fireEvent.click(view.getByRole("button", { name: "Next" }));
		fireEvent.click(await view.findByRole("button", { name: "Approve" }));
		return view;
	};

	test("Ship on Review starts the reviewed picks and opens the run", async () => {
		const started = serveStart(Response.json({ id: "run-1" }, { status: 201 }));
		const opened: string[] = [];
		await reviewed((id) => opened.push(id));
		await waitFor(() => expect(opened).toEqual(["run-1"]));
		expect(started).toEqual([[{ name: "net-staging" }]]);
	});

	test("a refused start shows its reason under the steps and Ship stays", async () => {
		serveStart(Response.json({ error: "a ship is running" }, { status: 409 }));
		const view = await reviewed();
		expect(await view.findByText("a ship is running")).toBeTruthy();
		expect(view.getByRole("button", { name: "Approve" })).toBeTruthy();
	});

	test("past runs are listed on the History page, each linking to its run, and the pick only links there", async () => {
		globalThis.fetch = (async (url: string) =>
			String(url) === "/api/ship/runs"
				? Response.json({
						runs: [
							{
								id: "run-2",
								started: Date.UTC(2026, 10, 15, 12),
								status: "failed",
								targets: [
									{ name: "net-staging", steps: [] },
									{ name: "s2s-staging", steps: [] },
								],
							},
						],
					})
				: Response.json(listed)) as unknown as typeof fetch;
		const pick = render(<ShipsPage />);
		expect(
			(await pick.findByRole("link", { name: /History/ })).getAttribute("href"),
		).toBe("#ships/history");
		pick.unmount();
		location.hash = "#ships/history";
		const view = render(<ShipsPage />);
		const runs = await view.findByRole("region", { name: "Runs" });
		const link = await within(runs).findByRole("link");
		expect(link.getAttribute("href")).toBe("#ships/run-2");
		expect(link.textContent).toContain("net-staging, s2s-staging");
		expect(link.textContent).toContain("Failed");
		location.hash = "";
	});

	test("a ship under way shows on top and holds Next, for one runs at a time", async () => {
		const asked: string[] = [];
		globalThis.fetch = (async (url: string) => {
			asked.push(String(url));
			return String(url) === "/api/ship/runs?status=running"
				? Response.json({
						runs: [
							{
								id: "run-3",
								started: Date.UTC(2026, 10, 16, 12),
								status: "running",
								notes: [],
								targets: [{ name: "net-staging", steps: [] }],
							},
						],
					})
				: Response.json(listed);
		}) as unknown as typeof fetch;
		const opened: string[] = [];
		const view = render(<ShipsPage onRun={(id) => opened.push(id)} />);
		await waitFor(() => expect(opened).toEqual(["run-3"]));
		const now = await view.findByRole("region", { name: "Shipping now" });
		expect(within(now).getByRole("link").getAttribute("href")).toBe(
			"#ships/run-3",
		);
		fireEvent.click(view.getByRole("checkbox", { name: "net-staging" }));
		expect(
			view.getByRole("button", { name: "Next" }).hasAttribute("disabled"),
		).toBe(true);
		expect(view.getByText(/One ship runs at a time/)).toBeTruthy();
		expect(asked).not.toContain("/api/ship/runs");
	});
	const serveNewest = (status: string) => {
		globalThis.fetch = (async (url: string) => {
			const run = {
				id: "run-9",
				started: Date.UTC(2026, 10, 16, 12),
				status,
				notes: [],
				targets: [{ name: "net-staging", steps: [] }],
			};
			if (String(url) === "/api/ship/runs?status=running") {
				return Response.json({ runs: [] });
			}
			return String(url) === "/api/ship/runs"
				? Response.json({ runs: [run] })
				: Response.json(listed);
		}) as unknown as typeof fetch;
	};

	test("opens the recap of a finished ship not yet seen, when none is running", async () => {
		localStorage.removeItem("splates.ships.recap-seen");
		serveNewest("done");
		const opened: string[] = [];
		render(<ShipsPage onRun={(id) => opened.push(id)} />);
		await waitFor(() => expect(opened).toEqual(["run-9"]));
	});

	test("stays on the index once the recap is seen or the newest ship was stopped", async () => {
		localStorage.setItem("splates.ships.recap-seen", "run-9");
		serveNewest("done");
		const opened: string[] = [];
		const view = render(<ShipsPage onRun={(id) => opened.push(id)} />);
		await view.findByRole("heading", { name: "Targets" });
		expect(opened).toEqual([]);
		cleanup();
		localStorage.removeItem("splates.ships.recap-seen");
		serveNewest("stopped");
		const again = render(<ShipsPage onRun={(id) => opened.push(id)} />);
		await again.findByRole("heading", { name: "Targets" });
		expect(opened).toEqual([]);
		localStorage.removeItem("splates.ships.recap-seen");
	});

	test("a failed newest ship stays active: opened, listed with its bar, and Next still works", async () => {
		localStorage.setItem("splates.ships.recap-seen", "run-9");
		serveNewest("failed");
		const opened: string[] = [];
		const view = render(<ShipsPage onRun={(id) => opened.push(id)} />);
		await waitFor(() => expect(opened).toEqual(["run-9"]));
		const now = await view.findByRole("region", { name: "Shipping now" });
		expect(within(now).getByRole("progressbar")).toBeTruthy();
		expect(within(now).getByText(/Failed/)).toBeTruthy();
		fireEvent.click(view.getByRole("checkbox", { name: "net-staging" }));
		expect(
			view.getByRole("button", { name: "Next" }).hasAttribute("disabled"),
		).toBe(false);
	});

	test("Approve still starts the ship and opens it while a failed ship is the newest", async () => {
		localStorage.setItem("splates.ships.recap-seen", "run-9");
		const failed = {
			id: "run-9",
			started: 1,
			status: "failed",
			notes: [],
			targets: [{ name: "net-staging", steps: [] }],
		};
		const started: unknown[] = [];
		const routes: Record<string, (init?: RequestInit) => Response> = {
			"/api/ship/plan": () => Response.json(composed([["net-staging"]])),
			"/api/ship/runs?status=running": () => Response.json({ runs: [] }),
			"/api/ship/runs": (init) => {
				started.push(init?.method ?? "GET");
				return init?.method === "POST"
					? Response.json(
							{ ...failed, id: "run-10", status: "running" },
							{ status: 201 },
						)
					: Response.json({ runs: [failed] });
			},
		};
		globalThis.fetch = (async (url: string, init?: RequestInit) =>
			(routes[String(url)] ?? (() => Response.json(listed)))(
				init,
			)) as unknown as typeof fetch;
		const opened: string[] = [];
		const view = render(<ShipsPage onRun={(id) => opened.push(id)} />);
		await waitFor(() => expect(opened).toEqual(["run-9"]));
		fireEvent.click(await view.findByRole("checkbox", { name: "net-staging" }));
		fireEvent.click(view.getByRole("button", { name: "Next" }));
		fireEvent.click(await view.findByRole("button", { name: "Approve" }));
		await waitFor(() => expect(opened).toEqual(["run-9", "run-10"]));
		expect(started).toContain("POST");
		localStorage.removeItem("splates.ships.recap-seen");
	});
});

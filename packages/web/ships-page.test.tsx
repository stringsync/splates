import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SHIP_BUS } from "./ship-run-bus";
import { ShipsPage } from "./ships-page";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";

const realFetch = globalThis.fetch;

const plan = (name: string, bump?: "patch" | "minor" | "major") => ({
	command: "bin/x ship",
	plan: { name, ...(bump ? { bump } : {}), dependencies: [], steps: [] },
});

describe("ShipsPage", () => {
	beforeEach(() => {
		// A run URL from an earlier test tells the history listener to ignore Back.
		history.replaceState(null, "", "#ships");
	});

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
		expect(view.queryByRole("combobox", { name: /bump/ })).toBeNull();
		const next = view.getByRole("button", { name: "Next" });
		expect(next.hasAttribute("disabled")).toBe(true);

		fireEvent.click(view.getByRole("checkbox", { name: "net-staging" }));
		await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));
		expect(view.queryByRole("combobox", { name: /bump/ })).toBeNull();
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

		const mdom = (await view.findByRole("combobox", {
			name: "@stringsync/mdom's bump",
		})) as HTMLSelectElement;
		expect(mdom.value).toBe("minor");

		fireEvent.change(mdom, { target: { value: "major" } });
		await waitFor(() => expect(mdom.value).toBe("major"));
		const vexml = view.getByRole("combobox", {
			name: "@stringsync/vexml's bump",
		}) as HTMLSelectElement;
		expect(vexml.value).toBe("patch");

		fireEvent.click(view.getByRole("checkbox", { name: "@stringsync/mdom" }));
		await waitFor(() =>
			expect(
				view.queryByRole("combobox", { name: "@stringsync/mdom's bump" }),
			).toBeNull(),
		);
	});

	test("lists the targets before the unshipped counts come, then shows each", async () => {
		let count: (counts: unknown) => void = () => {};
		const counted = new Promise<unknown>((resolve) => {
			count = resolve;
		});
		globalThis.fetch = (async (url: string) =>
			String(url).includes("/api/ship/unshipped")
				? Response.json(await counted)
				: Response.json({
						targets: [plan("@stringsync/mdom", "patch"), plan("net-staging")],
						errors: [],
					})) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(await view.findByText("@stringsync/mdom")).toBeTruthy();
		expect(view.queryByText(/since last ship/)).toBeNull();
		fireEvent.click(view.getByRole("checkbox", { name: "net-staging" }));
		const next = view.getByRole("button", { name: "Next" });
		await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));

		count({ "@stringsync/mdom": 3, "net-staging": 1 });
		expect(await view.findByText(/3 commits since last ship/)).toBeTruthy();
	});

	test("a count that fails leaves the targets without counts", async () => {
		globalThis.fetch = (async (url: string) =>
			String(url).includes("/api/ship/unshipped")
				? new Response("boom", { status: 500 })
				: Response.json({
						targets: [plan("@stringsync/mdom", "patch")],
						errors: [],
					})) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(await view.findByText("@stringsync/mdom")).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(view.queryByText(/since last ship/)).toBeNull();
		expect(view.queryByText(/boom/)).toBeNull();
	});

	test("shows each target's current version once read, without holding the targets", async () => {
		let read: (versions: unknown) => void = () => {};
		const versions = new Promise<unknown>((resolve) => {
			read = resolve;
		});
		globalThis.fetch = (async (url: string) =>
			String(url).includes("/api/ship/current")
				? Response.json(await versions)
				: Response.json({
						targets: [plan("@stringsync/mdom", "patch"), plan("net-staging")],
						errors: [],
					})) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(await view.findByText("@stringsync/mdom")).toBeTruthy();
		expect(view.queryByText(/current /)).toBeNull();
		fireEvent.click(view.getByRole("checkbox", { name: "net-staging" }));
		const next = view.getByRole("button", { name: "Next" });
		await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));

		read({ "@stringsync/mdom": "1.4.2" });
		expect(await view.findByText(/current 1\.4\.2/)).toBeTruthy();
	});

	test("a current version that fails to read leaves the targets without one", async () => {
		globalThis.fetch = (async (url: string) =>
			String(url).includes("/api/ship/current")
				? new Response("boom", { status: 500 })
				: Response.json({
						targets: [plan("@stringsync/mdom", "patch")],
						errors: [],
					})) as unknown as typeof fetch;
		const view = render(<ShipsPage />);
		expect(await view.findByText("@stringsync/mdom")).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(view.queryByText(/current /)).toBeNull();
		expect(view.queryByText(/boom/)).toBeNull();
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
		fireEvent.change(
			view.getByRole("combobox", { name: "@stringsync/mdom's bump" }),
			{ target: { value: "minor" } },
		);
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
		const first = view.getByRole("region", { name: "Group 1" });
		expect(
			within(first).getByRole("article", { name: "@stringsync/mdom" }),
		).toBeTruthy();
		expect(view.getByRole("region", { name: "Group 2" })).toBeTruthy();

		fireEvent.click(view.getByRole("button", { name: "Needed first" }));
		expect(await view.findByText("Needed first")).toBeTruthy();
		expect(
			view.getByText(/Your picks depend on unshipped changes here/),
		).toBeTruthy();
	});

	test("Review shows the groups in order, parallel ones together, with no Needed first when nothing is", async () => {
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

		const group = await view.findByRole("region", { name: "Group 1" });
		expect(within(group).getByText(/2 at the same time/)).toBeTruthy();
		const net = within(group).getByRole("article", { name: "net-staging" });
		expect(net.querySelectorAll("li")).toHaveLength(0);

		fireEvent.click(view.getByRole("button", { name: "Ships" }));
		expect(
			await view.findByRole(
				"checkbox",
				{ name: "net-staging" },
				{ timeout: 25_000 },
			),
		).toBeTruthy();
	}, 60_000);

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
	}, 30_000);

	test("Approve stays on the run it opened when the browser reports the move before its state", async () => {
		const running = {
			id: "run-1",
			started: 1,
			status: "running",
			notes: [],
			targets: [{ name: "net-staging", steps: [] }],
		};
		const routes: Record<string, (init?: RequestInit) => Response> = {
			"/api/ship/plan": () => Response.json(composed([["net-staging"]])),
			"/api/ship/runs?status=running": () => Response.json({ runs: [] }),
			"/api/ship/runs?limit=1": () => Response.json({ runs: [] }),
			"/api/ship/runs": (init) =>
				init?.method === "POST"
					? Response.json(running, { status: 201 })
					: Response.json({ runs: [] }),
		};
		globalThis.fetch = (async (url: string, init?: RequestInit) =>
			(routes[String(url)] ?? (() => Response.json(listed)))(
				init,
			)) as unknown as typeof fetch;
		const back = history.back;
		let backs = 0;
		// vet-ignore no-monkeypatching: verifies useShipHistory does not call history.back during run navigation; restored in finally
		history.back = () => {
			backs++;
		};
		const opened: string[] = [];
		try {
			const view = render(
				<ShipsPage
					onRun={(id) => {
						opened.push(id);
						// As WebKit does inside location.replace: the run's
						// address, still with the Review entry's state.
						history.replaceState(history.state, "", `#ships/${id}`);
						window.dispatchEvent(new PopStateEvent("popstate"));
					}}
				/>,
			);
			fireEvent.click(
				await view.findByRole("checkbox", { name: "net-staging" }),
			);
			fireEvent.click(view.getByRole("button", { name: "Next" }));
			fireEvent.click(await view.findByRole("button", { name: "Approve" }));
			await waitFor(() => expect(opened).toEqual(["run-1"]));
			expect(backs).toBe(0);
		} finally {
			history.back = back;
			history.replaceState(null, "", "#");
		}
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
	/** Every body the start route was sent, as `serveStart` records them. */
	let startBodies: unknown[] = [];
	const serveStart = (start: Response) => {
		const started: unknown[] = [];
		startBodies = [];
		const routes: Record<string, (init?: RequestInit) => Response> = {
			"/api/ship/plan": () => Response.json(composed([["net-staging"]])),
			"/api/ship/runs?limit=1": () => Response.json({ runs: [] }),
			"/api/ship/runs": (init) => {
				if (init?.method !== "POST") {
					return Response.json({ runs: [] });
				}
				startBodies.push(JSON.parse(String(init?.body)));
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
	test("a versioned target picks a bump or an exact version, and Approve ships the reviewed version", async () => {
		const versioned = (name: string, version?: string) => ({
			command: "bin/s2s ship",
			plan: {
				name,
				versioned: true,
				...(version && { version }),
				dependencies: [],
				steps: [],
			},
		});
		const planned: unknown[] = [];
		const started: unknown[] = [];
		const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body)).picks;
		const start = (init: RequestInit) => {
			started.push(bodyOf(init));
			return Response.json(
				{ id: "run-1", started: 1, status: "running", notes: [], targets: [] },
				{ status: 201 },
			);
		};
		const routes: Record<string, (init?: RequestInit) => Response> = {
			"/api/ship/plan": (init) => {
				planned.push(bodyOf(init));
				return Response.json({
					waves: [["staging", "prod"]],
					targets: [
						{
							name: "staging",
							command: "bin/s2s ship",
							bump: "minor",
							version: "0.2.0",
							dependencies: [],
							steps: [],
							waves: [],
						},
						{
							name: "prod",
							command: "bin/s2s ship",
							version: "0.1.4",
							dependencies: [],
							steps: [],
							waves: [],
						},
					],
					offered: [],
					errors: [],
				});
			},
			"/api/ship/runs?status=running": () => Response.json({ runs: [] }),
			"/api/ship/runs?limit=1": () => Response.json({ runs: [] }),
			"/api/ship/runs": (init) =>
				init?.method === "POST" ? start(init) : Response.json({ runs: [] }),
		};
		const listing = {
			targets: [versioned("staging", "0.1.4"), versioned("prod")],
			errors: [],
		};
		globalThis.fetch = (async (url: string, init?: RequestInit) =>
			(routes[String(url)] ?? (() => Response.json(listing)))(
				init,
			)) as unknown as typeof fetch;
		try {
			const view = render(<ShipsPage onRun={() => {}} />);
			fireEvent.click(await view.findByRole("checkbox", { name: "staging" }));
			fireEvent.click(view.getByRole("checkbox", { name: "prod" }));

			const bump = (await view.findByRole("combobox", {
				name: "staging's bump",
			})) as HTMLSelectElement;
			expect(bump.value).toBe("default");
			fireEvent.change(bump, { target: { value: "minor" } });
			// prod resolves no version by itself, so it waits on one typed in.
			const version = view.getByRole("textbox", { name: "prod's version" });
			const next = view.getByRole("button", { name: "Next" });
			expect(next.hasAttribute("disabled")).toBe(true);
			fireEvent.change(version, { target: { value: "0.1.4" } });
			await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));

			fireEvent.click(next);
			expect(await view.findByText(/0\.2\.0 \(minor\)/)).toBeTruthy();
			expect(planned).toEqual([
				[
					{ name: "staging", bump: "minor" },
					{ name: "prod", version: "0.1.4" },
				],
			]);
			fireEvent.click(view.getByRole("button", { name: "Approve" }));
			await waitFor(() =>
				expect(started).toEqual([
					[
						{ name: "staging", version: "0.2.0" },
						{ name: "prod", version: "0.1.4" },
					],
				]),
			);
		} finally {
			history.replaceState(null, "", "#");
		}
	});

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

	test("Review starts the ship supervised with 5 fixes, the count set by − and +, or unsupervised when switched off", async () => {
		serveStart(Response.json({ id: "run-1" }, { status: 201 }));
		const bodies = startBodies;
		const view = render(<ShipsPage />);
		const review = async () => {
			fireEvent.click(
				await view.findByRole("checkbox", { name: "net-staging" }),
			);
			fireEvent.click(view.getByRole("button", { name: "Next" }));
			return view.findByRole("region", { name: "Supervise" });
		};
		const card = await review();
		expect(
			within(card).getByRole("status", { name: "Fixes" }).textContent,
		).toBe("5");
		fireEvent.click(within(card).getByRole("button", { name: "More fixes" }));
		fireEvent.click(view.getByRole("button", { name: "Approve" }));
		await waitFor(() => expect(bodies).toHaveLength(1));
		expect(bodies[0]).toEqual({
			picks: [{ name: "net-staging" }],
			supervise: { budget: 6 },
			autoApprove: true,
		});

		fireEvent.click(
			within(await review()).getByRole("switch", { name: "Supervise" }),
		);
		fireEvent.click(view.getByRole("switch", { name: "Auto-approve" }));
		fireEvent.click(view.getByRole("button", { name: "Approve" }));
		await waitFor(() => expect(bodies).toHaveLength(2));
		expect(bodies[1]).toEqual({
			picks: [{ name: "net-staging" }],
			autoApprove: false,
		});
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
		expect(asked).not.toContain("/api/ship/runs?limit=1");
	});

	test("a ship that ended while the stream was down stops holding Next once it is back", async () => {
		const run = {
			id: "run-3",
			started: Date.UTC(2026, 10, 16, 12),
			status: "running",
			notes: [],
			targets: [{ name: "net-staging", steps: [] }],
		};
		let runs = [run];
		globalThis.fetch = (async (url: string) =>
			String(url) === "/api/ship/runs?status=running"
				? Response.json({ runs })
				: String(url) === "/api/ship/runs?limit=1"
					? Response.json({ runs: [{ ...run, status: "done" }] })
					: Response.json(listed)) as unknown as typeof fetch;
		const view = render(<ShipsPage onRun={() => {}} />);
		await view.findByRole("region", { name: "Shipping now" });
		fireEvent.click(view.getByRole("checkbox", { name: "net-staging" }));
		expect(view.getByText(/One ship runs at a time/)).toBeTruthy();
		// The run's last push went unsaid while the stream was down.
		runs = [];
		SHIP_BUS.dispatch("open", true);
		await waitFor(() =>
			expect(view.queryByRole("region", { name: "Shipping now" })).toBeNull(),
		);
		expect(view.queryByText(/One ship runs at a time/)).toBeNull();
		expect(
			view.getByRole("button", { name: "Next" }).hasAttribute("disabled"),
		).toBe(false);
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
			return String(url) === "/api/ship/runs?limit=1"
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
		await view.findByRole("button", { name: "Next" });
		expect(opened).toEqual([]);
		cleanup();
		localStorage.removeItem("splates.ships.recap-seen");
		serveNewest("stopped");
		const again = render(<ShipsPage onRun={(id) => opened.push(id)} />);
		await again.findByRole("button", { name: "Next" });
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
			"/api/ship/runs?limit=1": () => Response.json({ runs: [failed] }),
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

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SignalOverview } from "@splates/server/signals";
import { SignalsPage, signalsAt } from "./signals-page";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";

describe("signals page", () => {
	const real = globalThis.fetch;
	beforeEach(() => {
		location.hash = "#signals";
		globalThis.fetch = (async () =>
			Response.json({
				signals: SIGNALS,
				subscribers: 0,
			})) as unknown as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = real;
		cleanup();
	});

	it("reads which signal or check form the address shows", () => {
		expect(signalsAt("#signals")).toEqual({
			check: null,
			signal: null,
			subscriptions: false,
		});
		expect(signalsAt("#signals/new")).toEqual({
			check: "new",
			signal: null,
			subscriptions: false,
		});
		expect(signalsAt("#signals/mono.task.done")).toEqual({
			check: null,
			signal: "mono.task.done",
			subscriptions: false,
		});
		expect(signalsAt("#signals/mono.task.done/check")).toEqual({
			check: "mono.task.done",
			signal: null,
			subscriptions: false,
		});
		expect(signalsAt("#signals/subscriptions")).toEqual({
			check: null,
			signal: null,
			subscriptions: true,
		});
	});

	it("cleans up idle signals and revives a hidden one", async () => {
		const calls: string[] = [];
		let hidden = [{ name: "mono.old.poll", at: new Date().toISOString() }];
		globalThis.fetch = (async (input: Request | string | URL) => {
			const url =
				typeof input === "object" && "url" in input ? input.url : input;
			calls.push(String(url));
			if (String(url).includes("/cleanup")) {
				return Response.json({ removed: ["mono.a", "mono.b"] });
			}
			if (String(url).includes("/revive")) {
				hidden = [];
				return Response.json({ name: "mono.old.poll", revived: true });
			}
			return Response.json({ signals: SIGNALS, hidden, subscribers: 0 });
		}) as unknown as typeof fetch;
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		await page.findByRole("region", { name: "project mono" });
		fireEvent.click(page.getByRole("button", { name: "Clean up idle" }));
		expect(await page.findByText("Hid 2 idle signals.")).toBeTruthy();
		fireEvent.click(await page.findByRole("button", { name: /Hidden \(1\)/ }));
		fireEvent.click(
			await page.findByRole("button", { name: "Revive mono.old.poll" }),
		);
		await waitFor(() =>
			expect(page.queryByRole("region", { name: "hidden signals" })).toBeNull(),
		);
		expect(calls.some((each) => each.includes("/revive"))).toBe(true);
	});

	it("lists each signal in its project's card, a family folded to one row that opens to its signals", async () => {
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		const card = await page.findByRole("region", { name: "project mono" });
		expect(page.queryByRole("region", { name: /^signal / })).toBeNull();
		const family = within(card).getByRole("button", {
			name: "mono.task, 2 signals",
		});
		expect(family.getAttribute("aria-expanded")).toBe("false");
		expect(
			page.queryByRole("link", { name: "signal mono.task.started" }),
		).toBeNull();
		fireEvent.click(family);
		const started = await page.findByRole("link", {
			name: "signal mono.task.started",
		});
		expect(started.getAttribute("href")).toBe("#signals/mono.task.started");
		expect(started.textContent).toContain("Fired by splates");
	});

	it("filters the list by name, opening the families that match", async () => {
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		fireEvent.change(await page.findByLabelText("Filter signals"), {
			target: { value: "done" },
		});
		expect(
			await page.findByRole("link", { name: "signal mono.task.done" }),
		).toBeTruthy();
		expect(
			page.queryByRole("link", { name: "signal mono.task.started" }),
		).toBeNull();
	});

	it("puts the last poll's outcome and when it ran on top of a polled signal's page", async () => {
		location.hash = "#signals/s2s.prod-at-edge";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		const glance = await page.findByRole("status", { name: "how it stands" });
		expect(glance.textContent).toContain("Not yet");
		expect(glance.textContent).toContain("Last poll 2m ago");
		expect(glance.textContent).toContain("no edge-aliases failure yet");
		expect(page.queryByText("Firings per day")).toBeNull();
	});

	it("shows what a signal means when it fires above how it stands", async () => {
		location.hash = "#signals/s2s.prod-at-edge";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		await page.findByRole("status", { name: "how it stands" });
		expect(page.getByText("Fires when")).toBeTruthy();
		expect(page.getByText("prod ship parked at edge-aliases")).toBeTruthy();
	});

	it("polls now from Poll history, disabled while the poll runs", async () => {
		const posts: string[] = [];
		let finish = () => {};
		const answers: Record<string, (init?: RequestInit) => Promise<Response>> = {
			"/api/signals/poll-now": async (init) => {
				posts.push(String(init?.body));
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
				return Response.json({});
			},
		};
		const list = async () =>
			Response.json({ signals: SIGNALS, subscribers: 0 });
		globalThis.fetch = (async (url: string, init?: RequestInit) =>
			(answers[new URL(url, "http://page").pathname] ?? list)(
				init,
			)) as unknown as typeof fetch;
		location.hash = "#signals/s2s.prod-at-edge";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		fireEvent.click(await page.findByRole("button", { name: "Poll history" }));
		fireEvent.click(await page.findByRole("button", { name: "Poll now" }));
		const busy = await page.findByRole("button", { name: "Polling…" });
		expect(busy.hasAttribute("disabled")).toBe(true);
		expect(JSON.parse(posts[0] ?? "{}")).toEqual({ name: "s2s.prod-at-edge" });
		finish();
		expect(await page.findByRole("button", { name: "Poll now" })).toBeTruthy();
	});

	it("lists each poll in Poll history, a row opening to what it printed", async () => {
		location.hash = "#signals/s2s.prod-at-edge";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		fireEvent.click(await page.findByRole("button", { name: "Poll history" }));
		const table = await page.findByRole("table", { name: "polls" });
		const rows = within(table).getAllByRole("button", { name: /^poll / });
		expect(rows.map((row) => row.closest("tr")?.textContent)).toEqual([
			"2m agoNot yet2.4sPoll now",
			"3m agoNot yet",
		]);
		fireEvent.click(rows[0] as HTMLElement);
		expect(within(table).getByText("stderr")).toBeTruthy();
		expect(within(table).getByText("(nothing)")).toBeTruthy();
		fireEvent.click(rows[1] as HTMLElement);
		expect(within(table).getByText("Output")).toBeTruthy();
	});

	it("shows a signal's firings once its Firings row opens", async () => {
		location.hash = "#signals/mono.task.started";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		const glance = await page.findByRole("status", { name: "how it stands" });
		expect(glance.textContent).toContain("By splates · 2 times this week");
		fireEvent.click(page.getByRole("button", { name: "Firings" }));
		expect(await page.findByText("Firings per day")).toBeTruthy();
		expect(page.getByRole("img", { name: "Today: 2 firings" })).toBeTruthy();
		expect(page.getByRole("link", { name: "#3149" }).getAttribute("href")).toBe(
			"#todos/3149",
		);
	});

	it("returns from a signal deep link to the index through the breadcrumb", async () => {
		location.hash = "#signals/mono.task.done";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		await page.findByRole("region", { name: "signal mono.task.done" });
		fireEvent.click(page.getByRole("button", { name: "Signals" }));
		await waitFor(() => expect(location.hash).toBe("#signals"));
		await waitFor(() =>
			expect(page.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull(),
		);
	});

	it("groups a signal's automations and waiting conversations apart, counting each on its list row", async () => {
		const wait = {
			kind: "wait" as const,
			id: "w1",
			label: "vexml upgrade",
			state: "waiting" as const,
			live: true,
			conversation: "c1",
			title: "vexml-upgrade",
		};
		const automation = {
			kind: "automation" as const,
			id: "a1",
			label: "Ship vexml",
			state: "active" as const,
			live: true,
			project: "mono",
		};
		globalThis.fetch = (async () =>
			Response.json({
				signals: [{ ...SIGNALS[1], subscribers: [automation, wait] }],
				subscribers: 2,
			})) as unknown as typeof fetch;
		const again = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		const row = await again.findByRole("link", {
			name: "signal mono.task.started",
		});
		expect(row.textContent).toContain("1 waiting · 1 automation");
		again.unmount();
		location.hash = "#signals/mono.task.started";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		const glance = await page.findByRole("status", { name: "how it stands" });
		expect(glance.textContent).toContain("2subscribers");
		fireEvent.click(page.getByRole("button", { name: "Subscribers" }));
		const list = await page.findByRole("region", { name: "subscribers" });
		const rows = within(list).getAllByRole("listitem");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain("Automation");
		expect(rows[0]?.textContent).toContain("Ship vexml");
		expect(rows[1]?.textContent).toContain("Wait");
		expect(rows[1]?.textContent).toContain("vexml-upgrade");
	});

	it("opens a firing to its raw payload", async () => {
		location.hash = "#signals/mono.task.started";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		fireEvent.click(await page.findByRole("button", { name: "Firings" }));
		fireEvent.click(await page.findByText("proposal-as-question"));
		expect(page.getByText(/"task": "proposal-as-question"/)).toBeTruthy();
	});

	it("adds an automation on the shown signal, its trigger fixed to it", async () => {
		const posts: unknown[] = [];
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			posts.push(init?.body);
			return Response.json({
				signals: SIGNALS,
				automations: [],
				subscribers: 0,
			});
		}) as unknown as typeof fetch;
		location.hash = "#signals/mono.task.started";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		fireEvent.click(await page.findByRole("button", { name: "More actions" }));
		fireEvent.click(
			await page.findByRole("menuitem", { name: /Add automation/ }),
		);
		expect(page.queryByLabelText("When")).toBeNull();
		fireEvent.change(page.getByLabelText("Runs"), {
			target: { value: "run" },
		});
		fireEvent.change(page.getByLabelText("Command"), {
			target: { value: "echo hi" },
		});
		fireEvent.click(page.getByRole("button", { name: "Add" }));
		await waitFor(() =>
			expect(posts.filter((each) => each !== undefined)).toHaveLength(1),
		);
		expect(
			JSON.parse(String(posts.find((each) => each !== undefined))),
		).toMatchObject({
			trigger: { signal: "mono.task.started" },
			hook: { kind: "run", command: "echo hi" },
		});
	});

	it("shows the signal the address names", async () => {
		location.hash = "#signals/mono.task.done";
		const page = render(
			<SignalsPage
				onOpen={() => {}}
				opens={{ todo: () => {}, task: () => {} }}
			/>,
		);
		expect(
			await page.findByRole("region", { name: "signal mono.task.done" }),
		).toBeTruthy();
	});
});

const ago = (minutes: number) =>
	new Date(Date.now() - minutes * 60_000).toISOString();

const SIGNALS: SignalOverview[] = [
	{
		name: "s2s.prod-at-edge",
		description: "prod ship parked at edge-aliases",
		project: "s2s",
		probe: {
			name: "s2s.prod-at-edge",
			description: "prod ship parked at edge-aliases",
			script: "splates ships list | grep edge-aliases",
			everyMs: 60_000,
			cwd: "/repo",
			conversation: "c9",
			state: "running",
			startedAt: ago(30),
			deadline: new Date(Date.now() + 3 * 3_600_000).toISOString(),
			passed: false,
			subscribed: true,
			count: 2,
			runs: [
				{ at: ago(3), exit: 1, output: "" },
				{
					at: ago(2),
					exit: 1,
					output: "no edge-aliases failure yet",
					ms: 2_400,
					startedBy: "poll now",
					fired: false,
					stdout: "",
					stderr: "no edge-aliases failure yet",
				},
			],
		},
		subscribers: [],
		raises: [],
	},
	{
		name: "mono.task.started",
		project: "mono",
		probe: null,
		subscribers: [],
		raises: [
			{
				at: ago(0.2),
				by: "splates",
				payload: { numbers: [], task: "eval-judge-picker" },
			},
			{
				at: ago(0.3),
				by: "splates",
				payload: { numbers: [3149], task: "proposal-as-question" },
			},
		],
	},
	{
		name: "mono.task.done",
		project: "mono",
		probe: null,
		subscribers: [],
		raises: [
			{ at: ago(0.25), by: "splates", payload: { task: "signal-dot-names" } },
		],
	},
];

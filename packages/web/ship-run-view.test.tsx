import { afterEach, describe, expect, test } from "bun:test";
import type { Prompt, RunEvent, RunState } from "@splates/server/ship";
import type { ReactNode } from "react";
import type { StreamHandlers } from "./live-stream";
import type { ShipRunServer } from "./ship-run";
import { SHIP_BUS } from "./ship-run-bus";
import { ShipRunScreen } from "./ship-run-view";
import {
	ShipStepPane,
	type ShipStepRef,
	WatchShipStep,
} from "./ship-step-pane";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";

let opened: ShipStepRef[] = [];
const Provider = ({ children }: { children: ReactNode }) => (
	<WatchShipStep value={(step) => opened.push(step)}>{children}</WatchShipStep>
);

describe("ShipRunScreen", () => {
	afterEach(() => {
		opened = [];
		cleanup();
	});

	test("shows the steps in order, each target waiting, then live as it runs", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		expect(view.getByText("Reading the run…")).toBeTruthy();
		await fake.open(run());

		const first = view.getByRole("region", { name: "Step 1" });
		expect(within(first).getByText(/2 at the same time/)).toBeTruthy();
		const second = view.getByRole("region", { name: "Step 2" });
		expect(within(second).getByText("Starts when step 1 is done")).toBeTruthy();
		expect(view.getByText(/0 of 3 done/)).toBeTruthy();

		await fake.send(
			{ type: "checking", at: 2_000, ...at, step: "build" },
			{ type: "running", at: 2_000, ...at, step: "build", pid: 7 },
			{ type: "update", ...at, step: "build", line: "Bundling" },
		);
		const mdom = view.getByRole("article", { name: "@stringsync/mdom" });
		expect(mdom.dataset.status).toBe("running");
		expect(within(mdom).getByText("Bundling")).toBeTruthy();

		await fake.send(
			{ type: "ended", at: 3_000, ...at, step: "build", outcome: "done" },
			{ type: "checking", at: 3_000, ...at, step: "publish" },
			{ type: "running", at: 3_000, ...at, step: "publish", pid: 8 },
			{ type: "update", ...at, step: "publish", line: "Published 0.8.18" },
			{ type: "ended", at: 75_000, ...at, step: "publish", outcome: "done" },
		);
		expect(mdom.dataset.status).toBe("done");
		expect(within(mdom).getByText("Published 0.8.18")).toBeTruthy();
		expect(within(mdom).getByText("1m 13s")).toBeTruthy();
		expect(view.getByText(/1 of 3 done/)).toBeTruthy();
	});

	test("a target's steps sit on a rail, the running one with its update and the tail of its output", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />, {
			wrapper: Provider,
		});
		await fake.open(run());
		await fake.send(
			{ type: "checking", at: 2_000, ...at, step: "build" },
			{ type: "running", at: 2_000, ...at, step: "build", pid: 7 },
			{ type: "update", ...at, step: "build", line: "Bundling" },
			{ type: "output", ...at, step: "build", text: "compiled 12 files\n" },
		);
		const mdom = view.getByRole("article", { name: "@stringsync/mdom" });
		const rail = within(mdom).getByRole("list", { name: "Steps" });
		const running = rail.querySelector("[data-status=running]");
		expect(running).not.toBeNull();
		expect(within(running as HTMLElement).getByText("Bundling")).toBeTruthy();
		expect(within(rail).queryByRole("log")).toBeNull();
		fireEvent.click(within(running as HTMLElement).getByRole("button"));
		expect(opened).toHaveLength(1);
		expect(opened[0]?.initial.output.join("")).toContain("compiled 12 files");
	});

	test("the pane names the step and closes on Escape", () => {
		let closed = 0;
		const step = {
			id: "build",
			does: "Build",
			dependencies: [],
			status: "running",
			output: ["one", "two", ""],
		} as unknown as ShipStepRef["initial"];
		const pane = render(
			<ShipStepPane
				step={{ run: "run-1", target: "t", step: "build", initial: step }}
				phone={false}
				onClose={() => {
					closed++;
				}}
			/>,
		);
		expect(pane.getByRole("heading", { name: "Build" })).toBeTruthy();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(closed).toBe(1);
	});

	test("a failed target says why and offers Retry, which retries its step", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		await fake.send(
			{ type: "checking", at: 2_000, target: "net-staging", step: "deploy" },
			{
				type: "ended",
				at: 5_000,
				target: "net-staging",
				step: "deploy",
				outcome: "failed",
				error: "Stack rolled back: SecurityGroup in use\nmore",
			},
		);
		const net = view.getByRole("article", { name: "net-staging" });
		expect(net.dataset.status).toBe("failed");
		expect(
			within(net).getByText("Stack rolled back: SecurityGroup in use"),
		).toBeTruthy();
		fireEvent.click(within(net).getByRole("button", { name: "Retry" }));
		expect(fake.retried).toEqual(["net-staging deploy"]);
		await waitFor(() =>
			expect(
				within(net)
					.getByRole("button", { name: "Retry" })
					.hasAttribute("disabled"),
			).toBe(false),
		);
	});

	test("Send to agent sends a failed step, and the card says who fixes it until the fix merges", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		const deploy = { target: "net-staging", step: "deploy" };
		await fake.send(
			{ type: "checking", at: 2_000, ...deploy },
			{ type: "ended", at: 5_000, ...deploy, outcome: "failed", error: "No" },
		);
		const net = view.getByRole("article", { name: "net-staging" });
		fireEvent.click(within(net).getByRole("button", { name: "Send to agent" }));
		expect(fake.sent).toEqual(["net-staging deploy"]);

		await fake.send({ type: "sent", at: 6_000, ...deploy, task: 42 });
		expect(within(net).getByText(/An agent is fixing deploy in/)).toBeTruthy();
		expect(
			within(net).getByRole("link", { name: "#42" }).getAttribute("href"),
		).toBe("#todos/42");
		expect(
			within(net).queryByRole("button", { name: "Send to agent" }),
		).toBeNull();
		expect(within(net).getByRole("button", { name: "Retry" })).toBeTruthy();

		await fake.send(
			{ type: "fixed", at: 9_000, ...deploy, task: 42, outcome: "merged" },
			{ type: "retried", at: 9_000, ...deploy, by: "fix" },
			{ type: "checking", at: 9_000, ...deploy },
		);
		expect(net.dataset.status).toBe("running");
		expect(
			within(net).getByText("deploy was fixed in #42 and retried."),
		).toBeTruthy();
	});

	test("a fix removed without merging leaves the step failed, to send again", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		const deploy = { target: "net-staging", step: "deploy" };
		await fake.send(
			{ type: "checking", at: 2_000, ...deploy },
			{ type: "ended", at: 5_000, ...deploy, outcome: "failed", error: "No" },
			{ type: "sent", at: 6_000, ...deploy, task: 42 },
			{ type: "fixed", at: 7_000, ...deploy, task: 42, outcome: "removed" },
		);
		const net = view.getByRole("article", { name: "net-staging" });
		expect(within(net).getByText(/was removed without merging/)).toBeTruthy();
		expect(
			within(net).getByRole("button", { name: "Send to agent" }),
		).toBeTruthy();
	});

	test("a reopened stream shows the run where it now stands", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		await fake.drop();
		expect(view.getByText(/Reconnecting/)).toBeTruthy();

		const [mdom, ...rest] = run().targets;
		const shipped = { status: "done" as const, started: 2_000, ended: 4_000 };
		await fake.open({
			...run(),
			targets: [
				{
					...mdom,
					steps: [
						{ ...step("build"), ...shipped },
						{ ...step("publish", ["build"]), ...shipped },
					],
				},
				...rest,
			] as RunState["targets"],
		});
		expect(view.queryByText(/Reconnecting/)).toBeNull();
		expect(
			view.getByRole("article", { name: "@stringsync/mdom" }).dataset.status,
		).toBe("done");
	});

	test("a step that asks Yes or No opens in place, and the answer goes back", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		await fake.send(
			{ type: "checking", at: 2_000, ...at, step: "build" },
			{ type: "running", at: 2_000, ...at, step: "build", pid: 7 },
			prompt("p1", { kind: "confirm", question: "Publish 1.4.0 to npm?" }),
		);
		const card = view.getByRole("region", { name: "Do build needs you" });
		expect(within(card).getByText("Publish 1.4.0 to npm?")).toBeTruthy();
		expect(
			within(view.getByRole("article", { name: "@stringsync/mdom" })).getByText(
				"Waiting on you",
			),
		).toBeTruthy();
		fireEvent.click(within(card).getByRole("button", { name: "Yes" }));
		await act(async () => {});
		expect(fake.answered).toEqual([["build", "p1", true]]);
		await fake.send({
			type: "answered",
			at: 3_000,
			...at,
			step: "build",
			id: "p1",
			value: true,
		});
		expect(
			view.queryByRole("region", { name: "Do build needs you" }),
		).toBeNull();
	});

	test("a sign-in link shows its code, then folds to a signed-in line", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		await fake.send(
			{ type: "checking", at: 2_000, ...at, step: "build" },
			{ type: "running", at: 2_000, ...at, step: "build", pid: 7 },
			prompt("p1", {
				kind: "link",
				url: "https://device.sso.aws.test/start",
				code: "WDJB-MJHT",
			}),
		);
		const card = view.getByRole("region", { name: "Do build needs you" });
		expect(
			within(card)
				.getByRole("link", { name: /Open sign-in link/ })
				.getAttribute("href"),
		).toBe("https://device.sso.aws.test/start");
		expect(within(card).getByText("WDJB-MJHT")).toBeTruthy();
		fireEvent.click(
			within(card).getByRole("button", { name: "I've signed in" }),
		);
		await act(async () => {});
		expect(fake.answered).toEqual([["build", "p1", true]]);

		await fake.send({ type: "withdrawn", ...at, step: "build", id: "p1" });
		expect(
			view.queryByRole("region", { name: "Do build needs you" }),
		).toBeNull();
		expect(view.getByText("Signed in at device.sso.aws.test")).toBeTruthy();
	});

	test("a one-time code is typed on a number pad and sent", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		await fake.send(
			{ type: "checking", at: 2_000, ...at, step: "build" },
			{ type: "running", at: 2_000, ...at, step: "build", pid: 7 },
			prompt("p1", { kind: "ask", question: "npm one-time code" }),
		);
		const input = view.getByLabelText("npm one-time code");
		expect(input.getAttribute("inputmode")).toBe("numeric");
		fireEvent.change(input, { target: { value: "481516" } });
		fireEvent.click(view.getByRole("button", { name: "Send code" }));
		await act(async () => {});
		expect(fake.answered).toEqual([["build", "p1", "481516"]]);
	});

	test("two steps asking at once open one at a time, each answering on its own though their ids match", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		await fake.send(
			{ type: "checking", at: 2_000, ...at, step: "build" },
			{ type: "checking", at: 2_000, ...at, step: "publish" },
			prompt("1", { kind: "confirm", question: "Build it?" }),
			{
				...prompt("1", { kind: "confirm", question: "Publish it?" }),
				step: "publish",
			} as RunEvent,
		);
		expect(
			view.queryByRole("region", { name: "Do publish needs you" }),
		).toBeNull();
		fireEvent.click(
			within(
				view.getByRole("region", { name: "Do build needs you" }),
			).getByRole("button", { name: "Yes" }),
		);
		await fake.send({
			type: "answered",
			at: 3_000,
			...at,
			step: "build",
			id: "1",
			value: true,
		});
		expect(
			view.queryByRole("region", { name: "Do build needs you" }),
		).toBeNull();
		fireEvent.click(
			within(
				view.getByRole("region", { name: "Do publish needs you" }),
			).getByRole("button", { name: "Yes" }),
		);
		expect(fake.answered).toEqual([
			["build", "1", true],
			["publish", "1", true],
		]);
	});

	test("a refused answer says why", async () => {
		const fake = fakeServer();
		fake.refuse = '"build" of @stringsync/mdom is not asking "p1"';
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		await fake.open(run());
		await fake.send(
			{ type: "checking", at: 2_000, ...at, step: "build" },
			prompt("p1", { kind: "confirm", question: "Go?" }),
		);
		fireEvent.click(view.getByRole("button", { name: "No, stop" }));
		expect(await view.findByText(/is not asking/)).toBeTruthy();
	});

	test("a run that is done opens on a recap of what shipped, its steps shown", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		const done = run();
		done.status = "done";
		done.targets = done.targets.map((target) => ({
			...target,
			released: "1.2.3",
			steps: target.steps.map((each) => ({
				...each,
				status: "done" as const,
				started: 2_000,
				ended: 12_000,
			})),
		}));
		await fake.open(done);
		expect(view.getByText(/Shipped 3 targets in 11s/)).toBeTruthy();
		expect(view.getByText("@stringsync/mdom 1.2.3")).toBeTruthy();
		expect(view.queryByText(/of 3 done/)).toBeNull();
		expect(view.getByRole("button", { name: "Done" })).toBeTruthy();
	});

	test("a recap step that printed output opens it in the pane when pressed", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />, {
			wrapper: Provider,
		});
		const done = run();
		done.status = "done";
		done.targets = done.targets.map((target, index) => ({
			...target,
			steps: target.steps.map((each) => ({
				...each,
				status: "done" as const,
				started: 2_000,
				ended: 12_000,
				output: index === 0 ? ["published"] : [],
			})),
		}));
		await fake.open(done);
		const shows = view.getAllByTitle("Show what it printed");
		const first = done.targets[0];
		expect(shows.length).toBe(first?.steps.length ?? 0);
		fireEvent.click(shows[0] as HTMLElement);
		expect(
			opened.map((each) => `${each.run} ${each.target} ${each.step}`),
		).toEqual([`run-1 ${first?.name} ${first?.steps[0]?.id}`]);
	});

	test("a stopped run opens on a recap showing it stopped beside what shipped", async () => {
		const fake = fakeServer();
		const view = render(<ShipRunScreen id="run-1" server={fake.server} />);
		const stopped = run();
		stopped.status = "stopped";
		stopped.targets = stopped.targets.map((target, index) => ({
			...target,
			steps: target.steps.map((each) => ({
				...each,
				status: index === 0 ? ("done" as const) : ("pending" as const),
				started: 2_000,
				ended: 12_000,
			})),
		}));
		await fake.open(stopped);
		expect(
			view.getByText(/Stopped by you.*1 of 3 targets shipped/),
		).toBeTruthy();
		expect(view.getAllByText(/\(stopped\)/).length).toBe(2);
		expect(view.getByRole("button", { name: "Done" })).toBeTruthy();
	});

	test("a run the server does not have says so", async () => {
		const fake = fakeServer(null);
		const view = render(<ShipRunScreen id="gone" server={fake.server} />);
		await act(() => fake.streams[0]?.error?.());
		expect(await view.findByText('No ship run is "gone".')).toBeTruthy();
	});

	test("follows the page's own stream when it has no connection of its own", async () => {
		const found = run();
		const server: ShipRunServer = {
			answer: async () => found,
			events: () => "",
			get: async () => found,
			retry: async () => found,
			send: async () => ({ state: found, task: 1 }),
			stop: async () => found,
		};
		const view = render(<ShipRunScreen id="run-1" server={server} />);
		await waitFor(() => expect(view.getByText(/0 of 3 done/)).toBeTruthy());
		const [mdom, ...rest] = found.targets;
		const next = {
			...found,
			targets: [{ ...mdom, steps: [] }, ...rest],
		} as RunState;
		act(() => {
			SHIP_BUS.dispatch("run", { id: "other", state: next });
			SHIP_BUS.dispatch("dropped");
		});
		await waitFor(() => expect(view.getByText(/Reconnecting/)).toBeTruthy());
	});
});

const prompt = (id: string, asked: Prompt): RunEvent => ({
	type: "prompt",
	at: 2_500,
	...at,
	step: "build",
	id,
	prompt: asked,
});

const step = (id: string, dependencies: string[] = []) => ({
	id,
	does: `Do ${id}`,
	dependencies,
	status: "pending" as const,
	output: [],
	prompts: [],
});

/** mdom and net-staging together, then vexml on mdom. */
const run = (): RunState => ({
	id: "run-1",
	started: 1_000,
	status: "running",
	notes: [],
	targets: [
		{
			name: "@stringsync/mdom",
			command: "bin/mdom ship",
			dependencies: [],
			steps: [step("build"), step("publish", ["build"])],
		},
		{
			name: "net-staging",
			command: "bin/net ship",
			dependencies: [],
			steps: [step("deploy")],
		},
		{
			name: "@stringsync/vexml",
			command: "bin/vex ship",
			dependencies: ["@stringsync/mdom"],
			steps: [step("publish")],
		},
	],
});

/** A server whose stream the test drives, recording the retries asked. */
function fakeServer(found: RunState | null = null) {
	const streams: StreamHandlers[] = [];
	const retried: string[] = [];
	const sent: string[] = [];
	const answered: [string, string, unknown][] = [];
	const control = {
		refuse: null as string | null,
		held: null as Promise<void> | null,
		let: () => {},
	};
	const server: ShipRunServer = {
		answer: async (_, __, step, prompt, value) => {
			answered.push([step, prompt, value]);
			await control.held;
			if (control.refuse !== null) {
				throw new Error(control.refuse);
			}
			return run();
		},
		events: (id) => `/api/ship/runs/${id}/events`,
		get: async () => found,
		retry: async (_, target, step) => {
			retried.push(`${target} ${step}`);
			return run();
		},
		stop: async () => run(),
		send: async (_, target, step) => {
			sent.push(`${target} ${step}`);
			return { state: run(), task: 42 };
		},
		connect: (_, handlers) => {
			streams.push(handlers);
			return { dispose() {} };
		},
	};
	const stream = () => {
		const last = streams.at(-1);
		if (last === undefined) {
			throw new Error("no stream open");
		}
		return last;
	};
	return {
		server,
		retried,
		sent,
		answered,
		set refuse(why: string) {
			control.refuse = why;
		},
		/** Holds every answer until `release`. */
		hold: () => {
			control.held = new Promise((done) => {
				control.let = done;
			});
		},
		release: () =>
			act(async () => {
				control.let();
			}),
		streams,
		/** The stream opening with `state`, as the server's does. */
		open: (state: RunState) =>
			act(() =>
				stream().named?.state?.({
					data: JSON.stringify(state),
				} as MessageEvent<string>),
			),
		send: (...events: RunEvent[]) =>
			act(() => {
				for (const event of events) {
					stream().named?.run?.({
						data: JSON.stringify(event),
					} as MessageEvent<string>);
				}
			}),
		drop: () => act(() => stream().dropped?.()),
	};
}

const at = { target: "@stringsync/mdom" };

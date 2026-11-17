import { afterEach, describe, expect, test } from "bun:test";
import type { PermissionProposal } from "@splates/server/plans";
import type { Pick, RunEvent, RunState } from "@splates/server/ship";
import { type Reply, ReplyContext } from "./card-reply";
import type { StreamHandlers } from "./live-stream";
import { ShipAskCard } from "./ship-ask-card";
import type { ShipRunServer } from "./ship-run";
import { act, cleanup, fireEvent, render, waitFor } from "./testing-library";

describe("ShipAskCard", () => {
	afterEach(cleanup);

	test("lists each target with its bump and why, and Approve starts the ship and tells the agent", async () => {
		const fake = fakeServer();
		const view = shown(fake);
		expect(view.getByText("Ship 2 targets?")).toBeTruthy();
		expect(view.getByText("minor")).toBeTruthy();
		expect(view.getByText("patch")).toBeTruthy();
		expect(view.getByText(/vexml takes it/)).toBeTruthy();

		fireEvent.click(view.getByRole("button", { name: "Approve" }));
		await waitFor(() =>
			expect(fake.sent).toEqual(["[SPLATES SHIP STARTED run-1]"]),
		);
		expect(fake.started).toEqual([
			[
				{ name: "@stringsync/mdom", bump: "minor" },
				{ name: "@stringsync/vexml", bump: "patch" },
			],
		]);

		await fake.open(run());
		expect(view.getByText("Shipping 2 targets")).toBeTruthy();
		expect(view.getByText("running")).toBeTruthy();
		expect(view.getByText("waits on @stringsync/mdom")).toBeTruthy();
		expect(view.getByText("Open run").getAttribute("href")).toBe(
			"#ships/run-1",
		);
		expect(view.queryByRole("button", { name: "Approve" })).toBeNull();
	});

	test("Approve opens the started run's active ship page", async () => {
		const fake = fakeServer();
		const opened: string[] = [];
		const view = shown(fake, (id) => opened.push(id));
		fireEvent.click(view.getByRole("button", { name: "Approve" }));
		await waitFor(() => expect(opened).toEqual(["run-1"]));
	});

	test("the same card shows a failed step, then done with what shipped", async () => {
		const fake = fakeServer();
		const view = shown(fake);
		fireEvent.click(view.getByRole("button", { name: "Approve" }));
		await waitFor(() => expect(fake.sent.length).toBe(1));
		await fake.open(run());

		await fake.send(
			{ type: "checking", at: 2_000, ...mdom, step: "publish" },
			{ type: "released", ...mdom, step: "publish", version: "2.4.0" },
			{ type: "ended", at: 3_000, ...mdom, step: "publish", outcome: "done" },
			{ type: "checking", at: 3_000, ...vexml, step: "test" },
			{
				type: "ended",
				at: 4_000,
				...vexml,
				step: "test",
				outcome: "failed",
				error: "3 tests fail: slur.test.ts expected 2 curves, got 1\nmore",
			},
		);
		expect(view.getByText("failed")).toBeTruthy();
		expect(view.getByText("@stringsync/mdom 2.4.0")).toBeTruthy();
		expect(view.getByText("✕ test")).toBeTruthy();
		expect(
			view.getByText("3 tests fail: slur.test.ts expected 2 curves, got 1"),
		).toBeTruthy();

		await fake.send({
			type: "sent",
			at: 4_500,
			...vexml,
			step: "test",
			task: 812,
		});
		expect(view.getByText("#812").getAttribute("href")).toBe("#todos/812");
		expect(
			view.getByText(/the ship retries it once the fix merges/),
		).toBeTruthy();

		await fake.send(
			{
				type: "fixed",
				at: 4_900,
				...vexml,
				step: "test",
				task: 812,
				outcome: "merged",
			},
			{ type: "retried", at: 5_000, ...vexml, step: "test", by: "fix" },
			{ type: "ended", at: 6_000, ...vexml, step: "test", outcome: "done" },
			{ type: "released", ...vexml, step: "publish", version: "1.9.3" },
			{ type: "ended", at: 61_000, ...vexml, step: "publish", outcome: "done" },
		);
		expect(view.getByText("Shipped 2 targets")).toBeTruthy();
		expect(view.getByText("@stringsync/vexml 1.9.3")).toBeTruthy();
		expect(view.getAllByText("✓ shipped").length).toBe(2);
		expect(view.getByText(/1m · retried once/)).toBeTruthy();
		expect(view.getByText("#812").getAttribute("href")).toBe("#todos/812");
	});

	test("a refused start says why and tells the agent nothing", async () => {
		const fake = fakeServer();
		fake.refuse = "A ship is already running";
		const view = shown(fake);
		fireEvent.click(view.getByRole("button", { name: "Approve" }));
		await waitFor(() =>
			expect(view.getByText(/A ship is already running/)).toBeTruthy(),
		);
		expect(fake.sent).toEqual([]);
		expect(view.getByRole("button", { name: "Approve" })).toBeTruthy();
	});

	test("Decline tells the agent no and starts nothing", async () => {
		const fake = fakeServer();
		const view = shown(fake);
		fireEvent.click(view.getByRole("button", { name: "Decline" }));
		await waitFor(() => expect(fake.sent).toEqual(["[SPLATES SHIP DECLINED]"]));
		expect(fake.started).toEqual([]);
	});
});

const proposal: PermissionProposal = {
	action: "ship",
	lane: null,
	tasks: [],
	title: "Release the slur fix",
	body: "mdom's slur fix is unreleased; vexml takes it.",
	ship: {
		picks: [
			{ name: "@stringsync/mdom", bump: "minor" },
			{ name: "@stringsync/vexml", bump: "patch" },
		],
	},
};

const mdom = { target: "@stringsync/mdom" };
const vexml = { target: "@stringsync/vexml" };

const step = (id: string, dependencies: string[] = []) => ({
	id,
	does: `Do ${id}`,
	dependencies,
	status: "pending" as const,
	output: [],
	prompts: [],
});

const run = (): RunState => ({
	id: "run-1",
	started: 1_000,
	status: "running",
	notes: [],
	targets: [
		{
			name: "@stringsync/mdom",
			command: "bin/mdom ship",
			bump: "minor",
			dependencies: [],
			steps: [step("publish")],
		},
		{
			name: "@stringsync/vexml",
			command: "bin/vex ship",
			bump: "patch",
			dependencies: ["@stringsync/mdom"],
			steps: [step("test"), step("publish", ["test"])],
		},
	],
});

function shown(
	fake: ReturnType<typeof fakeServer>,
	open: (id: string) => void = () => {},
) {
	return render(
		<ReplyContext value={fake.reply}>
			<ShipAskCard
				proposal={proposal}
				server={fake.server}
				start={fake.start}
				open={open}
			/>
		</ReplyContext>,
	);
}

/** A server and a reply the test drives, recording what was started and sent. */
function fakeServer() {
	const streams: StreamHandlers[] = [];
	const sent: string[] = [];
	const started: Pick[][] = [];
	const control = { refuse: null as string | null };
	const reply: Reply = {
		send: async (text) => {
			sent.push(text);
		},
		drafts: { read: () => "", write: () => {} },
	};
	const start = async (picks: readonly Pick[]): Promise<RunState> => {
		if (control.refuse !== null) {
			throw new Error(control.refuse);
		}
		started.push([...picks]);
		return run();
	};
	const server: ShipRunServer = {
		answer: async () => run(),
		send: async () => ({ state: run(), task: 1 }),
		stop: async () => run(),
		events: (id) => `/api/ship/runs/${id}/events`,
		get: async () => null,
		retry: async () => run(),
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
		reply,
		start,
		server,
		sent,
		started,
		set refuse(why: string) {
			control.refuse = why;
		},
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
	};
}

import { afterEach, describe, expect, it } from "bun:test";
import { evalRunOf } from "@splates/server/conversations/browser";
import { evalLiveOf as liveOf } from "./eval-live";
import { EvalLiveCard } from "./eval-live-card";
import { cleanup, fireEvent, render, waitFor } from "./testing-library";

afterEach(cleanup);

describe("a progress file, read for its card", () => {
	it("reads a running eval: its checks, transcript, turn and cost", () => {
		const live = evalLiveOf(`${RUNNING}{"type":"line","line":{"who"`);

		expect(live).toMatchObject({
			eval: START.eval,
			group: "files",
			seeded: 2,
			turn: 2,
			turns: 2,
			usd: 0.41,
			phase: "agent",
			report: null,
		});
		expect(live?.lines.map((line) => line.who)).toEqual([
			"user",
			"tool",
			"user",
		]);
	});

	it("is null before the run starts, and holds the report once done", () => {
		expect(evalLiveOf("")).toBeNull();
		const done = evalLiveOf(
			`${RUNNING}${liveFileOf(
				{ type: "phase", phase: "checks" },
				{
					type: "done",
					report: {
						eval: START.eval,
						agent: "claude:sonnet",
						status: "harness",
						error: "claude: 401 Unauthorized",
						transcript: [],
						checks: [],
						judge: null,
						usage: { usd: null, turns: null, seconds: 4 },
						fault: null,
					},
				},
			)}`,
		);
		expect(done?.report?.status).toBe("error");
		expect(done?.report?.group).toBe("files");
	});
});

describe("EvalLiveCard", () => {
	it("shows the transcript so far with every check and the judge waiting", () => {
		const live = evalLiveOf(RUNNING);
		if (live === null) {
			throw new Error("no live eval");
		}
		const view = render(<EvalLiveCard live={live} />);

		expect(view.getByText("Eval running")).toBeTruthy();
		expect(view.getByText(/turn 2 of 2/)).toBeTruthy();
		expect(view.getByText(/\$0\.41/)).toBeTruthy();
		expect(view.getByText("[SPLATES CANCEL]")).toBeTruthy();
		expect(view.getAllByLabelText("waiting")).toHaveLength(3);
		expect(view.getByRole("status").textContent).toBe("The agent is working");
	});

	it("becomes the report card when the run ends", () => {
		const live = evalLiveOf(
			`${RUNNING}${liveFileOf({
				type: "done",
				report: {
					eval: START.eval,
					agent: "claude:sonnet",
					status: "pass",
					error: null,
					transcript: [{ who: "user", text: "Add a files command." }],
					checks: [{ id: "kept", about: "kept", pass: true }],
					judge: null,
					usage: { usd: 0.5, turns: 3, seconds: 200 },
					fault: null,
				},
			})}`,
		);
		if (live === null) {
			throw new Error("no live eval");
		}
		const view = render(<EvalLiveCard live={live} />);

		expect(view.getByText("Eval passed")).toBeTruthy();
		expect(view.queryByText("Eval running")).toBeNull();
	});

	it("shows lead-diagnosed faults underneath the checks once appended to a finished live run", () => {
		const live = evalLiveOf(
			`${RUNNING}${liveFileOf(
				{
					type: "done",
					report: {
						eval: START.eval,
						agent: "claude:sonnet",
						status: "fail",
						error: null,
						transcript: [{ who: "user", text: "Add a files command." }],
						checks: [
							{ id: "kept", about: "the first file edit is kept", pass: false },
						],
						judge: { pass: false, reason: "Reverted both edits." },
						usage: { usd: 0.5, turns: 3, seconds: 42 },
						fault: null,
					},
				},
				{
					type: "faults",
					faults: [
						{ area: "skill", detail: "Never says to keep earlier edits." },
						{
							area: "environment",
							detail: "Sandbox started with a dirty tree.",
						},
					],
				},
			)}`,
		);
		if (live === null) {
			throw new Error("no live eval");
		}
		const view = render(<EvalLiveCard live={live} />);

		expect(view.getByText("Eval failed")).toBeTruthy();
		const section = view.getByLabelText("What went wrong");
		expect(section.textContent).toContain("Skill ·");
		expect(section.textContent).toContain("Never says to keep earlier edits.");
		expect(section.textContent).toContain("Environment ·");
		expect(section.textContent).toContain("Sandbox started with a dirty tree.");
	});

	it("says a run that ended without a report stopped, with no clock or spinner", () => {
		const run = evalRunOf("run.jsonl", RUNNING);
		if (run === null) {
			throw new Error("no live eval");
		}
		const view = render(
			<EvalLiveCard live={liveOf({ ...run, stopped: true })} />,
		);

		expect(view.getByText("Eval stopped")).toBeTruthy();
		expect(view.queryByRole("status")).toBeNull();
	});
});

describe("cancelling a live eval", () => {
	function cancellable() {
		const run = evalRunOf("run.jsonl", RUNNING);
		if (run === null) {
			throw new Error("no live eval");
		}
		return { ...run, cancellable: true as const };
	}

	it("offers Cancel eval on a run that can be cancelled, and calls it once clicked", async () => {
		let calls = 0;
		const view = render(
			<EvalLiveCard
				live={liveOf(cancellable())}
				onCancel={async () => {
					calls += 1;
				}}
			/>,
		);

		fireEvent.click(view.getByRole("button", { name: /Cancel eval/ }));
		await waitFor(() => expect(calls).toBe(1));
	});

	it("offers no Cancel on a run that cannot be cancelled", () => {
		const run = evalRunOf("run.jsonl", RUNNING);
		if (run === null) {
			throw new Error("no live eval");
		}
		const view = render(
			<EvalLiveCard live={liveOf(run)} onCancel={async () => {}} />,
		);

		expect(view.queryByRole("button", { name: /Cancel/ })).toBeNull();
	});

	it("shows Cancelling, disabled, once the cancel is asked for", () => {
		const view = render(
			<EvalLiveCard
				live={liveOf({
					...cancellable(),
					cancelling: "2026-11-26T12:01:00.000Z",
				})}
				onCancel={async () => {}}
			/>,
		);

		const button = view.getByRole("button", { name: /Cancelling/ });
		expect((button as HTMLButtonElement).disabled).toBe(true);
	});

	it("says who cancelled it and when, with the checks not run", () => {
		const view = render(
			<EvalLiveCard
				live={liveOf({
					...cancellable(),
					cancelled: "2026-11-26T12:01:42.000Z",
				})}
				onCancel={async () => {}}
			/>,
		);

		expect(view.getByText("Eval cancelled")).toBeTruthy();
		expect(
			view.getByText(/Cancelled by you at 1m 42s · the agent was told/),
		).toBeTruthy();
		expect(view.getByText("Not run: the eval was cancelled.")).toBeTruthy();
		expect(view.queryByRole("button", { name: /Cancel/ })).toBeNull();
		expect(view.queryByRole("status")).toBeNull();
	});
});

/** The card's view of a progress file's `text`, or null before it starts. */
function evalLiveOf(text: string) {
	const run = evalRunOf("run.jsonl", text);
	return run === null ? null : liveOf(run);
}

const START = {
	type: "start",
	at: "2026-11-26T12:00:00.000Z",
	eval: "undoes only the last request when the server cancels it",
	group: "files",
	agent: "claude:sonnet",
	seeded: 2,
	turns: 2,
	checks: [
		{ id: "kept", about: "the first file edit is kept" },
		{ id: "reverted", about: "only the last request's commit is reverted" },
	],
	judge: "jev:latest",
};

/** A live file of `events`, one JSON line each, as `bin/evals run` writes it. */
function liveFileOf(...events: unknown[]): string {
	return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

const RUNNING = liveFileOf(
	START,
	{ type: "line", line: { who: "user", text: "Add a files command." } },
	{ type: "line", line: { who: "tool", text: "Read SKILL.md" } },
	{ type: "usage", usd: 0.41 },
	{ type: "turn", turn: 2 },
	{ type: "line", line: { who: "user", text: "[SPLATES CANCEL]" } },
);

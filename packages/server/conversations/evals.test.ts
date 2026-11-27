import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { FakeTimer } from "core/time/testing";
import { ConversationEvals, evalRunOf, evalsDir } from "./evals";
import type { ConversationDeps, ConversationHost } from "./host";
import type { ConversationState } from "./state";

const START = {
	type: "start",
	at: "2026-11-26T12:00:00.000Z",
	eval: "undoes only the last request",
	group: "files",
	agent: "claude:sonnet",
	seeded: 2,
	turns: 2,
	checks: [{ id: "kept", about: "the first edit is kept" }],
	judge: "jev:latest",
};

/** A progress file of `events`, one JSON line each, as `bin/evals run` writes it. */
function fileOf(...events: unknown[]): string {
	return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

describe("evalRunOf", () => {
	it("reads a run so far, skipping a line still being written", () => {
		const run = evalRunOf(
			"a.jsonl",
			`${fileOf(
				START,
				{ type: "line", line: { who: "user", text: "Add it." } },
				{ type: "line", line: { who: "tool", text: "Read SKILL.md" } },
				{ type: "usage", usd: 0.41 },
				{ type: "turn", turn: 2 },
				{ type: "phase", phase: "checks" },
			)}{"type":"line","li`,
		);

		expect(run).toMatchObject({
			name: "a.jsonl",
			startedAt: START.at,
			group: "files",
			turn: 2,
			usd: 0.41,
			phase: "checks",
			checks: START.checks,
			report: null,
		});
		expect(run?.lines).toEqual([
			{ who: "user", text: "Add it." },
			{ who: "tool", text: "Read SKILL.md" },
		]);
	});

	it("is null before the start, and keeps the report once done", () => {
		expect(evalRunOf("a.jsonl", "")).toBeNull();
		const run = evalRunOf(
			"a.jsonl",
			fileOf(START, { type: "done", report: { status: "pass" } }),
		);
		expect(run?.report).toEqual({ status: "pass" });
	});
});

describe("ConversationEvals.cancel", () => {
	const DIR = evalsDir("/convs", "c1");
	const NAME = "2026-11-26-files.jsonl";
	let fs: FakeFs;
	let timer: FakeTimer;
	let state: Pick<ConversationState, "id" | "evals">;
	let said: string[];
	let evals: ConversationEvals;

	beforeEach(async () => {
		fs = new FakeFs();
		timer = new FakeTimer();
		state = { id: "c1", evals: [] };
		said = [];
		evals = new ConversationEvals(
			{ state, changed: () => {} } as unknown as ConversationHost,
			{
				fs,
				timer,
				dir: "/convs",
				clock: { now: () => Date.parse("2026-11-26T12:01:42Z") },
			} as unknown as ConversationDeps,
			async (text) => {
				said.push(text);
			},
		);
		await fs.mkdir(DIR, { recursive: true });
	});

	async function running(start: object): Promise<void> {
		await fs.write(`${DIR}/${NAME}`, fileOf(start));
		await evals.load();
		// `load` reads a run left unfinished as stopped; one followed live is not.
		state.evals = (state.evals ?? []).map(({ stopped: _, ...run }) => run);
	}

	it("writes the run's cancel file and tells the agent the user cancelled it", async () => {
		await running({ ...START, cancellable: true });

		await evals.cancel(NAME);

		expect(await fs.read(`${DIR}/2026-11-26-files.cancel`)).toContain(
			"2026-11-26T12:01:42.000Z",
		);
		expect(state.evals?.[0]?.cancelling).toBe("2026-11-26T12:01:42.000Z");
		expect(said).toEqual([
			"[SPLATES EVAL CANCELLED files undoes only the last request]\n\nThe user cancelled this eval from its card; it ends without a report.",
		]);

		await evals.cancel(NAME);
		expect(said).toHaveLength(1);
	});

	it("refuses a run that does not watch for a cancel, telling no one", async () => {
		await running(START);

		expect(evals.cancel(NAME)).rejects.toThrow("cannot be cancelled");
		expect(await fs.exists(`${DIR}/2026-11-26-files.cancel`)).toBe(false);
		expect(said).toEqual([]);
	});

	it("reads a cancelled run as cancelled, not stopped, after a restart", async () => {
		await fs.write(
			`${DIR}/${NAME}`,
			fileOf(
				{ ...START, cancellable: true },
				{ type: "cancelled", at: "2026-11-26T12:01:45.000Z" },
			),
		);
		await evals.load();

		expect(state.evals?.[0]).toMatchObject({
			cancellable: true,
			cancelled: "2026-11-26T12:01:45.000Z",
		});
		expect(state.evals?.[0]?.stopped).toBeUndefined();
	});
});

import { describe, expect, it } from "bun:test";
import { type ConversationState, unused } from "../conversations";
import type { Details } from "../tasks";
import { ASKED_QUIET, need, needs, QUIET_AFTER, quietSince } from "./needs";
import { STUB_STEPS } from "./plan";

describe("needs", () => {
	it("waits on a live ask before anything in the plan", () => {
		const asked = need(
			task({ plan: PLAN }),
			talk({
				ask: {
					type: "permission",
					id: "t1",
					title: "rm -rf build",
					options: [],
					at: "2026-10-11T10:05:00.000Z",
				},
			}),
		);

		expect(asked).toMatchObject({
			kind: "waiting",
			why: "ask",
			subject: "rm -rf build",
			since: "2026-10-11T10:05:00.000Z",
		});
	});

	it("waits on a review its last reply asks for, once its turn ends", () => {
		const at = "2026-10-11T10:07:00.000Z";
		const reviewing = talk({
			status: "idle",
			messages: [
				{
					role: "agent",
					parts: [{ type: "text", text: REVIEW }],
					plan: null,
					at,
					until: at,
				},
			],
		});

		expect(need(task({ ready: true }), reviewing)).toMatchObject({
			kind: "waiting",
			why: "review",
			subject: "Cards drag only after a long press.",
			since: at,
		});
		// A reply starts its turn again.
		expect(
			need(task({ ready: true }), { ...reviewing, status: "running" }),
		).toEqual({ kind: "working", subject: null });
		expect(
			need(task({ ready: true }), {
				...reviewing,
				messages: [
					...reviewing.messages,
					{ role: "user", parts: [], plan: null, at, until: at },
				],
			}),
		).toEqual({ kind: "idle" });
	});

	it("waits on an external agent's questions once it goes quiet on them", () => {
		const at = "2026-10-11T10:00:00.000Z";
		const quiet = Date.parse(at) + ASKED_QUIET.ms;

		expect(need(task({ plan: PLAN, activeAt: at }), null, quiet)).toMatchObject(
			{
				kind: "waiting",
				why: "questions",
				subject: "Does the header wrap?",
				since: at,
			},
		);
		expect(
			need(task({ plan: PLAN, activeAt: at }), null, quiet - 1),
		).toMatchObject({ kind: "assuming" });
	});

	it("assumes while the agent runs on open questions, and waits once its turn ends on them", () => {
		const assuming = need(task({ plan: PLAN }), talk());

		expect(assuming).toMatchObject({
			kind: "assuming",
			subject: "Does the header wrap?",
		});
		expect(
			assuming.kind === "assuming" &&
				assuming.questions.map((asked) => asked.number),
		).toEqual(["2", "3"]);
		expect(need(task({ plan: PLAN }), talk({ status: "idle" }))).toMatchObject({
			kind: "waiting",
			why: "questions",
		});
		// An external agent, run outside the page, is taken to be at work.
		expect(need(task({ plan: PLAN }), null)).toMatchObject({
			kind: "assuming",
		});
	});

	it("says a failure, and otherwise what the agent works on next", () => {
		expect(
			need(null, talk({ task: null, status: "failed", error: "exited 1" })),
		).toMatchObject({ kind: "waiting", why: "failed", subject: "exited 1" });

		const plan = PLAN.replace(/## Blocked[\s\S]*/, "");
		expect(need(task({ plan }), talk())).toEqual({
			kind: "working",
			subject: "wire the header",
		});
		expect(need(null, talk({ task: null, status: "idle" }))).toEqual({
			kind: "idle",
		});
	});

	it("says the Goal until the plan has a step of its own, never a stub's", () => {
		const [stubStep = "", oldStubStep = ""] = STUB_STEPS;
		const stub = `# alpha\n\n## Goal\n\nship it\n\n## Next\n\n- [ ] ${stubStep}\n`;
		expect(need(task({ plan: stub }), talk())).toEqual({
			kind: "working",
			subject: "ship it",
		});
		expect(
			need(task({ plan: `${stub}- [ ] wire the header\n` }), talk()),
		).toEqual({ kind: "working", subject: "wire the header" });
		expect(need(task({ plan: stub.replace("ship it", "") }), talk())).toEqual({
			kind: "working",
			subject: null,
		});
		expect(
			need(task({ plan: stub.replace(stubStep, oldStubStep) }), talk()),
		).toEqual({ kind: "working", subject: "ship it" });
	});

	it("lists waiting by oldest stop, then assuming by most questions, then the rest", () => {
		const listed = needs({
			tasks: [
				task({ task: "few", plan: ONE }),
				task({ task: "many", plan: TWO }),
				task({ task: "external", plan: ONE, activeAt: "2026-10-11T10:03:00Z" }),
				task({ task: "gone", status: "orphaned" }),
			],
			conversations: [
				talk({ id: "idle", task: null, status: "idle" }),
				talk({ id: "few", task: "few" }),
				talk({ id: "late", task: null, ask: ask("2026-10-11T10:09:00Z") }),
				talk({ id: "many", task: "many" }),
				talk({ id: "early", task: null, ask: ask("2026-10-11T10:01:00Z") }),
				talk({ id: "put away", task: null, archived: true }),
			],
			now: Date.parse("2026-10-11T11:00:00Z"),
		});

		expect(
			listed.map((each) => each.conversation?.id ?? each.task?.task),
		).toEqual(["early", "external", "late", "many", "few", "idle"]);
		expect(listed[1]?.conversation).toBeNull();
	});

	it("waits on the conversation whose agent added an external agent's task, naming it", () => {
		const of = (archived: boolean) =>
			needs({
				tasks: [
					task({
						task: "sub",
						plan: ONE,
						activeAt: "2026-10-11T10:00:00Z",
						caller: "orch",
					}),
				],
				conversations: [
					talk({ id: "orch", task: null, status: "idle", archived }),
				],
				now: Date.parse("2026-10-11T11:00:00Z"),
			});

		const listed = of(false);
		expect(
			listed.map((each) => [
				each.conversation?.id ?? each.task?.task,
				each.need.kind,
			]),
		).toEqual([
			["orch", "waiting"],
			["sub", "idle"],
		]);
		expect(listed[0]?.need).toMatchObject({
			why: "questions",
			subject: "One?",
			via: "sub",
		});
		// Its caller archived, it waits on the person again, never on no row.
		expect(of(true)[0]).toMatchObject({
			task: { task: "sub" },
			need: { kind: "waiting", why: "questions" },
		});
	});

	it("waits on you for a task its conversation left, archived or gone, keeping its questions", () => {
		const of = (conversations: ConversationState[]) =>
			needs({
				tasks: [
					task({
						plan: PLAN,
						takenBy: "c1",
						activeAt: "2026-10-11T10:30:00.000Z",
					}),
				],
				conversations,
				now: Date.parse("2026-10-11T10:31:00.000Z"),
			})[0]?.need;

		expect(of([talk({ archived: true })])).toMatchObject({
			kind: "waiting",
			why: "abandoned",
			subject: "Its conversation was archived",
			since: "2026-10-11T10:30:00.000Z",
			questions: [{ number: "2" }, { number: "3" }],
		});
		expect(of([])).toMatchObject({
			why: "abandoned",
			subject: "Its conversation is gone",
		});
		// Listed on another task, it may have a subagent on this one.
		expect(of([talk({ task: "beta" })])).toMatchObject({ kind: "assuming" });
	});

	it("takes an agent outside the page to be at work, whatever conversation took the task before", () => {
		expect(
			needs({
				tasks: [task({ takenBy: null })],
				conversations: [talk({ archived: true })],
			})[0]?.need.kind,
		).toBe("working");
	});

	it("says an external agent's task is quiet once nothing has moved in it for a while", () => {
		const at = "2026-10-11T10:00:00.000Z";
		const working = { kind: "working", subject: null } as const;
		const after = Date.parse(at) + QUIET_AFTER.ms;

		expect(
			quietSince({ task: task({ activeAt: at }), need: working }, after),
		).toBe(at);
		expect(
			quietSince({ task: task({ activeAt: at }), need: working }, after - 1),
		).toBeNull();
		expect(
			quietSince({ task: task({ activeAt: null }), need: working }, after),
		).toBeNull();
		// One that waits on you is still for a reason.
		expect(
			quietSince(
				{
					task: task({ activeAt: at }),
					need: need(task({ plan: ONE, activeAt: at }), null, after),
				},
				after,
			),
		).toBeNull();
	});

	it("leaves out a task handed to an agent whose conversation has yet to start", () => {
		expect(
			needs({ tasks: [task({ dispatched: true })], conversations: [] }),
		).toEqual([]);
	});
});

const PLAN = `# alpha

## Goal

ship it

## Next

- [x] the first step
- [ ] wire the header
- [ ] the rest

## Blocked

- [x] 1. Is staging up? → yes
- [ ] 2. Does the header wrap?
- [ ] 3. Which cookie?
  - (a) old
  - (b) new
`;

function task(overrides: Partial<Details> = {}): Details {
	return {
		task: "alpha",
		status: "working",
		branch: "task/alpha",
		base: "main",
		caller: null,
		takenBy: null,
		worktree: "/tmp/alpha",
		lease: "held",
		ahead: 1,
		unmerged: true,
		added: 1,
		removed: 0,
		age: "3m",
		createdAt: "2026-10-11T09:57:00.000Z",
		activeAt: null,
		mergeAttempts: 0,
		mergeAttemptLimit: 3,
		ready: false,
		plan: null,
		planProblems: [],
		dispatched: false,
		handedTo: null,

		...overrides,
	};
}

function talk(overrides: Partial<ConversationState> = {}): ConversationState {
	return {
		id: "c1",
		agent: "claude",
		task: "alpha",
		lastTask: "alpha",
		lastBase: "main",
		lastCaller: null,
		title: null,
		name: null,
		status: "running",
		error: null,
		stoppedIdle: null,
		queue: null,
		messages: [],
		events: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt: "2026-10-11T10:00:00.000Z",
		archived: false,
		archivedAt: null,
		archivedWith: null,
		pinned: false,
		parent: null,
		startedBy: null,
		skill: null,
		assigned: false,
		capped: false,
		queued: null,
		unread: false,
		seen: 0,
		checkpoint: null,
		pausing: false,
		budgetStop: null,
		taking: "start",
		usage: unused(),
		background: [],
		artifacts: [],
		...overrides,
	};
}

/** A question the agent asked at `at`. */
function ask(at: string) {
	return {
		type: "question" as const,
		id: at,
		message: `asked at ${at}`,
		fields: [],
		at,
	};
}

/** A reply asking for a review. */
const REVIEW = `## 🔍 Ready to merge alpha onto main

Cards drag only after a long press.

Checks: \`bun test\`

Reply "merge", or say what to change.`;

/** A plan asking one question, and one asking two. */
const ONE = "# t\n\n## Blocked\n\n- [ ] 1. One?\n";
const TWO = `${ONE}- [ ] 2. Two?\n`;

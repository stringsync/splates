import { describe, expect, it } from "bun:test";
import { type ConversationState, unused } from "./conversations";
import { need, needs } from "./needs";
import { STUB_STEP } from "./plan";
import type { Details } from "./show";

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

	it("waits on a review by what to look at, and on any other escalation by its first open question", () => {
		const at = "2026-10-11T10:07:00.000Z";

		expect(
			need(
				task({
					status: "escalated",
					review: "drag a todo on the board",
					ready: true,
					escalatedAt: at,
				}),
				talk({ status: "idle" }),
			),
		).toMatchObject({
			kind: "waiting",
			why: "review",
			subject: "drag a todo on the board",
			since: at,
		});
		expect(
			need(
				task({
					plan: PLAN,
					status: "escalated",
					escalation: "eyes",
					escalatedAt: at,
				}),
				talk({ status: "idle" }),
			),
		).toMatchObject({
			kind: "waiting",
			why: "escalated",
			subject: "Does the header wrap?",
		});
		expect(
			need(
				task({ status: "escalated", escalation: "needs staging access" }),
				null,
			),
		).toMatchObject({ why: "escalated", subject: "needs staging access" });
	});

	it("stops waiting on an escalation once a reply starts the agent's turn", () => {
		const escalated = task({
			plan: PLAN,
			status: "escalated",
			escalation: "eyes",
		});

		expect(need(escalated, talk())).toMatchObject({
			kind: "assuming",
			subject: "Does the header wrap?",
		});
		expect(need(escalated, talk({ status: "starting" }))).toMatchObject({
			kind: "assuming",
		});
		expect(
			need(task({ status: "escalated", review: "look", ready: true }), talk()),
		).toEqual({ kind: "working", subject: null });
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

	it("says the Goal until the plan has a step of its own, never the stub's", () => {
		const stub = `# alpha\n\n## Goal\n\nship it\n\n## Next\n\n- [ ] ${STUB_STEP}\n`;
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
	});

	it("lists waiting by oldest stop, then assuming by most questions, then the rest", () => {
		const listed = needs({
			tasks: [
				task({ task: "few", plan: ONE }),
				task({ task: "many", plan: TWO }),
				task({ task: "external", status: "escalated", escalation: "look" }),
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
		});

		expect(
			listed.map((each) => each.conversation?.id ?? each.task?.task),
		).toEqual(["early", "late", "external", "many", "few", "idle"]);
		expect(listed[2]?.conversation).toBeNull();
	});

	it("waits on the conversation that handed a task out, not on its agent", () => {
		const listed = needs({
			tasks: [
				task({ task: "asking" }),
				task({ task: "escalated", status: "escalated", escalation: "look" }),
			],
			conversations: [
				talk({ id: "orch", task: null, status: "idle" }),
				talk({
					id: "asking",
					task: "asking",
					handedBy: "orch",
					ask: {
						type: "permission",
						id: "t1",
						title: "rm -rf build",
						options: [],
						at: "2026-10-11T10:05:00.000Z",
					},
				}),
				talk({
					id: "escalated",
					task: "escalated",
					status: "idle",
					handedBy: "orch",
				}),
			],
		});

		expect(
			listed.map((each) => [each.conversation?.id, each.need.kind]),
		).toEqual([
			["orch", "waiting"],
			["asking", "working"],
			["escalated", "idle"],
		]);
		expect(listed[0]?.need).toMatchObject({
			why: "ask",
			subject: "rm -rf build",
		});
	});

	it("waits on an idle orchestrator for its agent's escalation, not while it relays it", () => {
		const of = (status: ConversationState["status"]) =>
			needs({
				tasks: [task({ status: "escalated", escalation: "look" })],
				conversations: [
					talk({ id: "orch", task: null, status }),
					talk({ id: "agent", status: "idle", handedBy: "orch" }),
				],
			}).map((each) => [each.conversation?.id, each.need.kind]);

		expect(of("idle")).toEqual([
			["orch", "waiting"],
			["agent", "idle"],
		]);
		expect(of("running")).toEqual([
			["orch", "working"],
			["agent", "idle"],
		]);
	});

	it("waits on the conversation whose agent added an external agent's task, naming it", () => {
		const of = (archived: boolean) =>
			needs({
				tasks: [
					task({
						task: "sub",
						status: "escalated",
						escalation: "look",
						caller: "orch",
					}),
				],
				conversations: [
					talk({ id: "orch", task: null, status: "idle", archived }),
				],
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
			why: "escalated",
			subject: "look",
			via: "sub",
		});
		// Its caller archived, it waits on the person again, never on no row.
		expect(of(true)[0]).toMatchObject({
			task: { task: "sub" },
			need: { kind: "waiting", why: "escalated" },
		});
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
		worktree: "/tmp/alpha",
		lease: "held",
		ahead: 1,
		added: 1,
		removed: 0,
		age: "3m",
		createdAt: "2026-10-11T09:57:00.000Z",
		escalation: null,
		mergeAttempts: 0,
		mergeAttemptLimit: 3,
		escalatedAt: null,
		review: null,
		ready: false,
		plan: null,
		planProblems: [],
		dispatched: false,
		handedTo: null,
		systems: [],
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
		heartbeat: null,
		messages: [],
		events: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt: "2026-10-11T10:00:00.000Z",
		archived: false,
		archivedWith: null,
		handedBy: null,
		skill: null,
		assigned: false,
		unread: false,
		seen: 0,
		checkpoint: null,
		pausing: false,
		usage: unused(),
		background: [],
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

/** A plan asking one question, and one asking two. */
const ONE = "# t\n\n## Blocked\n\n- [ ] 1. One?\n";
const TWO = `${ONE}- [ ] 2. Two?\n`;

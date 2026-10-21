import type { TaskRecord } from "./board";
import type { ConversationState, Message, Part, Tool } from "./conversations";
import type { Details, Snapshot } from "./tasks";

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		project: "webappwiz",
		repo: "webappwiz",
		path: "~/Projects/webappwiz",
		root: "/repo",
		worktreeRoot: "/repo-splates",
		taskStalenessMs: 30 * 24 * 60 * 60 * 1000,
		todos: [],
		lanes: [],
		laneNames: [],
		tasks: [],
		creds: [],
		trunk: "main",
		release: null,
		behind: null,
		unbuilt: false,
		slot: null,
		...overrides,
	};
}

export function details(overrides: Partial<Details> = {}): Details {
	return {
		task: "alpha",
		comingConflict: [],
		status: "working",
		branch: "task/alpha",
		base: "main",
		caller: null,
		takenBy: null,
		worktree: "/tmp/repo-splates/alpha",
		lease: "none",
		ahead: 1,
		unmerged: true,
		added: 2,
		removed: 1,
		age: "3m",
		createdAt: "2026-10-11T09:57:00.000Z",
		activeAt: null,
		mergeAttempts: 0,
		mergeAttemptLimit: 3,
		ready: true,
		plan: null,
		planProblems: [],
		dispatched: false,
		handedTo: null,
		autoPick: null,
		...overrides,
	};
}

export function todo(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 1,
		subject: "retry the upload",
		text: "",
		position: 1,
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		stage: "backlog",
		...overrides,
	};
}

export function conversation(
	overrides: Partial<ConversationState> = {},
): ConversationState {
	return {
		id: "c1",
		agent: "claude",
		task: null,
		title: null,
		status: "idle",
		error: null,
		stoppedIdle: null,
		queue: null,
		name: null,
		archived: false,
		archivedAt: null,
		archivedWith: null,
		pinned: false,
		parent: null,
		startedBy: null,
		skill: null,
		assigned: false,
		picking: false,
		autoPick: null,
		notesHoldout: null,
		capped: false,
		queued: null,
		unread: false,
		seen: 0,
		read: null,
		messages: [],
		events: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt: new Date().toISOString(),
		checkpoint: null,
		pausing: false,
		budgetStop: null,
		taking: "start",
		usage: {
			context: null,
			input: 0,
			cached: 0,
			output: 0,
			cost: null,
			limits: [],
		},
		lastTask: overrides.task ?? null,
		lastBase: null,
		lastCaller: null,
		background: [],
		artifacts: [],
		...overrides,
	};
}

/** A message of `role` made of `parts`, a string standing for its text. */
export function message(
	role: Message["role"],
	...parts: (Part | string)[]
): Message {
	return {
		role,
		parts: parts.map((part) =>
			typeof part === "string" ? { type: "text", text: part } : part,
		),
		plan: null,
		at: null,
		until: null,
	};
}

export function tool(overrides: Partial<Tool> = {}): Tool {
	return {
		type: "tool",
		id: "t1",
		title: "cat note.txt",
		status: "completed",
		kind: "execute",
		command: null,
		target: null,
		output: "",
		edits: [],
		paths: [],
		parent: null,
		at: null,
		until: null,
		flags: [],
		decision: null,
		...overrides,
	};
}

/** `at` seconds after a fixed start, as a message's timestamp reads. */
export function second(secs: number): string {
	return new Date(
		Date.parse("2026-10-11T10:00:00Z") + secs * 1000,
	).toISOString();
}

/**
 * A conversation of one turn: the user asks to run the tests, and the agent
 * answers with `parts` over a minute, under `plan`, or until `stopped` when
 * the person stopped it.
 */
export function turn(
	parts: Parameters<typeof message>[1][],
	{
		status = "idle" as ConversationState["status"],
		plan = null as
			| null
			| { text: string; status: "pending" | "in_progress" | "completed" }[],
		stopped = undefined as string | undefined,
	} = {},
): ConversationState {
	return conversation({
		title: "Tests",
		status,
		messages: [
			{
				...message("user", "run the tests"),
				at: second(0),
				until: second(0),
			},
			{
				...message("agent", ...parts),
				plan,
				at: second(1),
				until: stopped ?? second(65),
				stopped,
			},
		],
	});
}

/** Started a minute apart, the first last, so the list shows them in order. */
export function newestFirst(held: ConversationState[]): ConversationState[] {
	return held.map((each, at) => ({
		...each,
		createdAt: new Date(Date.UTC(2026, 9, 11, 10, 59 - at)).toISOString(),
	}));
}

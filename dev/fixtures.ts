import type {
	Checkpoint,
	ConversationState,
	Message,
	Part,
	Tool,
} from "../conversations";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import type { ProjectChoice } from "./project-api";

/** A conversation of a project's, as the projects route lists it. */
export function live(
	id: string,
	name: string,
	checkpoint: Checkpoint | null = null,
) {
	return {
		id,
		name,
		status: checkpoint === "done" ? "stopped" : "running",
		checkpoint,
	};
}

/** A project as the projects route lists it, holding `listed`. */
export function project(
	slug: string,
	listed: ProjectChoice["conversations"],
	here = false,
): ProjectChoice {
	return {
		slug,
		root: `/code/${slug}`,
		gone: false,
		here,
		conversations: listed,
		waiting: 0,
	};
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		repo: "webappwiz",
		path: "~/Projects/webappwiz",
		root: "/repo",
		worktreeRoot: "/repo-arbor",
		todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
		todos: [],
		lanes: [],
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
		status: "working",
		branch: "task/alpha",
		base: "main",
		caller: null,
		worktree: "/tmp/repo-arbor/alpha",
		lease: "none",
		ahead: 1,
		added: 2,
		removed: 1,
		age: "3m",
		createdAt: "2026-10-11T09:57:00.000Z",
		escalation: null,
		mergeAttempts: 0,
		mergeAttemptLimit: 3,
		escalatedAt: null,
		review: null,
		ready: true,
		plan: null,
		planProblems: [],
		dispatched: false,
		handedTo: null,
		systems: [],
		...overrides,
	};
}

export function todo(overrides: Partial<TodoState> = {}): TodoState {
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
		name: null,
		archived: false,
		archivedWith: null,
		handedBy: null,
		assigned: false,
		unread: false,
		seen: 0,
		messages: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt: new Date().toISOString(),
		checkpoint: null,
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
 * answers with `parts` over a minute, under `plan`.
 */
export function turn(
	parts: Parameters<typeof message>[1][],
	{
		status = "idle" as ConversationState["status"],
		plan = null as
			| null
			| { text: string; status: "pending" | "in_progress" | "completed" }[],
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
				until: second(65),
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

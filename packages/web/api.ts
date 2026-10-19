/**
 * The page's writes: the same core functions as `splates todo add`, `update`
 * and `remove`, and the lanes' own.
 * A refusal comes back as the CLI's own reason and message, thrown so the
 * caller can show it.
 */

import type { KeptCred, Scope } from "@stringsync/splates-server/creds";
import type { AgentPick } from "@stringsync/splates-server/models";
import type { PortLink } from "@stringsync/splates-server/ports";
import type { Wants } from "@stringsync/splates-server/push/browser";
import type {
	MoveProgress,
	SetupProgress,
	StepAnswers,
} from "@stringsync/splates-server/setup";
import type {
	Landed,
	PeriodId,
	Stats,
} from "@stringsync/splates-server/stats/browser";
import type { FileDiff } from "@stringsync/splates-server/tasks";
import type {
	KeyHolder,
	KeyProvider,
	MachineReading,
	QueueListing,
	WorkerBudgetReport,
	WorkerKey,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import type { HeavyJobsReading } from "webappwiz/system";

export class ApiError extends Error {
	constructor(
		readonly reason: string,
		message: string,
	) {
		super(message);
	}
}

/**
 * `path` for the project this page shows: the one `?project=` names, or none
 * for the one `splates server` started in, unless `path` names one itself.
 * Given `project`, a slug, for that one instead, as for something of
 * another project's on this page. Every request the page makes goes
 * through here.
 */
export function scoped(path: string, project: string | null = null): string {
	const named = project ?? new URLSearchParams(location.search).get("project");
	if (named === null || named === "" || path.includes("project=")) {
		return path;
	}
	const query = new URLSearchParams({ project: named });
	return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/**
 * POSTs to `path` for this project, or as `init` says, answering with the
 * body, or throwing the refusal as an `ApiError`.
 */
export async function send(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(scoped(path), { method: "POST", ...init });
	const body = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ??
				(response.status === 413
					? "too big to send"
					: `${path}: ${response.status}`),
		);
	}
	return body;
}

/** A todo's files: new ones to add, and the stored ones to keep. */
export interface FilesForm {
	files: File[];
	/** Paths of files already stored to keep; the rest are dropped. */
	keep: string[];
}

/** What a todo says: a line, and whatever more there is to say. */
export interface TodoForm {
	subject: string;
	text: string;
	/** Where it goes in the list, 1 at the top; absent leaves it be. */
	position?: number;
}

/** Adds a todo at the bottom of `lane`, or of the untriaged ones for null. */
export async function addTodo(
	{ subject, text, position }: TodoForm,
	files: File[],
	lane: number | null = null,
): Promise<void> {
	const form = filesForm({ files, keep: [] });
	todoForm(form, { subject, text, position });
	if (lane !== null) {
		form.set("lane", String(lane));
	}
	await send("/api/todos", { body: form });
}

export async function updateTodo(
	id: number,
	{ subject, text, position, files, keep }: FilesForm & TodoForm,
): Promise<void> {
	const form = filesForm({ files, keep });
	todoForm(form, { subject, text, position });
	await send(`/api/todos/${id}`, { method: "PATCH", body: form });
}

/** Puts a todo at `position`, 1 at the top, moving the rest around it. */
export async function moveTodo(id: number, position: number): Promise<void> {
	await sendJson(`/api/todos/${id}/position`, "PUT", { position });
}

/** `send` with `body` as JSON, by `method`. */
export function sendJson(path: string, method: string, body: unknown) {
	return send(path, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Says `id` is blocked by exactly the todos in `blockedBy`, no more and no fewer. */
export async function linkTodo(id: number, blockedBy: number[]): Promise<void> {
	await sendJson(`/api/todos/${id}/blocked-by`, "PUT", { blockedBy });
}

/**
 * Puts a todo in `lane` (`"new"` for one of its own, null for none), just
 * above the todo `before`, or at the bottom of the lane without one.
 */
export async function arrangeTodo(
	id: number,
	lane: number | "new" | null,
	before?: number,
	/** What to call a new lane; named after the todo without one. */
	name?: string,
): Promise<void> {
	await sendJson(`/api/todos/${id}/lane`, "PUT", { lane, before, name });
}

/** Has `assignee` work todo `id`, or nobody in particular for null. */
export async function assignTodo(
	id: number,
	assignee: AgentPick | null,
): Promise<void> {
	await sendJson(
		`/api/todos/${id}/assignee`,
		"PUT",
		assignee ?? { agent: null },
	);
}

/**
 * Puts todo `id` in the queue, for a worker to start once nothing it is
 * blocked by is open, or takes it out, back to the backlog.
 */
export async function queueTodo(id: number, queued: boolean): Promise<void> {
	await sendJson(`/api/todos/${id}/queued`, "PUT", { queued });
}

/** Moves lane `from`'s todos to the bottom of lane `into`. */
export async function joinLanes(from: number, into: number): Promise<void> {
	await sendJson(`/api/lanes/${from}/join`, "POST", { into });
}

/** Starts an empty lane called `name`, after the others. */
export async function addLane(name: string): Promise<void> {
	await sendJson("/api/lanes", "POST", { name });
}

/** Calls lane `id` by another name. */
export async function renameLane(id: number, name: string): Promise<void> {
	await sendJson(`/api/lanes/${id}`, "PUT", { name });
}

/** Puts lane `id` at `position` among the lanes, 1 the first column. */
export async function moveLane(id: number, position: number): Promise<void> {
	await sendJson(`/api/lanes/${id}`, "PUT", { position });
}

/** Removes lane `id`, putting its todos back with the untriaged ones. */
export async function dropLane(id: number): Promise<void> {
	await send(`/api/lanes/${id}`, { method: "DELETE" });
}

/** Removes a todo, kept for `restoreTodo` to put back. */
export async function removeTodo(id: number): Promise<void> {
	await send(`/api/todos/${id}`, { method: "DELETE" });
}

/** Puts back a todo `removeTodo` removed, under its id, where it stood. */
export async function restoreTodo(id: number): Promise<void> {
	await send(`/api/todos/${id}/restore`, { method: "POST" });
}

/** Where the page loads a file a todo holds. */
export function fileUrl(path: string): string {
	return scoped(`/api/file?${new URLSearchParams({ path })}`);
}

function todoForm(form: FormData, { subject, text, position }: TodoForm): void {
	form.set("subject", subject);
	form.set("text", text);
	if (position !== undefined) {
		form.set("position", String(position));
	}
}

function filesForm({ files, keep }: FilesForm): FormData {
	const form = new FormData();
	for (const file of files) {
		form.append("file", file, file.name);
	}
	for (const path of keep) {
		form.append("keep", path);
	}
	return form;
}

/**
 * The files and directories (ending in `/`) a task's tree holds, or the main
 * tree's for none: what `@` offers.
 */
export async function paths(task = ""): Promise<string[]> {
	const response = await fetch(
		scoped(`/api/paths?${new URLSearchParams({ task })}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/paths: ${response.status}`);
	}
	return (await response.json()) as string[];
}

/** What `task` changed against its base, uncommitted edits included. */
export async function taskDiff(task: string): Promise<FileDiff[]> {
	const response = await fetch(
		scoped(`/api/tasks/${encodeURIComponent(task)}/diff`),
	);
	if (!response.ok) {
		throw new ApiError("error", `${task}'s diff: ${response.status}`);
	}
	return (await response.json()) as FileDiff[];
}

/**
 * How `task` went once it merged, beside its project's week before; null
 * when it never merged here.
 */
export async function taskOutcome(task: string): Promise<Landed | null> {
	const response = await fetch(
		scoped(`/api/tasks/${encodeURIComponent(task)}/outcome`),
	);
	if (!response.ok) {
		throw new ApiError("error", `${task}'s outcome: ${response.status}`);
	}
	return (await response.json()) as Landed | null;
}

/**
 * Gives `task`, once it spent its merge attempts, another round of them, as
 * `splates retry` does.
 */
export async function retryTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}/retry`, {});
}

/**
 * `splates remove` for `task`, past any lease, stopping each conversation in
 * its tree and moving it to the main tree.
 */
export async function removeTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}`, { method: "DELETE" });
}

/**
 * How tasks ended across every project, summed for the Stats page over
 * `period`, narrowed to the main tree `project` when given.
 */
export async function stats(
	period: PeriodId,
	project?: string,
): Promise<Stats> {
	const path = `/api/stats?period=${period}${project === undefined ? "" : `&project=${encodeURIComponent(project)}`}`;
	const response = await fetch(path);
	if (!response.ok) {
		throw new ApiError("error", `${path}: ${response.status}`);
	}
	return (await response.json()) as Stats;
}

/**
 * The email Cloudflare Access signed this page's visitor in with, or null
 * when the page is opened on this machine or Access is off.
 */
export async function identity(): Promise<string | null> {
	const response = await fetch("/api/identity");
	if (!response.ok) {
		throw new ApiError("error", `/api/identity: ${response.status}`);
	}
	return ((await response.json()) as { email: string | null }).email;
}

/**
 * Each port a task serves now, with its link through the ports host, if one
 * is saved, and on the machine `splates server` runs on.
 */
export async function taskPorts(): Promise<PortLink[]> {
	const response = await fetch("/api/ports");
	if (!response.ok) {
		throw new ApiError("error", `/api/ports: ${response.status}`);
	}
	return ((await response.json()) as { ports: PortLink[] }).ports;
}

/**
 * What the page shows of the machine: its reading, its heavy jobs, and the
 * agents waiting for a slot on a worker, first in line first.
 */
export type MachineStatus = MachineReading & {
	heavy: HeavyJobsReading;
	queue: QueueListing[];
	/** Where the worker budget stands; null without a `workerProvider`. */
	workerBudget?: WorkerBudgetReport | null;
};

/** Moves the agent of conversation `id` to `position` in the queue for a worker slot, from 1. */
export async function moveQueued(id: string, position: number): Promise<void> {
	await send(`/api/queue/${encodeURIComponent(id)}/position`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ position }),
	});
}

/** How hard the machine `splates server` runs on is working right now. */
export async function machine(): Promise<MachineStatus> {
	const response = await fetch("/api/machine");
	if (!response.ok) {
		throw new ApiError("error", `/api/machine: ${response.status}`);
	}
	return (await response.json()) as MachineStatus;
}

/** Every worker, those turned away, and the build `splates server` runs, as `splates worker list` reads them. */
export async function workerPool(): Promise<WorkerPool> {
	const response = await fetch("/api/workers");
	if (!response.ok) {
		throw new ApiError("error", `/api/workers: ${response.status}`);
	}
	return (await response.json()) as WorkerPool;
}

/** A join token, single use, for `splates worker run --join` on another machine. */
export async function inviteWorker(): Promise<{
	token: string;
	expiresAt: number;
}> {
	return (await send("/api/workers/invite", {})) as {
		token: string;
		expiresAt: number;
	};
}

/** What can be set on a worker: its slots, null to go by its hello, and whether it drains. */
export interface WorkerChange {
	slots?: number | null;
	draining?: boolean;
}

/** Sets `change` on worker `id`, answering the pool as it then stands. */
export async function updateWorker(
	id: string,
	change: WorkerChange,
): Promise<WorkerPool> {
	return (await sendJson(
		`/api/workers/${encodeURIComponent(id)}`,
		"PUT",
		change,
	)) as WorkerPool;
}

/** Wakes worker `id`, asleep at home, answering the pool once its packet is sent. */
export async function wakeWorker(id: string): Promise<WorkerPool> {
	return (await send(`/api/workers/${encodeURIComponent(id)}/wake`, {
		method: "POST",
	})) as WorkerPool;
}

/**
 * Removes worker `id`, at once if nothing runs on it or `force`, which ends
 * what does; otherwise it drains and goes once `running` ends.
 */
export async function removeWorker(
	id: string,
	force: boolean,
): Promise<{ id: string; removed: boolean; running: string[] }> {
	return (await send(
		`/api/workers/${encodeURIComponent(id)}${force ? "?force" : ""}`,
		{ method: "DELETE" },
	)) as { id: string; removed: boolean; running: string[] };
}

/** This machine's setup: every step checked, by area, and the one to do next. */
export async function setup(): Promise<SetupProgress> {
	const response = await fetch(scoped("/api/setup"));
	if (!response.ok) {
		throw new ApiError("error", `/api/setup: ${response.status}`);
	}
	return (await response.json()) as SetupProgress;
}

/**
 * Presses Next on setup step `step` with what its page answered, answering
 * the fresh progress once the step reads done; an `ApiError` whose message
 * is one line on what went wrong otherwise.
 */
export async function nextSetupStep(
	step: string,
	answers: StepAnswers,
): Promise<SetupProgress> {
	return (await sendJson(
		`/api/setup/${encodeURIComponent(step)}/next`,
		"POST",
		{ answers },
	)) as SetupProgress;
}

/**
 * Starts moving the coordinator onto its box, which stops this server on its
 * way: answers where the move stands as it starts.
 */
export async function startCoordinatorMove(): Promise<MoveProgress> {
	return (await sendJson(
		"/api/setup/coordinator/move",
		"POST",
		{},
	)) as MoveProgress;
}

/**
 * Where the move stands as the server at this address says, which is the
 * box's once it has moved; throws while no server answers here.
 */
export async function coordinatorMoveProgress(): Promise<MoveProgress> {
	const response = await fetch("/api/setup/coordinator/move");
	if (!response.ok) {
		throw new ApiError(
			"error",
			`/api/setup/coordinator/move: ${response.status}`,
		);
	}
	return (await response.json()) as MoveProgress;
}

/** Marks setup seen on this machine, so the page stops nudging towards it. */
export async function seeSetup(): Promise<SetupProgress> {
	return (await sendJson("/api/setup/seen", "PUT", {})) as SetupProgress;
}

/** The public key this device subscribes to the server's pushes with. */
export async function pushKey(): Promise<string> {
	const response = await fetch("/api/push");
	if (!response.ok) {
		throw new ApiError("error", `/api/push: ${response.status}`);
	}
	return ((await response.json()) as { publicKey: string }).publicKey;
}

/** Has the server push this device the notices `wants` asks for, at `subscription`. */
export async function subscribePush(
	subscription: PushSubscriptionJSON,
	wants: Wants & { inFront: boolean },
): Promise<void> {
	await sendJson("/api/push/subscription", "PUT", { subscription, wants });
}

/** Has the server stop pushing to the subscription `endpoint` names. */
export async function unsubscribePush(endpoint: string): Promise<void> {
	await sendJson("/api/push/subscription", "DELETE", { endpoint });
}

/** What the project's store and the device's keep, by name, and what each store is called. */
export interface KeptCreds {
	kept: KeptCred[];
	labels: Record<Scope, string>;
}

/** The creds kept for this project and this device; never a value. */
export async function keptCreds(): Promise<KeptCreds> {
	const response = await fetch(scoped("/api/creds"));
	const body = (await response.json().catch(() => ({}))) as KeptCreds & {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/creds: ${response.status}`,
		);
	}
	return body;
}

/**
 * Keeps `value` as `name`: in the scope its open request asked for, else in
 * `scope`. The value goes to the store and never comes back.
 */
export async function saveCred(
	name: string,
	value: string,
	scope?: Scope,
): Promise<void> {
	await sendJson(`/api/creds/${encodeURIComponent(name)}`, "PUT", {
		value,
		scope,
	});
}

export async function removeCred(name: string, scope: Scope): Promise<void> {
	await send(
		`/api/creds/${encodeURIComponent(name)}?${new URLSearchParams({ scope })}`,
		{ method: "DELETE" },
	);
}

/** Every worker's API key, by whose and which provider's, with the providers and who may hold one. */
export interface WorkerKeysListing {
	keys: WorkerKey[];
	providers: KeyProvider[];
	holders: { workers: string[]; types: string[] };
}

/** The API keys workers hold; never a value. */
export async function workerKeys(): Promise<WorkerKeysListing> {
	const response = await fetch("/api/workers/keys");
	const body = (await response
		.json()
		.catch(() => ({}))) as WorkerKeysListing & {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/workers/keys: ${response.status}`,
		);
	}
	return body;
}

/** Keeps `value` as `provider`'s key for `holder`, over the one it held. */
export async function addWorkerKey(
	holder: KeyHolder,
	provider: string,
	value: string,
): Promise<void> {
	await sendJson("/api/workers/keys", "PUT", { provider, ...holder, value });
}

/** Deletes `provider`'s key for `holder`. */
export async function removeWorkerKey(
	holder: KeyHolder,
	provider: string,
): Promise<void> {
	await send(
		`/api/workers/keys?${new URLSearchParams({ provider, ...holder })}`,
		{ method: "DELETE" },
	);
}

/** Turns down the open request for `name`, so the agent waiting on it stops. */
export async function dismissCred(name: string): Promise<void> {
	await send(`/api/creds/${encodeURIComponent(name)}/dismiss`, {});
}

/**
 * Where a project's scry budgets stand, as `scry budgets --format json`
 * prints it; splates only passes it on, so this mirrors the CLI's type.
 */
export interface Budgets {
	/** Whether any config or change declares budgets. */
	declared: boolean;
	roles: RoleBudget[];
}

/** Where one model's budget stands. */
export interface RoleBudget {
	role: "som" | "llm";
	/** Like `5m/day`, `nothing` or `unlimited`; none when undeclared. */
	spend: string | null;
	/** The config or file that declared it. */
	from: string | null;
	/** Whether it was set here, over the configs. */
	set: boolean;
	standing: {
		/** Like `today` or `the last 7d`. */
		window: string;
		tokens: number;
		raised: number;
		spent: number;
		left: number;
	}[];
	raises: { id: number; tokens: number; from: number; until: number }[];
	/** The pause stopping it asking anything; none when it asks as it may. */
	paused: { from: number; until: number } | null;
}

export async function budgets(): Promise<Budgets> {
	const response = await fetch(scoped("/api/budgets"));
	const body = (await response.json().catch(() => ({}))) as Budgets & {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/budgets: ${response.status}`,
		);
	}
	return body;
}

/** Sets what `role` may spend here, like `5m/day`; null gives it back to the configs. */
export async function setBudget(
	role: RoleBudget["role"],
	spend: string | null,
): Promise<Budgets> {
	return (await sendJson(`/api/budgets/${role}`, "PUT", { spend })) as Budgets;
}

/** Adds `tokens`, like `2m`, to each of `role`'s limits `span`, like `1d`. */
export async function raiseBudget(
	role: RoleBudget["role"],
	tokens: string,
	span: string,
): Promise<Budgets> {
	return (await sendJson(`/api/budgets/${role}/raises`, "POST", {
		tokens,
		for: span,
	})) as Budgets;
}

/** Stops `role` asking anything for `span`, like `1d`. */
export async function pauseBudget(
	role: RoleBudget["role"],
	span: string,
): Promise<Budgets> {
	return (await sendJson(`/api/budgets/${role}/pause`, "PUT", {
		for: span,
	})) as Budgets;
}

/** Lets a paused `role` ask again before its pause ends. */
export async function resumeBudget(role: RoleBudget["role"]): Promise<Budgets> {
	return (await send(`/api/budgets/${role}/pause`, {
		method: "DELETE",
	})) as Budgets;
}

export async function endRaise(id: number): Promise<Budgets> {
	return (await send(`/api/budgets/raises/${id}`, {
		method: "DELETE",
	})) as Budgets;
}

/**
 * Opens `path` in `editor` on this machine, inside the tree it belongs to,
 * at `line` when there is one.
 */
export async function openFile(
	editor: string,
	path: string,
	line: number | null,
): Promise<void> {
	await sendJson("/api/open", "POST", { editor, path, line });
}

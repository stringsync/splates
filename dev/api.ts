/**
 * The page's writes: the same core functions as `arbor todo add`, `update`
 * and `remove`, and the lanes' own.
 * A refusal comes back as the CLI's own reason and message, thrown so the
 * caller can show it.
 */

import type { KeptCred, Scope } from "../creds";
import type { PortLink } from "../dev-task-ports";
import type { FileDiff } from "../diff";
import type { HeavyJobsReading } from "../heavy";
import type { Landed } from "../landed";
import type { MachineReading } from "../machine";
import type { Wants } from "../notices";
import type { AgentPick } from "../roster";
import type { SetupProgress } from "../setup";
import type { PeriodId, Stats } from "../stats";
import type { SystemsReport } from "../system-changes";
import type { NamedSystem } from "../systems";

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
 * for the one `arbor dev` started in, unless `path` names one itself. Every
 * request the page makes goes through here.
 */
export function scoped(path: string): string {
	const project = new URLSearchParams(location.search).get("project");
	if (project === null || project === "" || path.includes("project=")) {
		return path;
	}
	const query = new URLSearchParams({ project });
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

/** Every system `task`'s worktree names, or the main tree's for none. */
export async function systems(task = ""): Promise<NamedSystem[]> {
	const response = await fetch(
		scoped(`/api/systems?${new URLSearchParams({ task })}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/systems: ${response.status}`);
	}
	return (await response.json()) as NamedSystem[];
}

/** What each system holds on trunk, and the commits that lately changed it. */
export async function systemChanges(): Promise<SystemsReport> {
	const response = await fetch(scoped("/api/systems/changes"));
	if (!response.ok) {
		throw new ApiError("error", `/api/systems/changes: ${response.status}`);
	}
	return (await response.json()) as SystemsReport;
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
 * Gives `task`, escalated once it spent its merge attempts, another round of
 * them, as `arbor retry` does.
 */
export async function retryTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}/retry`, {});
}

/**
 * `arbor remove` for `task`, past any lease, stopping each conversation in
 * its tree and moving it to the main tree.
 */
export async function removeTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}`, { method: "DELETE" });
}

/**
 * How tasks ended across every project, summed for the Stats page over
 * `period`.
 */
export async function stats(period: PeriodId): Promise<Stats> {
	const path = `/api/stats?period=${period}`;
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
 * is saved, and on the machine `arbor dev` runs on.
 */
export async function taskPorts(): Promise<PortLink[]> {
	const response = await fetch("/api/ports");
	if (!response.ok) {
		throw new ApiError("error", `/api/ports: ${response.status}`);
	}
	return ((await response.json()) as { ports: PortLink[] }).ports;
}

/** What the page shows of the machine: its reading, and its heavy jobs. */
export type MachineStatus = MachineReading & { heavy: HeavyJobsReading };

/** How hard the machine `arbor dev` runs on is working right now. */
export async function machine(): Promise<MachineStatus> {
	const response = await fetch("/api/machine");
	if (!response.ok) {
		throw new ApiError("error", `/api/machine: ${response.status}`);
	}
	return (await response.json()) as MachineStatus;
}

/** This machine's setup: every step checked, by area, and the one to do next. */
export async function setup(): Promise<SetupProgress> {
	const response = await fetch("/api/setup");
	if (!response.ok) {
		throw new ApiError("error", `/api/setup: ${response.status}`);
	}
	return (await response.json()) as SetupProgress;
}

/** Skips setup step `step`, or asks for it again, answering the fresh progress. */
export async function skipSetupStep(
	step: string,
	skipped: boolean,
): Promise<SetupProgress> {
	return (await sendJson(
		`/api/setup/${encodeURIComponent(step)}/skipped`,
		"PUT",
		{ skipped },
	)) as SetupProgress;
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

/** Turns down the open request for `name`, so the agent waiting on it stops. */
export async function dismissCred(name: string): Promise<void> {
	await send(`/api/creds/${encodeURIComponent(name)}/dismiss`, {});
}

/**
 * Where a project's scry budgets stand, as `wiz scry budgets --format json`
 * prints it; arbor only passes it on, so this mirrors the CLI's type.
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

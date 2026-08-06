import type { Ctx } from "./context";

export type Status = "working" | "grafting" | "escalated";

export interface Lease {
	pid: number;
	hostname: string;
	heartbeatAt: string;
}

export interface Escalation {
	reason: string;
	at: string;
}

export interface TaskState {
	task: string;
	branch: string;
	worktree: string;
	status: Status;
	lease: Lease | null;
	port: number;
	graftAttempts: number;
	createdAt: string;
	updatedAt: string;
	escalations?: Escalation[];
}

export function statePath(ctx: Ctx, task: string): string {
	return `${ctx.tasksDir}/${task}.json`;
}

/** Null when there is no state file. Throws when there is one and it is junk. */
export async function readState(
	ctx: Ctx,
	task: string,
): Promise<TaskState | null> {
	const raw = await ctx.fs.read(statePath(ctx, task)).catch(() => null);
	if (raw === null) {
		return null;
	}
	return JSON.parse(raw) as TaskState;
}

/**
 * Write to a temp path in the same directory, then rename. A half-written
 * state file read by a concurrent agent is a real failure mode; rename is the
 * only way to make the swap atomic.
 */
export async function writeState(ctx: Ctx, state: TaskState): Promise<void> {
	const path = statePath(ctx, state.task);
	const tmp = `${path}.${ctx.ps.pid}.tmp`;
	const next = { ...state, updatedAt: new Date().toISOString() };
	await ctx.fs.write(tmp, `${JSON.stringify(next, null, "\t")}\n`);
	await ctx.fs.rename(tmp, path);
}

export async function removeState(ctx: Ctx, task: string): Promise<void> {
	await ctx.fs.rm(statePath(ctx, task), { force: true });
}

export async function listStates(ctx: Ctx): Promise<string[]> {
	const entries = await ctx.fs.readdir(ctx.tasksDir).catch(() => []);
	return entries
		.filter((e) => e.endsWith(".json"))
		.map((e) => e.slice(0, -".json".length))
		.sort();
}

export function ourLease(ctx: Ctx): Lease {
	return {
		pid: ctx.ps.pid,
		hostname: ctx.ps.hostname,
		heartbeatAt: new Date().toISOString(),
	};
}

/**
 * Live means "someone is driving this tree right now": a fresh heartbeat and,
 * when the holder is on this host, a pid that still exists. The pid check
 * matters because every arbor command is its own short-lived process — without
 * it, a tree stays locked for the staleness window after a command that merely
 * finished, and `create` would block the `graft` that follows it.
 */
export function leaseIsLive(ctx: Ctx, lease: Lease | null): boolean {
	if (!lease) {
		return false;
	}
	const age = Date.now() - Date.parse(lease.heartbeatAt);
	if (!(age < ctx.config.leaseStalenessMs)) {
		return false;
	}
	return lease.hostname === ctx.ps.hostname ? ctx.ps.alive(lease.pid) : true;
}

export function leaseIsOurs(ctx: Ctx, lease: Lease | null): boolean {
	return lease?.pid === ctx.ps.pid && lease.hostname === ctx.ps.hostname;
}

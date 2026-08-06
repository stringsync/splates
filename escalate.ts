import { rmSync } from "node:fs";
import { color } from "@webappwiz/log";
import type { Ctx } from "./context";
import { fail } from "./exit";
import { currentBranch } from "./git";
import { readState, writeState } from "./state";

/**
 * The way out that is not "resolve the conflict badly to finish the task".
 * When both sides restructured the same logic there is no correct merge, only
 * a decision — and that belongs to a human.
 */
export async function escalate(
	ctx: Ctx,
	reason: string,
	cwd: string,
	task?: string,
): Promise<void> {
	const name = task || (await taskFromCwd(ctx, cwd));
	if (!name) {
		fail(
			ctx,
			"usage",
			"not in a task worktree — pass --task <name> to escalate from elsewhere",
			{},
		);
	}
	const state = await readState(ctx, name);
	if (!state) {
		fail(ctx, "not_found", `no state file for '${name}'`, { task: name });
	}

	const escalations = [
		...(state.escalations ?? []),
		{ reason, at: new Date().toISOString() },
	];
	// The worktree is left exactly as it is: a human needs to see what the
	// agent saw, conflict markers and all.
	await writeState(ctx, {
		...state,
		status: "escalated",
		lease: null,
		escalations,
	});
	await releaseOurLock(ctx);

	ctx.log.info(
		[
			`${color.yellow("escalated")} ${name}`,
			`  worktree: ${state.worktree}`,
			`  branch:   ${state.branch}`,
			`  reason:   ${reason}`,
			escalations.length > 1
				? `  (${escalations.length} escalations recorded)`
				: "",
			"",
			"Left untouched for a human. Stop working on this task.",
		]
			.filter(Boolean)
			.join("\n"),
	);
}

async function taskFromCwd(ctx: Ctx, cwd: string): Promise<string | null> {
	const branch = await currentBranch(ctx, cwd).catch(() => "");
	return branch.startsWith("task/") ? branch.slice("task/".length) : null;
}

async function releaseOurLock(ctx: Ctx): Promise<void> {
	const raw = await ctx.fs
		.read(`${ctx.lockPath}/holder.json`)
		.catch(() => null);
	if (!raw) {
		return;
	}
	try {
		const holder = JSON.parse(raw) as { pid: number; hostname: string };
		if (holder.pid === ctx.ps.pid && holder.hostname === ctx.ps.hostname) {
			rmSync(ctx.lockPath, { recursive: true, force: true });
		}
	} catch {
		// Unparseable holder is someone else's problem; the stale-lock path in
		// lock.ts deals with it.
	}
}

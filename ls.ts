import { color } from "@webappwiz/log";
import type { Ctx } from "./context";
import { commitsAhead } from "./git";
import { leaseIsLive, listStates, readState } from "./state";

interface Row {
	task: string;
	status: string;
	lease: "live" | "cold" | "none";
	branch: string;
	ahead: number | null;
	port: number | null;
	age: string;
	worktree: string | null;
}

export async function ls(ctx: Ctx, { json = false } = {}): Promise<void> {
	const rows: Row[] = [];
	for (const task of await listStates(ctx)) {
		rows.push(await row(ctx, task));
	}

	if (json) {
		ctx.log.info(JSON.stringify(rows, null, "\t"));
		return;
	}
	if (rows.length === 0) {
		ctx.log.info("no workstreams — run `arbor create <task>` to start one");
		return;
	}
	ctx.log.info(table(rows));
}

async function row(ctx: Ctx, task: string): Promise<Row> {
	const base = {
		task,
		branch: `task/${task}`,
		ahead: null,
		port: null,
		age: "?",
		worktree: null,
	};
	// One bad file must not take down the listing.
	const state = await readState(ctx, task).catch(() => null);
	if (!state) {
		return { ...base, status: "unknown", lease: "none" };
	}
	const gone = !(await ctx.fs.exists(state.worktree));
	return {
		task,
		status: gone ? "orphaned" : state.status,
		lease: state.lease
			? leaseIsLive(ctx, state.lease)
				? "live"
				: "cold"
			: "none",
		branch: state.branch,
		ahead: await commitsAhead(ctx, state.branch),
		port: state.port,
		age: age(state.createdAt),
		worktree: state.worktree,
	};
}

function age(since: string): string {
	const minutes = Math.floor((Date.now() - Date.parse(since)) / 60_000);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	if (minutes < 60 * 24) {
		return `${Math.floor(minutes / 60)}h`;
	}
	return `${Math.floor(minutes / (60 * 24))}d`;
}

function table(rows: Row[]): string {
	const header = ["TASK", "STATUS", "LEASE", "BRANCH", "AHEAD", "PORT", "AGE"];
	const cells = rows.map((r) => [
		r.task,
		r.status,
		r.lease,
		r.branch,
		r.ahead === null ? "?" : String(r.ahead),
		r.port === null ? "?" : String(r.port),
		r.age,
	]);
	const widths = header.map((h, i) =>
		Math.max(h.length, ...cells.map((c) => (c[i] ?? "").length)),
	);
	const line = (cs: string[]): string =>
		cs
			.map((c, i) => c.padEnd(widths[i] ?? 0))
			.join("  ")
			.trimEnd();
	const out = [color.dim(line(header)), ...cells.map(line)];
	const orphaned = rows.filter((r) => r.status === "orphaned");
	if (orphaned.length > 0) {
		out.push(
			"",
			color.yellow(
				`${orphaned.length} orphaned record(s) — run \`arbor prune ${orphaned[0]?.task}\``,
			),
		);
	}
	return out.join("\n");
}

import { color, type Logger } from "@webappwiz/log";
import type { Worktree } from "../lib/worktree";
import type { WorktreeStore } from "../lib/worktree-store";

interface Row {
	task: string;
	status: string;
	lease: "live" | "cold" | "none";
	branch: string;
	ahead: number | null;
	age: string;
	worktree: string | null;
}

export async function ls(
	{ store, log }: { store: WorktreeStore; log: Logger },
	{ json = false } = {},
): Promise<void> {
	const rows: Row[] = [];
	for (const worktree of await store.list()) {
		rows.push(await row(worktree));
	}

	if (json) {
		log.info(JSON.stringify(rows, null, "\t"));
		return;
	}
	if (rows.length === 0) {
		log.info("no workstreams — run `arbor create <task>` to start one");
		return;
	}
	log.info(table(rows));
}

async function row(worktree: Worktree): Promise<Row> {
	const { state } = worktree;
	return {
		task: worktree.task,
		// One unreadable record shows as `unknown` instead of taking down the
		// whole listing.
		status: worktree.status,
		lease: !state?.lease ? "none" : worktree.leaseLive ? "live" : "cold",
		branch: worktree.branch,
		ahead: state ? await worktree.commitsAhead() : null,
		age: state ? age(state.createdAt) : "?",
		worktree: state ? worktree.path : null,
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
	const header = ["TASK", "STATUS", "LEASE", "BRANCH", "AHEAD", "AGE"];
	const cells = rows.map((r) => [
		r.task,
		r.status,
		r.lease,
		r.branch,
		r.ahead === null ? "?" : String(r.ahead),
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

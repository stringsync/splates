import { color, type Logger } from "@webappwiz/log";
import { age } from "../lib/age";
import { table } from "../lib/table";
import type { Worktree } from "../lib/worktree";
import type { WorktreeStore } from "../lib/worktree-store";

interface Row {
	task: string;
	status: string;
	lease: "live" | "cold" | "none";
	ahead: number | null;
	added: number | null;
	removed: number | null;
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
	log.info(listing(rows));
}

async function row(worktree: Worktree): Promise<Row> {
	const { state } = worktree;
	const diff = state ? await worktree.diffStat() : null;
	return {
		task: worktree.task,
		// One unreadable record shows as `unknown` instead of taking down the
		// whole listing.
		status: worktree.status,
		lease: worktree.leaseStatus,
		ahead: state ? await worktree.commitsAhead() : null,
		added: diff?.added ?? null,
		removed: diff?.removed ?? null,
		age: state ? age(state.createdAt) : "?",
		worktree: state ? worktree.path : null,
	};
}

function diff(row: Row): string {
	if (row.added === null || row.removed === null) {
		return "?";
	}
	return `${color.green(`+${row.added}`)} ${color.red(`-${row.removed}`)}`;
}

function listing(rows: Row[]): string {
	const cells = rows.map((r) => [
		r.task,
		r.status,
		r.lease,
		r.ahead === null ? "?" : String(r.ahead),
		diff(r),
		r.age,
	]);
	const out = [
		table(["TASK", "STATUS", "LEASE", "AHEAD", "DIFF", "AGE"], cells),
	];
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

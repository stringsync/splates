import { color, type Logger } from "webappwiz/log";
import { age } from "./age";
import { table } from "./table";
import type { Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

interface Row {
	task: string;
	status: string;
	lease: "held" | "stale" | "none";
	ahead: number | null;
	added: number | null;
	removed: number | null;
	age: string;
	worktree: string | null;
}

export interface ListOptions {
	/** Print the rows as JSON instead of a table. */
	json?: boolean;
}

export async function list(
	{ service, log }: { service: WorktreeService; log: Logger },
	{ json = false }: ListOptions = {},
): Promise<void> {
	const rows: Row[] = [];
	for (const worktree of await service.list()) {
		rows.push(await row(worktree));
	}

	if (json) {
		log.info(JSON.stringify(rows, null, "\t"));
		return;
	}
	if (rows.length === 0) {
		log.info("no tasks: run `arbor add <task>` to start one");
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
	const cells = rows.map((row) => [
		row.task,
		row.status,
		row.lease,
		row.ahead === null ? "?" : String(row.ahead),
		diff(row),
		row.age,
	]);
	const out = [
		table(["TASK", "STATUS", "LEASE", "AHEAD", "DIFF", "AGE"], cells),
	];
	const orphaned = rows.filter((row) => row.status === "orphaned");
	if (orphaned.length > 0) {
		out.push(
			"",
			color.yellow(
				`${orphaned.length} orphaned record(s): run \`arbor rm ${orphaned[0]?.task}\``,
			),
		);
	}
	return out.join("\n");
}

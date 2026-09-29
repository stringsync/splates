import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { age } from "./age";
import { PLAN_FILE, plannedFiles } from "./plan";
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
	/** Paths the task has touched, committed or not; only with `files`. */
	changed?: string[] | null;
	/** Paths its `ARBOR.md` plans to touch; only with `files`. */
	planned?: string[];
}

export interface ListOptions {
	/** Print the rows as JSON instead of a table. */
	json?: boolean;
	/**
	 * Add each task's changed and planned files, which is what an agent checks
	 * its own plan against before starting. Off by default: it costs git calls
	 * and a file read per task.
	 */
	files?: boolean;
}

export async function list(
	{ service, log, fs }: { service: WorktreeService; log: Logger; fs: Fs },
	{ json = false, files = false }: ListOptions = {},
): Promise<void> {
	const rows: Row[] = [];
	for (const worktree of await service.list()) {
		const base = await row(worktree);
		rows.push(files ? { ...base, ...(await paths(worktree, fs)) } : base);
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

async function paths(
	worktree: Worktree,
	fs: Fs,
): Promise<Pick<Row, "changed" | "planned">> {
	const plan = worktree.exists
		? await fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => null)
		: null;
	return {
		changed: worktree.hasBranch ? await worktree.changedFiles() : null,
		planned: plan === null ? [] : plannedFiles(plan),
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
	for (const row of rows) {
		if (row.changed !== undefined) {
			out.push("", ...files(row));
		}
	}
	const orphaned = rows.filter((row) => row.status === "orphaned");
	if (orphaned.length > 0) {
		out.push(
			"",
			color.yellow(
				`${orphaned.length} orphaned record(s): run \`arbor remove ${orphaned[0]?.task}\``,
			),
		);
	}
	return out.join("\n");
}

/**
 * One task's paths, each once: `changed` when the task has touched it,
 * `planned` when only its `ARBOR.md` names it so far.
 */
function files(row: Row): string[] {
	const changed = row.changed ?? [];
	const planned = (row.planned ?? []).filter((path) => !changed.includes(path));
	const lines = [
		...changed.map((path) => `  changed  ${path}`),
		...planned.map((path) => `  ${color.dim("planned")}  ${path}`),
	];
	return [
		color.bold(row.task),
		...(lines.length > 0 ? lines : [color.dim("  no files yet")]),
	];
}

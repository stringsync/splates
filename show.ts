import { color, type Logger } from "@webappwiz/log";
import { type Fs, NodeFs } from "@webappwiz/sys";
import { age } from "./age";
import { fail } from "./exit";
import { checkPlan } from "./plan";
import type { Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

const FILE = "ARBOR.md";

export interface Details {
	task: string;
	status: string;
	branch: string;
	base: string;
	worktree: string;
	lease: "held" | "stale" | "none";
	ahead: number | null;
	added: number | null;
	removed: number | null;
	age: string | null;
	escalation: string | null;
	plan: string | null;
	/** How the `ARBOR.md` departs from the shape the skill prescribes. */
	planProblems: string[];
}

export interface ShowOptions {
	/** Print the details as JSON instead of prose. */
	json?: boolean;
}

/**
 * One task in full: what `ls` shows for it, plus the `ARBOR.md` its agent
 * left at the worktree root. Reading a tree this way takes no lease, so it
 * cannot knock the agent driving it off its own work.
 */
export async function show(
	{ service, fs, log }: { service: WorktreeService; fs: Fs; log: Logger },
	task: string,
	{ json = false }: ShowOptions = {},
): Promise<void> {
	const worktree = await service.find(task);
	if (worktree.gone) {
		fail(
			"not_found",
			`no task '${task}': run \`arbor ls\` to see what there is`,
			{ task },
		);
	}
	const details = await taskDetails(worktree, fs);

	if (json) {
		log.info(JSON.stringify(details, null, "\t"));
		return;
	}
	log.info(report(details));
}

/**
 * Everything there is to say about one task. Split out so `dev` can render the
 * same fields this prints, rather than assembling its own and drifting.
 */
export async function taskDetails(
	worktree: Worktree,
	fs?: Fs,
): Promise<Details> {
	const files = fs ?? new NodeFs();
	const { state } = worktree;
	// A record whose worktree or branch is gone is still worth showing: the
	// status names what is wrong, and asking git about a branch that is not
	// there would only fill the fields with nulls.
	const stat = worktree.hasBranch ? await worktree.diffStat() : null;
	const plan = worktree.exists
		? await files.read(`${worktree.path}/${FILE}`).catch(() => null)
		: null;
	return {
		task: worktree.task,
		status: worktree.status,
		branch: worktree.branch,
		base: worktree.base,
		worktree: worktree.path,
		lease: worktree.leaseStatus,
		ahead: worktree.hasBranch ? await worktree.commitsAhead() : null,
		added: stat?.added ?? null,
		removed: stat?.removed ?? null,
		age: state ? age(state.createdAt) : null,
		escalation: state?.escalations?.at(-1)?.reason ?? null,
		plan,
		planProblems:
			plan === null
				? []
				: checkPlan(plan, {
						task: worktree.task,
						escalated: worktree.status === "escalated",
					}),
	};
}

function report(details: Details): string {
	const lines = [
		`${color.bold(details.task)} ${details.status}`,
		`  branch:    ${details.branch}`,
		`  base:      ${details.base}`,
		`  worktree:  ${details.worktree}`,
		`  lease:     ${details.lease}`,
		`  ahead:     ${details.ahead === null ? "?" : details.ahead}  ${diff(details)}`,
		`  age:       ${details.age ?? "?"}`,
	];
	if (details.escalation !== null) {
		lines.push(`  ${color.yellow(`escalated: ${details.escalation}`)}`);
	}
	if (details.plan !== null) {
		lines.push("", color.bold(FILE), details.plan.trimEnd());
		for (const problem of details.planProblems) {
			lines.push(color.yellow(`  ${problem}`));
		}
	} else if (details.status !== "orphaned") {
		lines.push(
			"",
			color.yellow(`no ${FILE}: whoever picks this up starts from the diff`),
		);
	}
	return lines.join("\n");
}

function diff(details: Details): string {
	if (details.added === null || details.removed === null) {
		return "?";
	}
	return `${color.green(`+${details.added}`)} ${color.red(`-${details.removed}`)}`;
}

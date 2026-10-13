import { color, type Logger } from "webappwiz/log";
import { type Fs, NodeFs } from "webappwiz/system";
import { age } from "./age";
import { fail } from "./exit";
import { checkPlan, PLAN_FILE, ready, unfinished } from "./plan";
import { type NamedSystem, Systems } from "./systems";
import type { Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

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
	/** When it was added, which `age` counts from. */
	createdAt: string | null;
	escalation: string | null;
	/** The merges it has tried; at `mergeAttemptLimit`, only `arbor retry` lets it try again. */
	mergeAttempts: number;
	mergeAttemptLimit: number;
	/** While escalated, when it was; null otherwise. */
	escalatedAt: string | null;
	/**
	 * While escalated to be approved, what to look at before approving; null
	 * otherwise.
	 */
	review: string | null;
	/**
	 * Whether the plan leaves nothing unchecked under `## Blocked` or
	 * `## Next`, which `arbor merge` and `arbor escalate --review` require.
	 */
	ready: boolean;
	plan: string | null;
	/** How the `ARBOR.md` departs from the shape the skill prescribes. */
	planProblems: string[];
	/**
	 * Whether `arbor add --agent` handed it to an agent that `arbor dev` has
	 * yet to start a conversation with.
	 */
	dispatched: boolean;
	/**
	 * The systems its changed files fall in, committed or not, in the order
	 * its worktree's `arbor.config.ts` names them.
	 */
	systems: NamedSystem[];
}

export interface ShowOptions {
	/** Print the details as JSON instead of prose. */
	json?: boolean;
}

/**
 * One task in full: what `list` shows for it, plus the `ARBOR.md` its agent
 * left at the worktree root. Reading a tree this way takes no lease, so it
 * cannot knock the agent driving it off its own work.
 */
export async function show(
	{ service, fs, log }: { service: WorktreeService; fs: Fs; log: Logger },
	task: string,
	opts: ShowOptions = {},
): Promise<void> {
	const worktree = await service.find(task);
	if (worktree.gone) {
		fail(
			"not_found",
			`no task '${task}': run \`arbor list\` to see what there is`,
			{ task },
		);
	}
	const details = await new TaskDetails({ fs }).get(worktree);

	if (opts.json ?? false) {
		log.info(JSON.stringify(details, null, "\t"));
		return;
	}
	log.info(report(details));
}

/** Configures how {@link TaskDetails} gathers a task's info. */
export interface TaskDetailsOptions {
	/** What the worktree is read through; the real filesystem by default. */
	fs?: Fs;
}

/**
 * Everything there is to say about one task. Split out so `dev` can render the
 * same fields this prints, rather than assembling its own and drifting.
 */
export class TaskDetails {
	private readonly fs: Fs;

	constructor(opts: TaskDetailsOptions = {}) {
		this.fs = opts.fs ?? new NodeFs();
	}

	async get(worktree: Worktree): Promise<Details> {
		const { state } = worktree;
		// A record whose worktree or branch is gone is still worth showing: the
		// status names what is wrong, and asking git about a branch that is not
		// there would only fill the fields with nulls.
		const stat = worktree.hasBranch ? await worktree.diffStat() : null;
		const plan = worktree.exists
			? await this.fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => null)
			: null;
		const last = state?.escalations?.at(-1);
		const review =
			state?.status === "escalated" && last?.review ? last.reason : null;
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
			createdAt: state?.createdAt ?? null,
			escalation: last?.reason ?? null,
			mergeAttempts: worktree.mergeAttempts,
			mergeAttemptLimit: worktree.mergeAttemptLimit,
			escalatedAt: state?.status === "escalated" ? (last?.at ?? null) : null,
			review,
			ready: ready(unfinished(plan ?? "")),
			plan,
			planProblems:
				plan === null
					? []
					: checkPlan(plan, {
							task: worktree.task,
							escalated: worktree.status === "escalated",
							review: review !== null,
						}),
			dispatched:
				state?.dispatch !== undefined &&
				state.dispatch.conversation === undefined,
			systems: await this.systems(worktree),
		};
	}

	/**
	 * Read from its own worktree, so a system named during the task counts at
	 * once. Its changed files cost three git calls, spent only once there is a
	 * system to match them against.
	 */
	private async systems(worktree: Worktree): Promise<NamedSystem[]> {
		if (!worktree.exists) {
			return [];
		}
		// A config the agent is halfway through editing names none for now,
		// rather than taking the whole page down with it.
		const named = await Systems.at(worktree.path, { fs: this.fs }).catch(
			() => null,
		);
		if (named === null || named.all().length === 0) {
			return [];
		}
		return named.touchedBy((await worktree.changedFiles()) ?? []);
	}
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
		...(details.systems.length > 0
			? [
					`  systems:   ${details.systems.map((system) => system.name).join(", ")}`,
				]
			: []),
	];
	if (details.review !== null) {
		lines.push(`  ${color.green(`ready to merge: ${details.review}`)}`);
	} else if (details.escalation !== null) {
		lines.push(`  ${color.yellow(`escalated: ${details.escalation}`)}`);
	}
	if (details.plan !== null) {
		lines.push("", color.bold(PLAN_FILE), details.plan.trimEnd());
		for (const problem of details.planProblems) {
			lines.push(color.yellow(`  ${problem}`));
		}
	} else if (details.status !== "orphaned") {
		lines.push(
			"",
			color.yellow(
				`no ${PLAN_FILE}: whoever picks this up starts from the diff`,
			),
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

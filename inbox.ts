import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { PLAN_FILE, type Question, questions } from "./plan";
import type { WorktreeStatus } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/** An open question, with the task that asked it. */
export interface OpenQuestion extends Question {
	task: string;
	status: WorktreeStatus;
	/**
	 * `held` means the asking agent is in a live session: answer it there,
	 * since `arbor reply` refuses a tree someone is driving.
	 */
	lease: "held" | "stale" | "none";
}

/** How many open questions carry a tag, for picking a slice to answer. */
export interface TagCount {
	tag: string;
	count: number;
}

export interface Inbox {
	/** Open questions, by task name and then in the order each plan lists them. */
	questions: OpenQuestion[];
	/** Every tag on an open question, the busiest first, whatever the filter. */
	tags: TagCount[];
}

export interface InboxOptions {
	/** Keep only the questions carrying any of these; none keeps every one. */
	tags?: string[];
}

/**
 * Every question still waiting on a person, across all tasks: the unchecked
 * items under each worktree's `## Blocked`. One answered but not yet checked
 * off is still here, with its reply, because the agent has not acted on it.
 *
 * Returns data rather than printing it, so the CLI and the dev server show the
 * same inbox.
 */
export async function openQuestions(
	{ service, fs }: { service: WorktreeService; fs: Fs },
	{ tags = [] }: InboxOptions = {},
): Promise<Inbox> {
	const open: OpenQuestion[] = [];
	for (const worktree of await service.list()) {
		const plan = worktree.exists
			? await fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => null)
			: null;
		if (plan === null) {
			continue;
		}
		for (const question of questions(plan)) {
			if (!question.done) {
				open.push({
					task: worktree.task,
					status: worktree.status,
					lease: worktree.leaseStatus,
					...question,
				});
			}
		}
	}
	return {
		questions:
			tags.length === 0
				? open
				: open.filter((question) =>
						question.tags.some((tag) => tags.includes(tag)),
					),
		tags: counts(open),
	};
}

export interface InboxPrintOptions extends InboxOptions {
	/** Print the inbox as JSON instead of a listing. */
	json?: boolean;
}

/** `arbor inbox`: the open questions, grouped by task. */
export async function inbox(
	deps: { service: WorktreeService; fs: Fs; log: Logger },
	{ json = false, tags = [] }: InboxPrintOptions = {},
): Promise<void> {
	const found = await openQuestions(deps, { tags });
	if (json) {
		deps.log.info(JSON.stringify(found, null, "\t"));
		return;
	}
	if (found.questions.length === 0) {
		deps.log.info(
			tags.length === 0
				? "no open questions"
				: `no open questions tagged ${tags.join(", ")}`,
		);
		return;
	}
	deps.log.info(listing(found));
}

/**
 * One question as the inbox prints it: `Q9 [ui] text`, and under it the
 * reply the agent has yet to act on, if there is one.
 */
export function formatQuestion(question: Question): string[] {
	const tags =
		question.tags.length === 0 ? "" : ` [${question.tags.join(", ")}]`;
	const lines = [
		`  ${question.number}${tags} ${question.text}`,
		...question.choices.map(({ key, text }) => `      (${key}) ${text}`),
	];
	if (question.reply !== null) {
		lines.push(color.dim(`    → ${question.reply}`));
	}
	return lines;
}

function listing({ questions, tags }: Inbox): string {
	const out: string[] = [];
	if (tags.length > 0) {
		out.push(
			color.dim(tags.map(({ tag, count }) => `${tag} ${count}`).join("  ")),
		);
	}
	let task: string | null = null;
	for (const question of questions) {
		if (question.task !== task) {
			task = question.task;
			// `reply` refuses a live tree, so say where the answer goes instead.
			const live =
				question.lease === "held"
					? color.dim(" (in a live session: answer it there)")
					: "";
			out.push(...(out.length > 0 ? [""] : []), `${color.bold(task)}${live}`);
		}
		out.push(...formatQuestion(question));
	}
	return out.join("\n");
}

function counts(open: Question[]): TagCount[] {
	const tally = new Map<string, number>();
	for (const tag of open.flatMap((question) => question.tags)) {
		tally.set(tag, (tally.get(tag) ?? 0) + 1);
	}
	return [...tally]
		.map(([tag, count]) => ({ tag, count }))
		.sort(
			(left, right) =>
				right.count - left.count || left.tag.localeCompare(right.tag),
		);
}

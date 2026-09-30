import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { PLAN_FILE, type Question, questions } from "./plan";
import { type Replies, type ReplyState, replyText } from "./replies";
import type { WorktreeStatus } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/** A question, with the task that asked it and where it stands. */
export interface OpenQuestion extends Question {
	task: string;
	status: WorktreeStatus;
	/**
	 * `held` means the asking agent is in a live session: answer it there,
	 * since `arbor reply` refuses a tree someone is driving.
	 */
	lease: "held" | "stale" | "none";
	/**
	 * A reply or follow-up given and waiting for the agent to claim it, or
	 * null.
	 */
	pending: ReplyState | null;
	/**
	 * Where it stands. `open` waits on a person. `waiting` has a reply its
	 * agent has yet to read, which can still be edited. `editing` is held by
	 * someone changing it. `read` has been claimed by its agent, which has yet
	 * to check it off. `done` is checked off. A follow-up takes a `read` or
	 * `done` question back to `waiting`.
	 */
	state: QuestionState;
}

export type QuestionState = "open" | "waiting" | "editing" | "read" | "done";

export interface Inbox {
	/**
	 * Questions, by task name and then in the order each plan lists them.
	 * Only the unanswered ones unless the others were asked for too.
	 */
	questions: OpenQuestion[];
	/** How many unchecked questions have a reply their agent has yet to act on. */
	replied: number;
}

export interface InboxOptions {
	/**
	 * Keep the questions replied to but not yet checked off, to change or add
	 * to an answer. Without it, a question leaves the inbox once it is answered.
	 */
	replied?: boolean;
	/** Keep the questions checked off too, to follow one up. */
	done?: boolean;
}

/**
 * Every question still waiting on a person, across all tasks: the unchecked
 * items under each worktree's `## Blocked` with no reply yet, and with
 * `replied` also those answered but not yet checked off, whether their agent
 * has read the reply or not.
 *
 * Returns data rather than printing it, so the CLI and the dev server show the
 * same inbox.
 */
export async function openQuestions(
	{
		service,
		fs,
		replies,
	}: { service: WorktreeService; fs: Fs; replies: Replies },
	{ replied = false, done = false }: InboxOptions = {},
): Promise<Inbox> {
	const open: OpenQuestion[] = [];
	for (const worktree of await service.list()) {
		const plan = worktree.exists
			? await fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => null)
			: null;
		if (plan === null) {
			continue;
		}
		const waiting = await replies.forTask(worktree.task);
		for (const question of questions(plan)) {
			const pending = waiting.find(
				(found) => found.state.question === question.number,
			);
			open.push({
				task: worktree.task,
				status: worktree.status,
				lease: worktree.leaseStatus,
				...question,
				pending: pending?.state ?? null,
				state:
					pending !== undefined
						? pending.editing
							? "editing"
							: "waiting"
						: question.done
							? "done"
							: question.reply === null
								? "open"
								: "read",
			});
		}
	}
	return {
		questions: open.filter(
			({ state }) => state === "open" || (state === "done" ? done : replied),
		),
		replied: open.filter(({ state }) => state !== "open" && state !== "done")
			.length,
	};
}

export interface InboxPrintOptions extends InboxOptions {
	/** Print the inbox as JSON instead of a listing. */
	json?: boolean;
}

/** `arbor inbox`: the open questions, grouped by task. */
export async function inbox(
	deps: { service: WorktreeService; fs: Fs; replies: Replies; log: Logger },
	{ json = false, replied = false }: InboxPrintOptions = {},
): Promise<void> {
	const found = await openQuestions(deps, { replied });
	if (json) {
		deps.log.info(JSON.stringify(found, null, "\t"));
		return;
	}
	const more =
		!replied && found.replied > 0
			? color.dim(
					`${found.replied} replied, not yet acted on: arbor inbox --replied`,
				)
			: null;
	if (found.questions.length === 0) {
		deps.log.info(["nothing needs you", ...(more ? [more] : [])].join("\n"));
		return;
	}
	deps.log.info([listing(found), ...(more ? ["", more] : [])].join("\n"));
}

/**
 * One question as the inbox prints it: `Q9 subject`, its body and choices
 * under it, then the reply the agent has yet to act on, if there is one.
 */
export function formatQuestion(
	question: Question & { pending?: ReplyState | null },
): string[] {
	const lines = [
		`  ${question.number} ${question.text}`,
		...(question.body === ""
			? []
			: question.body.split("\n").map((line) => `      ${line}`.trimEnd())),
		...question.choices.map(({ key, text }) =>
			question.pick === "any"
				? `      [${key}] ${text}`
				: `      (${key}) ${text}`,
		),
	];
	if (question.reply !== null) {
		lines.push(color.dim(`    → ${question.reply}`));
		for (const followUp of question.followUps) {
			lines.push(color.dim(`    → ${followUp}`));
		}
	}
	if (question.pending) {
		lines.push(
			color.dim(
				`    → ${replyText(question, question.pending)} (waiting for its agent)`,
			),
		);
	}
	return lines;
}

function listing({ questions }: Inbox): string {
	const out: string[] = [];
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

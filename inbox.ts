import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { type MessageState, type Messages, replyText } from "./messages";
import { PLAN_FILE, type Question, questions } from "./plan";
import type { WorktreeStatus } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/** An open question, with the task that asked it. */
export interface OpenQuestion extends Question {
	task: string;
	status: WorktreeStatus;
	/**
	 * `held` means the asking agent is in a live session: answer it there,
	 * since a reply refuses a tree someone is driving.
	 */
	lease: "held" | "stale" | "none";
	/** A reply given and waiting for the agent to claim it, or null. */
	pending: MessageState | null;
	/**
	 * Where it stands. `open` waits on a person. `replied` waits on its agent
	 * and can still be edited. `editing` is held by someone changing it.
	 * `read` has been claimed by its agent, and can no longer change.
	 */
	state: QuestionState;
}

export type QuestionState = "open" | "replied" | "editing" | "read";

export interface Inbox {
	/**
	 * Open questions, by task name and then in the order each plan lists them.
	 * Only the unanswered ones unless the replied ones were asked for too.
	 */
	questions: OpenQuestion[];
	/** How many open questions have a reply their agent has yet to act on. */
	replied: number;
}

export interface InboxOptions {
	/**
	 * Keep the questions replied to but not yet checked off, to change or add
	 * to an answer. Without it, a question leaves the inbox once it is answered.
	 */
	replied?: boolean;
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
		messages,
	}: { service: WorktreeService; fs: Fs; messages: Messages },
	{ replied = false }: InboxOptions = {},
): Promise<Inbox> {
	const open: OpenQuestion[] = [];
	for (const worktree of await service.list()) {
		const plan = worktree.exists
			? await fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => null)
			: null;
		if (plan === null) {
			continue;
		}
		const waiting = await messages.unclaimed(worktree.task);
		for (const question of questions(plan)) {
			if (question.done) {
				continue;
			}
			const pending =
				question.reply === null
					? waiting.find((found) => found.state.id === question.number)
					: undefined;
			open.push({
				task: worktree.task,
				status: worktree.status,
				lease: worktree.leaseStatus,
				...question,
				pending: pending?.state ?? null,
				state:
					question.reply !== null
						? "read"
						: pending === undefined
							? "open"
							: pending.editing
								? "editing"
								: "replied",
			});
		}
	}
	return {
		questions: replied
			? open
			: open.filter((question) => question.state === "open"),
		replied: open.filter((question) => question.state !== "open").length,
	};
}

export interface InboxPrintOptions extends InboxOptions {
	/** Print the inbox as JSON instead of a listing. */
	json?: boolean;
}

/** `arbor inbox`: the open questions, grouped by task. */
export async function inbox(
	deps: { service: WorktreeService; fs: Fs; messages: Messages; log: Logger },
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
	question: Question & { pending?: MessageState | null },
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
	} else if (question.pending) {
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

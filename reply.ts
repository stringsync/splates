import type { Fs } from "webappwiz/system";
import type { Attachment } from "./attachments";
import { fail } from "./exit";
import {
	PLAN_FILE,
	type Question,
	questionNumber,
	questions,
	replyLine,
	withFollowUp,
	withReply,
} from "./plan";
import type { Replies } from "./replies";
import type { Todos } from "./todo";
import type { WorktreeService } from "./worktree-service";

export type { Attachment } from "./attachments";

/** What answering works with. */
export interface ReplyDeps {
	service: WorktreeService;
	fs: Fs;
	replies: Replies;
}

export interface ReplyInput {
	/** Words, alongside the picks or instead of them. */
	text: string;
	/**
	 * The keys of the choices picked (`b`), for a question that offers them:
	 * at most one for a `- (a)` question, any number for a `- [a]` one.
	 */
	choices?: string[];
	/** Files of any kind to attach. */
	files?: Attachment[];
}

export interface Replied {
	task: string;
	/** The question as the plan now reads it, answer and all. */
	question: Question;
}

/**
 * Answers one of an escalated task's questions, or follows up one already
 * answered, by writing it into the task's `ARBOR.md`: the first answer after
 * ` → ` on the question's line, anything after that on a `→ ` line of its own
 * under it, unchecking it. Files go under `.git/arbor/replies/<task>/`, named
 * by path in the line, so the line alone is the whole answer.
 *
 * Refuses a task that is not escalated. Its agent is working in a chat, which
 * is where anything said to it belongs.
 */
export async function replyTo(
	deps: ReplyDeps,
	task: string,
	question: string,
	{ text, choices = [], files = [] }: ReplyInput,
): Promise<Replied> {
	const number = parseNumber(task, question);
	if (text.trim() === "" && files.length === 0 && choices.length === 0) {
		fail("usage", "an empty reply answers nothing: say what to do", {
			task,
			question: number,
		});
	}
	return deps.replies.locked(async () => {
		const { asked, plan, path } = await answerable(deps, task, number);
		const keys = asked.choices.map((offered) => offered.key);
		const unknown = choices.find((choice) => !keys.includes(choice));
		if (unknown !== undefined) {
			fail(
				"usage",
				keys.length === 0
					? `question ${number} offers no choices: answer it in words`
					: `question ${number} offers ${keys.join(", ")}, not '${unknown}'`,
				{ task, question: number, choice: unknown },
			);
		}
		if (asked.pick === "one" && new Set(choices).size > 1) {
			fail(
				"usage",
				`question ${number} takes one choice at most, not ${choices.join(", ")}`,
				{ task, question: number },
			);
		}
		const stored = await deps.replies.attachments(task, number).store(files);
		const line = [replyLine(asked, { choices, text }), ...stored]
			.filter(Boolean)
			.join(" ");
		const answered =
			(asked.reply === null
				? withReply(plan, number, line)
				: withFollowUp(plan, number, line)) ?? plan;
		await deps.fs.write(path, answered);
		const now = questions(answered).find((found) => found.number === number);
		return { task, question: now ?? asked };
	});
}

function parseNumber(task: string, question: string): string {
	const number = questionNumber(question);
	if (number === null) {
		fail(
			"usage",
			`'${question}' is not a question number: name it the way the plan does, like 9`,
			{ task, question },
		);
	}
	return number;
}

/**
 * The question as the task's plan asks it, with the plan it came from,
 * refusing one a person cannot answer here: no tree, a task that is not
 * escalated, or no such question.
 */
async function answerable(
	{ service, fs }: ReplyDeps,
	task: string,
	number: string,
): Promise<{ asked: Question; plan: string; path: string }> {
	const worktree = await service.find(task);
	if (worktree.gone || !worktree.exists) {
		fail("not_found", `no worktree for '${task}'`, { task });
	}
	if (worktree.status !== "escalated") {
		fail(
			"not_escalated",
			`'${task}' is ${worktree.status}, not escalated: its agent is still at work, so say it in that chat`,
			{ task, status: worktree.status },
		);
	}
	const path = `${worktree.path}/${PLAN_FILE}`;
	const plan = await fs.read(path).catch(() => null);
	const asked =
		plan === null
			? undefined
			: questions(plan).find((found) => found.number === number);
	if (plan === null || asked === undefined) {
		fail("not_found", `'${task}' asks no question ${number}`, {
			task,
			question: number,
		});
	}
	return { asked, plan, path };
}

/** What a person says to approve a review: the task may land. */
export const APPROVED = "Approved: merge it.";

/** What a person says to a question they would rather not answer here. */
export const SKIP = "Skip this: go ahead without it.";

/**
 * Answers a question by setting it aside: it becomes a todo, its images
 * carried along since the tree they sit in goes when the task does, and the
 * reply tells the agent to leave it out of this task.
 */
export async function defer(
	deps: ReplyDeps & { todos: Todos },
	task: string,
	question: string,
): Promise<Replied> {
	const number = parseNumber(task, question);
	const { asked } = await deps.replies.locked(() =>
		answerable(deps, task, number),
	);
	const images: Attachment[] = [];
	for (const path of asked.images) {
		const bytes = await deps.fs.readBytes(path).catch(() => null);
		if (bytes !== null) {
			images.push({ name: path.split("/").at(-1) ?? "image", bytes });
		}
	}
	const todo = await deps.todos.add(asked.text, task, {
		text: asked.body,
		files: images,
	});
	return replyTo(deps, task, number, {
		text: `Deferred to todo ${todo.state.id}: leave it out of this task.`,
	});
}

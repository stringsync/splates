import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { type Attachment, readFiles } from "./attachments";
import { fail } from "./exit";
import { formatQuestion } from "./inbox";
import {
	PLAN_FILE,
	type Question,
	questionNumber,
	questions,
	withReply,
} from "./plan";
import { type Replies, type ReplyState, replyText } from "./replies";
import type { WorktreeService } from "./worktree-service";

export type { Attachment } from "./attachments";

/** What answering, and reading an answer, work with. */
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
	/** Files of any kind to add. */
	files?: Attachment[];
	/**
	 * Which files an earlier reply attached to keep, by path. Absent keeps
	 * none: a new reply replaces the old one whole.
	 */
	keep?: string[];
}

export interface Replied {
	task: string;
	/** The question as the plan asks it. */
	question: Question;
	/** The reply, waiting for its agent to claim it. */
	reply: ReplyState;
}

/**
 * Answers one of a task's open questions. The reply waits under
 * `.git/arbor/replies/<task>/` with its files, not in the plan, and replaces
 * any earlier one there, until the task's agent claims it with `arbor replies`
 * or `arbor wait --answered`. Until then it can be changed or withdrawn; after,
 * it is the agent's.
 *
 * Refuses a tree whose agent is in a live session. That agent is not reading
 * its inbox, it is waiting in its chat, which is where the answer belongs.
 */
export async function replyTo(
	deps: ReplyDeps,
	task: string,
	question: string,
	{ text, choices = [], files = [], keep = [] }: ReplyInput,
): Promise<Replied> {
	const number = parseNumber(task, question);
	if (
		text.trim() === "" &&
		files.length === 0 &&
		choices.length === 0 &&
		keep.length === 0
	) {
		fail("usage", "an empty reply answers nothing: say what to do", {
			task,
			question: number,
		});
	}
	return deps.replies.locked(async () => {
		const asked = await unread(deps, task, number);
		const keys = asked.choices.map((offered) => offered.key);
		const unknown = choices.find((choice) => !keys.includes(choice));
		if (unknown !== undefined) {
			fail(
				"usage",
				keys.length === 0
					? `${number} offers no choices: answer it in words`
					: `${number} offers ${keys.join(", ")}, not '${unknown}'`,
				{ task, question: number, choice: unknown },
			);
		}
		if (asked.pick === "one" && new Set(choices).size > 1) {
			fail(
				"usage",
				`${number} takes one choice at most, not ${choices.join(", ")}`,
				{ task, question: number },
			);
		}
		const earlier = await deps.replies.find(task, number);
		const attachments = deps.replies.attachments(task, number);
		const kept = (earlier?.state.files ?? []).filter((path) =>
			keep.includes(path),
		);
		await attachments.remove(
			(earlier?.state.files ?? []).filter((path) => !kept.includes(path)),
		);
		const saved = await deps.replies.save({
			task,
			question: number,
			choices: asked.choices
				.map((choice) => choice.key)
				.filter((key) => choices.includes(key)),
			text: text.trim(),
			files: [...kept, ...(await attachments.store(files))],
			repliedAt: new Date().toISOString(),
			editingUntil: null,
		});
		return { task, question: asked, reply: saved.state };
	});
}

/**
 * Takes back a reply its agent has not claimed yet, files and all: the
 * question waits on a person again.
 */
export async function withdrawReply(
	deps: ReplyDeps,
	task: string,
	question: string,
): Promise<Replied> {
	const number = parseNumber(task, question);
	return deps.replies.locked(async () => {
		const asked = await unread(deps, task, number);
		const pending = await deps.replies.find(task, number);
		if (pending === null) {
			fail("not_found", `${number} on '${task}' has no reply to withdraw`, {
				task,
				question: number,
			});
		}
		await pending.remove();
		return { task, question: asked, reply: pending.state };
	});
}

/**
 * Holds a reply for a person editing it, so its agent cannot claim it
 * half-changed. The hold lapses on its own (`EDIT_MS`) if the person walks
 * away; saving or `releaseReply` ends it sooner. Refuses one its agent has
 * already claimed: that is the moment it stops being editable.
 */
export async function holdReply(
	deps: ReplyDeps,
	task: string,
	question: string,
): Promise<Replied> {
	const number = parseNumber(task, question);
	return deps.replies.locked(async () => {
		const asked = await unread(deps, task, number);
		const pending = await deps.replies.find(task, number);
		if (pending === null) {
			fail("not_found", `${number} on '${task}' has no reply to edit`, {
				task,
				question: number,
			});
		}
		const held = await pending.hold();
		return { task, question: asked, reply: held.state };
	});
}

/** Lets go of a reply a person was editing, leaving it as it was. */
export async function releaseReply(
	{ replies }: { replies: Replies },
	task: string,
	question: string,
): Promise<void> {
	const number = parseNumber(task, question);
	await replies.locked(async () => {
		await (await replies.find(task, number))?.release();
	});
}

export interface Claimed {
	task: string;
	/** The questions whose replies were claimed, as the plan now reads them. */
	claimed: Question[];
	/** Questions with a reply a person is still editing: not yet readable. */
	editing: string[];
	/** Open questions with no reply at all. */
	unanswered: string[];
}

/**
 * What the task's agent does to read its replies: every one waiting and not
 * being edited is written into the plan after ` → `, where the agent reads
 * it, and from then on belongs to the agent. The files stay where they are,
 * named by path in the line, until the task goes.
 */
export async function claimReplies(
	deps: ReplyDeps,
	task: string,
): Promise<Claimed> {
	return deps.replies.locked(async () => {
		const worktree = await deps.service.find(task);
		const path = `${worktree.path}/${PLAN_FILE}`;
		let plan = worktree.exists
			? await deps.fs.read(path).catch(() => null)
			: null;
		if (plan === null) {
			return { task, claimed: [], editing: [], unanswered: [] };
		}
		const open = questions(plan).filter((asked) => !asked.done);
		const claimed: string[] = [];
		const editing: string[] = [];
		for (const pending of await deps.replies.forTask(task)) {
			const asked = open.find(
				(found) => found.number === pending.state.question,
			);
			// Answered in chat meanwhile, or checked off: nothing left to read.
			if (asked === undefined || asked.reply !== null) {
				continue;
			}
			if (pending.editing) {
				editing.push(asked.number);
				continue;
			}
			plan =
				withReply(plan, asked.number, replyText(asked, pending.state)) ?? plan;
			await pending.remove({ keepFiles: true });
			claimed.push(asked.number);
		}
		if (claimed.length > 0) {
			await deps.fs.write(path, plan);
		}
		const now = questions(plan).filter((asked) => !asked.done);
		return {
			task,
			claimed: now.filter((asked) => claimed.includes(asked.number)),
			editing,
			unanswered: now
				.filter(
					(asked) => asked.reply === null && !editing.includes(asked.number),
				)
				.map((asked) => asked.number),
		};
	});
}

export interface ReplyOptions {
	/** Files to attach, relative to the current directory or absolute. */
	files?: string[];
	/** The keys of the choices picked, for a question that offers them. */
	choices?: string[];
}

/** `arbor reply`: reads the attachments off disk and answers the question. */
export async function reply(
	deps: ReplyDeps & { ps: Ps; log: Logger },
	task: string,
	question: string,
	text: string,
	{ files = [], choices = [] }: ReplyOptions = {},
): Promise<void> {
	const replied = await replyTo(deps, task, question, {
		text,
		choices,
		files: await readFiles(deps, files),
	});
	deps.log.info(
		[
			`${color.green("replied")} ${replied.task}`,
			...formatQuestion({ ...replied.question, pending: replied.reply }),
		].join("\n"),
	);
}

/** `arbor unreply`: takes back a reply its agent has yet to claim. */
export async function unreply(
	deps: ReplyDeps & { log: Logger },
	task: string,
	question: string,
): Promise<void> {
	const withdrawn = await withdrawReply(deps, task, question);
	deps.log.info(
		[
			`${color.green("withdrew")} the reply to ${withdrawn.question.number} on ${task}`,
			color.dim(`  was: ${replyText(withdrawn.question, withdrawn.reply)}`),
		].join("\n"),
	);
}

/** `arbor replies`: claims the task's replies and prints them. */
export async function readReplies(
	deps: ReplyDeps & { log: Logger },
	task: string,
): Promise<Claimed> {
	const found = await claimReplies(deps, task);
	deps.log.info(claimedListing(found));
	return found;
}

/** What claiming found: the replies now in the plan, and what still waits. */
export function claimedListing({
	task,
	claimed,
	editing,
	unanswered,
}: Claimed): string {
	const lines =
		claimed.length === 0
			? [`${color.bold(task)} has no new replies`]
			: [`${color.bold(task)} replied`, ...claimed.flatMap(formatQuestion)];
	if (editing.length > 0) {
		lines.push(
			color.dim(`  being edited, not yet readable: ${editing.join(", ")}`),
		);
	}
	if (unanswered.length > 0) {
		lines.push(color.dim(`  unanswered: ${unanswered.join(", ")}`));
	}
	return lines.join("\n");
}

function parseNumber(task: string, question: string): string {
	const number = questionNumber(question);
	if (number === null) {
		fail(
			"usage",
			`'${question}' is not a question number: name it the way the plan does, like Q9`,
			{ task, question },
		);
	}
	return number;
}

/**
 * The question as the task's plan asks it, refusing one a person can no longer
 * answer: no tree, a live agent in it, no such question, one checked off, or
 * one whose reply its agent has already read.
 */
async function unread(
	{ service, fs }: ReplyDeps,
	task: string,
	number: string,
): Promise<Question> {
	const worktree = await service.find(task);
	if (worktree.gone || !worktree.exists) {
		fail(
			"not_found",
			`no worktree for '${task}': run \`arbor inbox\` to see what is waiting`,
			{ task },
		);
	}
	if (worktree.leaseHeldByOther) {
		fail(
			"lease_held",
			`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname}: its agent is in a live session, so answer it in that chat`,
			{ task, lease: worktree.lease },
		);
	}
	const plan = await fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => null);
	const asked =
		plan === null
			? undefined
			: questions(plan).find((found) => found.number === number);
	if (asked === undefined) {
		fail(
			"not_found",
			`'${task}' asks no ${number}: run \`arbor inbox\` to see what is open`,
			{ task, question: number },
		);
	}
	if (asked.done) {
		fail(
			"not_found",
			`${number} on '${task}' is checked off already: its agent has acted on it`,
			{ task, question: number },
		);
	}
	if (asked.reply !== null) {
		fail(
			"exists",
			`${number} on '${task}' was read by its agent already, so it can no longer change: tell the agent in its chat`,
			{ task, question: number },
		);
	}
	return asked;
}

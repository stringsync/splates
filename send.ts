import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import type { Attachment } from "./attachments";
import { fail } from "./exit";
import { formatQuestion } from "./inbox";
import {
	type MessageState,
	type Messages,
	messageText,
	replyText,
} from "./messages";
import {
	nextMessageId,
	PLAN_FILE,
	type PlanMessage,
	messages as planMessages,
	type Question,
	questionNumber,
	questions,
	withMessage,
	withReply,
} from "./plan";
import type { WorktreeService } from "./worktree-service";

export type { Attachment } from "./attachments";

/** What sending, and claiming what was sent, work with. */
export interface SendDeps {
	service: WorktreeService;
	fs: Fs;
	messages: Messages;
}

/** Words and files, as a person sends them. */
export interface SendInput {
	/** Words, alongside the picks or instead of them. */
	text: string;
	/** Files of any kind to add. */
	files?: Attachment[];
	/**
	 * Which files an earlier version attached to keep, by path. Absent keeps
	 * none: sending again replaces the old one whole.
	 */
	keep?: string[];
}

export interface ReplyInput extends SendInput {
	/**
	 * The keys of the choices picked (`b`), for a question that offers them:
	 * at most one for a `- (a)` question, any number for a `- [a]` one.
	 */
	choices?: string[];
}

export interface MessageInput extends SendInput {
	/** The message to change, still unclaimed; absent for a new one. */
	id?: string;
	/** What it follows up: a question, `Q3`, or an earlier message, `M1`. */
	about?: string | null;
}

/**
 * Answers one of a task's open questions. The reply waits under
 * `.git/arbor/messages/<task>/` with its files, not in the plan, and replaces
 * any earlier one there, until the task's agent claims it. Until then it can
 * be changed or withdrawn; after, it is the agent's.
 *
 * Refuses a tree whose agent is in a live session. That agent is not reading
 * its plan, it is waiting in its chat, which is where the answer belongs.
 */
export async function replyTo(
	deps: SendDeps,
	task: string,
	question: string,
	{ text, choices = [], files = [], keep = [] }: ReplyInput,
): Promise<MessageState> {
	const number = parseNumber(task, question);
	refuseEmpty(task, number, { text, files, keep, choices });
	return deps.messages.locked(async () => {
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
		return store(deps, task, number, null, {
			text,
			files,
			keep,
			choices: keys.filter((key) => choices.includes(key)),
		});
	});
}

/**
 * Tells a task's agent something no question asked, or follows up one whose
 * reply it has already read: a new message, or a change to one it has not
 * claimed yet. It waits the way a reply does, and the agent finds it under
 * `## Messages` once claimed. Unlike a reply it goes to a live agent too:
 * `arbor merge` refuses while one is unclaimed, so it is read before the work
 * lands whatever the agent is doing.
 */
export async function sendMessage(
	deps: SendDeps,
	task: string,
	{ id, about = null, text, files = [], keep = [] }: MessageInput,
): Promise<MessageState> {
	refuseEmpty(task, id ?? "message", { text, files, keep, choices: [] });
	const following =
		about === null || about === ""
			? null
			: /^m\d+$/i.test(about.trim())
				? about.trim().toUpperCase()
				: parseNumber(task, about);
	return deps.messages.locked(async () => {
		const plan = await readPlan(deps, task);
		if (id !== undefined) {
			await editable(deps, task, id);
		}
		const taken = (await deps.messages.forTask(task)).map(
			(message) => message.state.id,
		);
		return store(deps, task, id ?? nextMessageId(plan, taken), following, {
			text,
			files,
			keep,
			choices: [],
		});
	});
}

/**
 * Takes back something its agent has not claimed yet, files and all: a reply's
 * question waits on a person again, and a message is as if never sent.
 */
export async function withdraw(
	deps: SendDeps,
	task: string,
	id: string,
): Promise<MessageState> {
	return deps.messages.locked(async () => {
		const sent = await editable(deps, task, id);
		await sent.remove();
		return sent.state;
	});
}

/**
 * Holds something sent for a person editing it, so its agent cannot claim it
 * half-changed. The hold lapses on its own (`EDIT_MS`) if the person walks
 * away; saving or `release` ends it sooner. Refuses one its agent has already
 * claimed: that is the moment it stops being editable.
 */
export async function hold(
	deps: SendDeps,
	task: string,
	id: string,
): Promise<MessageState> {
	return deps.messages.locked(
		async () => (await (await editable(deps, task, id)).hold()).state,
	);
}

/** Lets go of something a person was editing, leaving it as it was. */
export async function release(
	{ messages }: { messages: Messages },
	task: string,
	id: string,
): Promise<void> {
	await messages.locked(async () => {
		const sent = await messages.find(task, id);
		if (sent !== null && !sent.claimed) {
			await sent.release();
		}
	});
}

export interface Claimed {
	task: string;
	/** The questions whose replies were claimed, as the plan now reads them. */
	replies: Question[];
	/** The messages claimed, as the plan now reads them. */
	messages: PlanMessage[];
	/** What a person is still editing: not yet readable. */
	editing: string[];
	/** Open questions with no reply at all. */
	unanswered: string[];
}

/**
 * What the task's agent does to read what was sent to it: everything waiting
 * and not being edited is written into the plan, a reply after its question's
 * ` → `, a message as an item under `## Messages`, and from then on belongs
 * to the agent. The files stay where they are, named by path, until the task
 * goes.
 */
export async function claim(deps: SendDeps, task: string): Promise<Claimed> {
	return deps.messages.locked(async () => {
		const worktree = await deps.service.find(task);
		const path = `${worktree.path}/${PLAN_FILE}`;
		let plan = worktree.exists
			? await deps.fs.read(path).catch(() => null)
			: null;
		if (plan === null) {
			return { task, replies: [], messages: [], editing: [], unanswered: [] };
		}
		const open = questions(plan).filter((asked) => !asked.done);
		const claimed: string[] = [];
		const editing: string[] = [];
		for (const sent of await deps.messages.unclaimed(task)) {
			const { id } = sent.state;
			if (sent.editing) {
				editing.push(id);
				continue;
			}
			if (sent.isReply) {
				const asked = open.find((found) => found.number === id);
				// Answered in chat meanwhile, or checked off: only marked read, since
				// the plan already says what happened.
				if (asked !== undefined && asked.reply === null) {
					plan = withReply(plan, id, replyText(asked, sent.state)) ?? plan;
				}
			} else {
				plan = withMessage(plan, id, messageText(sent.state));
			}
			await sent.claim();
			claimed.push(id);
		}
		if (claimed.length > 0) {
			await deps.fs.write(path, plan);
		}
		const now = questions(plan).filter((asked) => !asked.done);
		return {
			task,
			replies: now.filter(
				(asked) => claimed.includes(asked.number) && asked.reply !== null,
			),
			messages: planMessages(plan).filter((found) =>
				claimed.includes(found.id),
			),
			editing,
			unanswered: now
				.filter(
					(asked) => asked.reply === null && !editing.includes(asked.number),
				)
				.map((asked) => asked.number),
		};
	});
}

/** `arbor messages`: claims what was sent to the task and prints it. */
export async function readMessages(
	deps: SendDeps & { log: Logger },
	task: string,
): Promise<Claimed> {
	const found = await claim(deps, task);
	deps.log.info(claimedListing(found));
	return found;
}

/** What claiming found: what is now in the plan, and what still waits. */
export function claimedListing({
	task,
	replies,
	messages,
	editing,
	unanswered,
}: Claimed): string {
	const lines =
		replies.length + messages.length === 0
			? [`${color.bold(task)} has nothing new`]
			: [
					`${color.bold(task)} has new`,
					...replies.flatMap(formatQuestion),
					...messages.flatMap(formatMessage),
				];
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

function formatMessage({ id, text }: PlanMessage): string[] {
	const [head = "", ...rest] = text.split("\n");
	return [`  ${id} ${head}`, ...rest.map((line) => `      ${line}`.trimEnd())];
}

/** Writes one message, keeping the files asked for from any earlier version. */
async function store(
	deps: SendDeps,
	task: string,
	id: string,
	about: string | null,
	{ text, files, keep, choices }: Required<SendInput> & { choices: string[] },
): Promise<MessageState> {
	const earlier = await deps.messages.find(task, id);
	const attachments = deps.messages.attachments(task, id);
	const had = earlier?.state.files ?? [];
	const kept = had.filter((path) => keep.includes(path));
	await attachments.remove(had.filter((path) => !kept.includes(path)));
	const saved = await deps.messages.save({
		task,
		id,
		about,
		choices,
		text: text.trim(),
		files: [...kept, ...(await attachments.store(files))],
		sentAt: new Date().toISOString(),
		editingUntil: null,
		claimedAt: null,
	});
	return saved.state;
}

function refuseEmpty(
	task: string,
	id: string,
	{
		text,
		files,
		keep,
		choices,
	}: { text: string; files: Attachment[]; keep: string[]; choices: string[] },
): void {
	if (
		text.trim() === "" &&
		files.length === 0 &&
		choices.length === 0 &&
		keep.length === 0
	) {
		fail("usage", "an empty message says nothing: say what to do", {
			task,
			id,
		});
	}
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

/** The task's plan, refusing a task with no tree to send to. */
async function readPlan(
	{ service, fs }: SendDeps,
	task: string,
): Promise<string> {
	const worktree = await service.find(task);
	if (worktree.gone || !worktree.exists) {
		fail("not_found", `no worktree for '${task}': it has landed or gone`, {
			task,
		});
	}
	return fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => "");
}

/** Something sent that can still change: there, and not yet claimed. */
async function editable(deps: SendDeps, task: string, id: string) {
	await readPlan(deps, task);
	const sent = await deps.messages.find(task, id);
	if (sent === null) {
		fail("not_found", `nothing sent as ${id} on '${task}'`, { task, id });
	}
	if (sent.claimed) {
		fail(
			"exists",
			`${id} on '${task}' was read by its agent already, so it can no longer change: follow it up with a message`,
			{ task, id },
		);
	}
	return sent;
}

/**
 * The question as the task's plan asks it, refusing one a person can no longer
 * answer: no tree, a live agent in it, no such question, one checked off, or
 * one whose reply its agent has already read.
 */
async function unread(
	deps: SendDeps,
	task: string,
	number: string,
): Promise<Question> {
	const plan = await readPlan(deps, task);
	const worktree = await deps.service.find(task);
	if (worktree.leaseHeldByOther) {
		fail(
			"lease_held",
			`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname}: its agent is in a live session, so answer it in that chat`,
			{ task, lease: worktree.lease },
		);
	}
	const asked = questions(plan).find((found) => found.number === number);
	if (asked === undefined) {
		fail(
			"not_found",
			`'${task}' asks no ${number}: see the inbox for what is open`,
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
	const sent = await deps.messages.find(task, number);
	if (asked.reply !== null || sent?.claimed) {
		fail(
			"exists",
			`${number} on '${task}' was read by its agent already, so it can no longer change: follow it up with a message`,
			{ task, question: number },
		);
	}
	return asked;
}

/**
 * Where something sent stands. `waiting` for its agent, and still editable;
 * `editing`, held by a person changing it; `read` by its agent, and fixed;
 * `done`, checked off by the agent as acted on.
 */
export type SentState = "waiting" | "editing" | "read" | "done";

/** One thing sent, as the page lists it. */
export interface Sent {
	task: string;
	/** `held` when the task's agent is in a live session. */
	lease: "held" | "stale" | "none";
	message: MessageState;
	/** One line to list it by: the question a reply answers, or the message's own first line. */
	subject: string;
	/** For a reply, the question it answers as the plan asks it. */
	question: Question | null;
	state: SentState;
}

/**
 * Everything sent to every task still here, newest first. Kept until the task
 * lands or goes, so it reads as the conversation with each agent.
 */
export async function sentList({
	service,
	fs,
	messages,
}: SendDeps): Promise<Sent[]> {
	const sent: Sent[] = [];
	for (const worktree of await service.list()) {
		if (!worktree.exists) {
			continue;
		}
		const plan = await fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => "");
		const asked = questions(plan);
		const told = planMessages(plan);
		for (const found of await messages.forTask(worktree.task)) {
			const message = found.state;
			const question = found.isReply
				? (asked.find((one) => one.number === message.id) ?? null)
				: null;
			const done = found.isReply
				? (question?.done ?? true)
				: (told.find((one) => one.id === message.id)?.done ?? true);
			sent.push({
				task: worktree.task,
				lease: worktree.leaseStatus,
				message,
				subject: question?.text ?? subjectOf(message),
				question,
				state: !found.claimed
					? found.editing
						? "editing"
						: "waiting"
					: done
						? "done"
						: "read",
			});
		}
	}
	return sent.sort((left, right) =>
		right.message.sentAt.localeCompare(left.message.sentAt),
	);
}

function subjectOf(message: MessageState): string {
	const line =
		message.text
			.split("\n")
			.find((one) => one.trim() !== "")
			?.trim() ??
		`${message.files.length} file${message.files.length === 1 ? "" : "s"}`;
	return message.about === null ? line : `Re ${message.about}: ${line}`;
}

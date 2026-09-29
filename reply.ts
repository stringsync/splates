import { basename, resolve } from "node:path";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { fail } from "./exit";
import { formatQuestion } from "./inbox";
import {
	PLAN_FILE,
	type Question,
	questionNumber,
	questions,
	withReply,
} from "./plan";
import type { WorktreeService } from "./worktree-service";

/** A file handed over with a reply, as bytes so a pasted image needs no temp file. */
export interface Attachment {
	/** What it was called, kept in the stored name so the agent can tell them apart. */
	name: string;
	bytes: Uint8Array;
}

export interface ReplyInput {
	text: string;
	images?: Attachment[];
}

export interface Replied {
	task: string;
	/** The question as the plan now reads, reply included. */
	question: Question;
	/** Absolute paths the attachments were stored at, in the order given. */
	attachments: string[];
}

/**
 * Answers one of a task's open questions: writes the reply onto its line in
 * `ARBOR.md` after ` → `, replacing any earlier one, and stores each
 * attachment under `.git/arbor/attachments/<task>/` with its absolute path
 * appended to the reply, so the agent can open it from any tree. The checkbox
 * stays open: checking it off is the agent's word that it has acted.
 *
 * Refuses a tree whose agent is in a live session. That agent is not reading
 * its plan, it is waiting in its chat, which is where the answer belongs.
 */
export async function replyTo(
	{
		service,
		fs,
		ids = new UuidProvider(),
	}: { service: WorktreeService; fs: Fs; ids?: IdProvider },
	task: string,
	question: string,
	{ text, images = [] }: ReplyInput,
): Promise<Replied> {
	const number = questionNumber(question);
	if (number === null) {
		fail(
			"usage",
			`'${question}' is not a question number: name it the way the plan does, like Q9`,
			{ task, question },
		);
	}
	if (text.trim() === "" && images.length === 0) {
		fail("usage", "an empty reply answers nothing: say what to do", {
			task,
			question: number,
		});
	}
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
	const path = `${worktree.path}/${PLAN_FILE}`;
	const plan = await fs.read(path).catch(() => null);
	const asked =
		plan === null
			? undefined
			: questions(plan).find((found) => found.number === number);
	if (plan === null || asked === undefined) {
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

	const attachments: string[] = [];
	if (images.length > 0) {
		const dir = service.attachmentsPath(task);
		await fs.mkdir(dir);
		for (const image of images) {
			const stored = `${dir}/${ids.next()}-${safe(image.name)}`;
			await fs.writeBytes(stored, image.bytes);
			attachments.push(stored);
		}
	}
	const reply = [text.trim(), ...attachments].filter(Boolean).join(" ");
	const updated = withReply(plan, number, reply) ?? plan;
	await fs.write(path, updated);
	return {
		task,
		question: questions(updated).find((found) => found.number === number) ?? {
			...asked,
			reply,
		},
		attachments,
	};
}

export interface ReplyOptions {
	/** Files to attach, relative to the current directory or absolute. */
	images?: string[];
}

/** `arbor reply`: reads the attachments off disk and answers the question. */
export async function reply(
	deps: { service: WorktreeService; fs: Fs; ps: Ps; log: Logger },
	task: string,
	question: string,
	text: string,
	{ images = [] }: ReplyOptions = {},
): Promise<void> {
	const attached: Attachment[] = [];
	for (const image of images) {
		const path = resolve(deps.ps.cwd(), image);
		const bytes = await deps.fs.readBytes(path).catch(() => null);
		if (bytes === null) {
			fail("usage", `cannot read ${path}: nothing was replied`, {
				task,
				image: path,
			});
		}
		attached.push({ name: basename(path), bytes });
	}
	const replied = await replyTo(deps, task, question, {
		text,
		images: attached,
	});
	deps.log.info(
		[
			`${color.green("replied")} ${replied.task}`,
			...formatQuestion(replied.question),
		].join("\n"),
	);
}

/**
 * A stored name that survives being written into a one-line reply: the paths
 * are separated by spaces there, so nothing in them may be one.
 */
function safe(name: string): string {
	return basename(name).replace(/[^\w.-]+/g, "-") || "attachment";
}

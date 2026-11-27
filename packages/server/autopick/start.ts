import type { StoredTask } from "../board";
import type {
	AutopickSet,
	Conversation,
	Conversations,
	Picked,
} from "../conversations";
import { fail } from "../exit";
import { pickSettings, Roster, splatesHome } from "../models";
import { goalOf, Plans } from "../plans";
import { Prices } from "../prices";
import type { Journal, Lifted } from "../records";
import type { Project } from "../server/shared";
import { FsStorage } from "../storage";
import { DEPTHS, KINDS, type TaskClass } from "./classes";
import type { AttachmentInfo } from "./classify";
import {
	type AutopickDecision,
	type DecideContext,
	decide,
	decideWithout,
} from "./decide";
import { JUDGE_CREDS, type JudgeFor, projectJudge } from "./judge";
import { autopicked, cachedFor, decideFor } from "./judged";
import { classificationKey } from "./key";
import type { Autopicked } from "./record";
import { AutopickStore } from "./store";

/** The cred Autopick asks for when no judge's is kept: Jev's, the one key. */
const JUDGE_KEY = JUDGE_CREDS.jev[0];

/** What {@link JUDGE_KEY} is for, as the Creds page shows it. */
const PURPOSE =
	"Autopick asks TypeSafe's Jev what kind of work a task is and how deeply it needs to reason, to start it on the agent, model and thinking level your Autopick rules give that; without a key every task is unsure of both and takes the lineup routed for that.";

/** How to get {@link JUDGE_KEY}, as the Creds page shows it. */
const INSTRUCTIONS = `1. Open [TypeSafe](https://typesafe.ai) and sign in.
2. Create an API key.
3. Paste it here.`;

/** Which task Autopick starts: a started one by name, or a queued one by number. */
export type AutopickTarget = { task: string } | { todo: number };

/** Which words Autopick judges: a task's, or those of a new conversation's first message. */
export type AutopickWords =
	| AutopickTarget
	| { words: string; attachments?: readonly AttachmentInfo[] };

/** How `startAutopick` starts the conversation, in the tree it runs in. */
export type AutopickStart = (
	agent: string,
	opts: {
		model?: string;
		settings: Record<string, string>;
		picking: Promise<Picked<string>>;
	},
) => Promise<Conversation>;

/**
 * Opens a conversation through `start` without waiting for the judge to
 * answer. The agent starts once `picking` resolves to its agent, model, and
 * settings. A task with a matching prior judgment reuses that judgment.
 */
export async function startAutopick({
	project,
	conversations,
	target,
	start,
	slug = async () => null,
	judge = (who) => projectJudge(project, slug, who),
	now = () => new Date(),
}: {
	project: Project;
	conversations: Conversations;
	target: AutopickWords;
	start: AutopickStart;
	/** The judge to ask; the one the project's creds give by default. */
	judge?: JudgeFor;
	/** The project's slug, to name it in the spend ledger; none when not given. */
	slug?: () => Promise<string | null>;
	now?: () => Date;
}): Promise<Conversation> {
	// Words typed in a new conversation belong to no task, so keep no record.
	const record = "words" in target ? null : await recordOf(project, target);
	const { subject, detail } =
		record === null
			? wordsOfMessage("words" in target ? target.words : "")
			: await wordsOf(project, record);
	const attachments =
		"words" in target
			? (target.attachments ?? [])
			: (record?.files ?? []).map((name) => ({
					name,
					mimeType: Bun.file(name).type,
				}));
	const key = classificationKey(subject, detail, attachments);
	const context = await contextOf(project, conversations, now(), attachments);
	const { offered } = context;
	const cached = record === null ? null : cachedFor(record, key);

	// Use the unclassified lineup for the pending conversation when there is
	// no cached judgment. Prompts sent meanwhile wait for picking to finish.
	const fallback =
		cached === null
			? decideWithout({ ...context, reason: "the judge has yet to answer" })
			: decide({ ...context, classification: cached });
	const deciding = decideFor({
		subject,
		detail,
		attachments,
		cached,
		judge,
		who:
			"words" in target
				? {}
				: { task: "task" in target ? target.task : `#${target.todo}` },
		context,
		...(record === null ? {} : { task: record.id }),
	});
	const opened = ({ pick }: AutopickDecision): Picked<string> => ({
		agent: pick.agent,
		...(pick.model === undefined ? {} : { model: pick.model }),
		settings: pickSettings(pick.effort, offered[pick.agent] ?? []),
	});
	const starting = opened(fallback);
	const conversation = start(starting.agent, {
		...starting,
		// Kept and logged before the agent opens on it, so its line leads what it says.
		picking: deciding.then(
			async (judged) => {
				const picked = autopicked(judged, key, now());
				await (record === null
					? announce(project, conversation, picked, judged.judged)
					: settle(project, record.id, picked, {
							conversation,
							judged: judged.judged,
						}));
				return opened(judged.decision);
			},
			(error: unknown) => {
				project.log.error(`Autopick could not decide: ${String(error)}`);
				return starting;
			},
		),
	});
	return conversation;
}

/** What a decision for a task in `project` reads besides its classification. */
export async function contextOf(
	project: Project,
	conversations: Conversations,
	now: Date,
	attachments: readonly AttachmentInfo[] = [],
): Promise<DecideContext> {
	const home = splatesHome(project.ps);
	const images = attachments.some((each) => each.mimeType.startsWith("image/"));
	return {
		images,
		// Fetched only for a task with an image, which is all that reads it.
		catalog: images
			? await new Prices(new FsStorage(home, project.fs)).catalog()
			: null,
		sights: await conversations.sights(),
		rules: await new AutopickStore(`${home}/auto-pick.json`, {
			fs: project.fs,
		}).rules(),
		agents: await Roster.in(new FsStorage(home, project.fs)).agents(),
		runnable: conversations.agents.map((each) => each.id),
		limits: await conversations.limits(),
		avoided: (await conversations.health?.avoided(now)) ?? [],
		offered: await conversations.settings(),
		now,
	};
}

/** The record of the task `target` names, failing for none. */
export async function recordOf(
	project: Project,
	target: AutopickTarget,
): Promise<StoredTask> {
	const { store } = project.tasks;
	const record =
		"todo" in target
			? await store.read(target.todo)
			: await store.find(target.task);
	if (record === null) {
		const named = "todo" in target ? `#${target.todo}` : `'${target.task}'`;
		fail(
			"not_found",
			`no task ${named}: run \`splates task list\` to see what there is`,
			target,
		);
	}
	return record;
}

/**
 * What the judge reads of a task: its subject and text, or for a started
 * task with no text, as one never queued has, the goal its `SPLATES.md` sets.
 */
export async function wordsOf(
	project: Project,
	record: StoredTask,
): Promise<{ subject: string; detail: string }> {
	if (record.text !== "" || record.task === undefined) {
		return { subject: record.subject, detail: record.text };
	}
	const worktree = await project.service.find(record.task);
	const plan = worktree.exists
		? await new Plans(project.fs).read(worktree.path)
		: null;
	return { subject: record.subject, detail: goalOf(plan ?? "") };
}

/** What the judge reads of a first message: its first line as the subject, the rest as detail. */
function wordsOfMessage(message: string): { subject: string; detail: string } {
	const [first = "", ...rest] = message.trim().split("\n");
	return { subject: first.trim(), detail: rest.join("\n").trim() };
}

/**
 * Saves the pick for a task and announces it in the conversation, if supplied.
 * Pass `null` for the conversation when saving a pick ahead of a start.
 * Failures are logged and the caller can proceed with the pick.
 */
export async function settle(
	project: Project,
	id: number,
	picked: Autopicked,
	{
		conversation,
		judged,
	}: { conversation: Promise<Conversation> | null; judged: boolean },
): Promise<void> {
	await keep(project, id, picked).catch((error: unknown) =>
		project.log.error(
			`Autopick could not keep its decision on task ${id}: ${String(error)}`,
		),
	);
	if (conversation !== null) {
		await announce(project, conversation, picked, judged);
	}
}

/**
 * Logs `picked` in `conversation`, asking once for the judge's key unless it
 * `judged`; a failure is logged, so it never stops the start.
 */
export async function announce(
	project: Project,
	conversation: Promise<Conversation>,
	picked: Autopicked,
	judged: boolean,
): Promise<void> {
	await conversation
		.then((started) =>
			logPick(project, started, picked, judged ? null : JUDGE_KEY),
		)
		.catch((error: unknown) => project.log.error(String(error)));
}

/** Writes `picked` on task `id`'s record, under the store's lock, leaving the rest as it is. */
async function keep(
	project: Project,
	id: number,
	picked: Autopicked,
): Promise<void> {
	const { store } = project.tasks;
	await store.locked(async () => {
		const record = await store.read(id);
		if (record !== null) {
			await store.write({ ...record, autoPick: picked });
		}
	});
}

/**
 * Logs the pick in the conversation, which keeps it to look again at what
 * the person says later, and, when `asking` names the judge's key for want
 * of a judge, the request for it.
 */
async function logPick(
	project: Project,
	conversation: Conversation,
	picked: Autopicked,
	asking: string | null,
): Promise<void> {
	conversation.autopicked(setOf(picked));
	const journal = project.journal.in(conversation.id);
	await journalPick(journal, conversation.state.task, picked);
	if (asking !== null) {
		await offerJudge(project, journal, conversation.state.task, asking);
	}
}

/** What a conversation keeps of `decision`. */
export function setOf({
	pick,
	lineup,
	kind,
	depth,
	clarity,
}: AutopickDecision): AutopickSet {
	return {
		lineup: lineup ?? null,
		kind,
		depth,
		...(clarity === undefined ? {} : { clarity }),
		agent: pick.agent,
		model: pick.model ?? null,
		effort: pick.effort ?? null,
	};
}

/**
 * Writes `picked` in `journal` as splates's own line in its conversation,
 * with, for a pick that moved it up later, what it moved off.
 */
export async function journalPick(
	journal: Journal,
	task: string | null,
	picked: Autopicked,
	lifted?: Lifted,
): Promise<void> {
	const classification = picked.classified?.classification;
	await journal.record("auto", task, async () => {}, {
		agent: picked.pick.agent,
		model: picked.pick.model ?? null,
		effort: picked.pick.effort ?? null,
		reasons: picked.reasons,
		signs:
			classification === undefined
				? null
				: [
						likeliest(KINDS, classification.kinds),
						likeliest(DEPTHS, classification.depth),
					],
		lifted: lifted ?? null,
		...(picked.holdout === undefined || lifted !== undefined
			? {}
			: { held: { from: picked.holdout.from, undo: picked.holdout.undo } }),
	});
}

/** The likeliest of `classes` in words: `Mechanical 80%`. */
function likeliest<Id extends string>(
	classes: readonly TaskClass<Id>[],
	answers: Record<Id, number>,
): string {
	const best = classes.reduce((most, each) =>
		answers[each.id] > answers[most.id] ? each : most,
	);
	return `${best.label} ${Math.round(answers[best.id] * 100)}%`;
}

/**
 * Asks on the Creds page for the judge's key, logged in the conversation so
 * its Requested line opens it, unless it was asked for before: one the
 * person dismissed stays dismissed, and one still open needs no second line.
 */
async function offerJudge(
	project: Project,
	journal: Project["journal"],
	task: string | null,
	name: string,
): Promise<void> {
	const asked = (await project.creds.requests()).some(
		(each) => each.name === name,
	);
	if (asked) {
		return;
	}
	await journal.record(
		"creds request",
		task,
		() =>
			project.creds.request(name, {
				scope: "device",
				purpose: PURPOSE,
				instructions: INSTRUCTIONS,
				task,
			}),
		(request) => ({ name, asked: request !== null }),
	);
}

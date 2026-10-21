import type { TaskRecord } from "../board";
import type { Conversations } from "../conversations";
import type { AgentPick } from "../models";
import type { QueuePicked, QueuePicker } from "../queue";
import type { Project } from "../server/shared";
import type { AttachmentInfo } from "./classify";
import { type DecideContext, decide, decideWithout } from "./decide";
import { type JudgeFor, projectJudge } from "./judge";
import { autoPicked, cachedFor, decideFor } from "./judged";
import { classificationKey } from "./key";
import { announce, contextOf, settle, wordsOf } from "./start";

/**
 * Auto pick for the queue: a queued task that names no agent is judged as
 * it is queued, and again whenever its words change, so its held
 * conversation waits on the agent it will start on; it starts on what Auto
 * pick decides then, kept on its record and logged in its conversation as a
 * start from its Start menu is. Only the queue's own starts come here; a
 * conversation the person starts on a task keeps its agent.
 */
export class QueueAutoPick implements QueuePicker {
	readonly #project: Project;
	readonly #conversations: Conversations;
	readonly #judge: JudgeFor;
	readonly #now: () => Date;
	/** Each task's judgment under way, by id, the next chained after it. */
	readonly #judging = new Map<number, Promise<void>>();
	/**
	 * The key of the latest words judged for each task, by id: words a judge
	 * failed on, or that a check reads again before their record says so,
	 * are not asked again, and a judgment waiting on older words is skipped.
	 */
	readonly #tried = new Map<number, string>();

	constructor(
		project: Project,
		conversations: Conversations,
		{
			slug = async () => null,
			judge = (who) => projectJudge(project, slug, who),
			now = () => new Date(),
		}: {
			/** The judge to ask; the one the project's creds give by default. */
			judge?: JudgeFor;
			/** The project's slug, to name it in the spend ledger; none when not given. */
			slug?: () => Promise<string | null>;
			now?: () => Date;
		} = {},
	) {
		this.#project = project;
		this.#conversations = conversations;
		this.#judge = judge;
		this.#now = now;
	}

	async ahead(queued: readonly TaskRecord[]): Promise<void> {
		for (const each of queued) {
			const { subject, detail } = await wordsOf(this.#project, each);
			const attachments = each.files.map((name) => ({
				name,
				mimeType: Bun.file(name).type,
			}));
			const key = classificationKey(subject, detail, attachments);
			if (cachedFor(each, key) !== null || this.#tried.get(each.id) === key) {
				continue;
			}
			this.#tried.set(each.id, key);
			const run = (this.#judging.get(each.id) ?? Promise.resolve()).then(() =>
				this.#judgeAhead(each.id, { subject, detail, attachments, key }),
			);
			this.#judging.set(each.id, run);
			void run.finally(() => {
				if (this.#judging.get(each.id) === run) {
					this.#judging.delete(each.id);
				}
			});
		}
	}

	judging(id: number): boolean {
		return this.#judging.has(id);
	}

	/** Waits out every judgment under way, as a test or a shutdown does. */
	async settled(): Promise<void> {
		while (this.#judging.size > 0) {
			await Promise.all(this.#judging.values());
		}
	}

	async guess(queued: readonly TaskRecord[]): Promise<Map<number, AgentPick>> {
		const guessed = new Map<number, AgentPick>();
		for (const each of queued) {
			const { subject, detail } = await wordsOf(this.#project, each);
			const attachments = each.files.map((name) => ({
				name,
				mimeType: Bun.file(name).type,
			}));
			const context = await this.#context(attachments);
			const cached = cachedFor(
				each,
				classificationKey(subject, detail, attachments),
			);
			try {
				const { pick } =
					cached === null
						? decideWithout({ ...context, reason: "not judged yet" })
						: decide({ ...context, classification: cached });
				guessed.set(each.id, pick);
			} catch {
				guessed.set(each.id, firstOf(context));
			}
		}
		return guessed;
	}

	async decide(queued: TaskRecord): Promise<QueuePicked> {
		// What it judges ahead is kept on the record, read again once it has.
		const judging = this.#judging.get(queued.id);
		if (judging !== undefined) {
			await judging;
			queued = (await this.#project.tasks.store.read(queued.id)) ?? queued;
		}
		const { subject, detail } = await wordsOf(this.#project, queued);
		const attachments = queued.files.map((name) => ({
			name,
			mimeType: Bun.file(name).type,
		}));
		const context = await this.#context(attachments);
		const key = classificationKey(subject, detail, attachments);
		try {
			const judged = await decideFor({
				subject,
				detail,
				attachments,
				cached: cachedFor(queued, key),
				judge: this.#judge,
				who: { task: `#${queued.id}` },
				context,
			});
			const picked = autoPicked(judged, key, this.#now());
			await settle(this.#project, queued.id, picked, {
				conversation: null,
				judged: judged.judged,
			});
			return {
				pick: judged.decision.pick,
				tell: (id) =>
					announce(
						this.#project,
						this.#conversations.find(id),
						picked,
						judged.judged,
					),
			};
		} catch (error) {
			this.#project.log.error(
				`Auto pick could not decide for task ${queued.id}: ${String(error)}`,
			);
			return { pick: firstOf(context), tell: async () => {} };
		}
	}

	/**
	 * Judges task `id`'s words, under `key`, and keeps what that decides on
	 * its record, unless newer words were given meanwhile.
	 */
	async #judgeAhead(
		id: number,
		{
			subject,
			detail,
			attachments,
			key,
		}: {
			subject: string;
			detail: string;
			attachments: readonly AttachmentInfo[];
			key: string;
		},
	): Promise<void> {
		if (this.#tried.get(id) !== key) {
			return;
		}
		try {
			const judged = await decideFor({
				subject,
				detail,
				attachments,
				cached: null,
				judge: this.#judge,
				who: { task: `#${id}` },
				context: await this.#context(attachments),
			});
			await settle(this.#project, id, autoPicked(judged, key, this.#now()), {
				conversation: null,
				judged: judged.judged,
			});
		} catch (error) {
			this.#project.log.error(
				`Auto pick could not judge task ${id} ahead: ${String(error)}`,
			);
		}
	}

	async #context(
		attachments: readonly AttachmentInfo[],
	): Promise<DecideContext> {
		return contextOf(
			this.#project,
			this.#conversations,
			this.#now(),
			attachments,
		);
	}
}

/**
 * The roster's first agent, for when deciding throws, as it does for a
 * roster with no agent splates can run: the queue still starts the task, and
 * its start says what is wrong.
 */
function firstOf(context: DecideContext): AgentPick {
	return { agent: context.agents[0]?.id ?? "claude" };
}

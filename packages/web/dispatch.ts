import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { AgentPick } from "@stringsync/splates-server/models";
import {
	effortSettings,
	thinkingOf,
} from "@stringsync/splates-server/models/browser";
import {
	type DemoPoint,
	demoReference,
	type Needing,
	needs,
	orphaned,
	taskNumberReference,
	taskReference,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { agentFor, NEW, newAddress, settingsFor } from "./conversation-address";
import {
	archiveConversation,
	promptConversation,
	startConversation,
} from "./conversation-api";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { type Drafts, newDraft } from "./drafts";

/** What a todo or a task is, to put an agent to work on it. */
export type Assignment =
	| { kind: "todo"; id: number }
	| { kind: "task"; task: string };

/**
 * Puts agents to work from the board and the Tasks page: who is on a task
 * already, and a conversation for the rest, started or picked. Each writes
 * the prompt into a composer and names the conversation address
 * (`#conversations/<address>`) to open it at, so the person picks the agent's
 * settings, or adds to the prompt, before sending; but `begin`, for the agent
 * a todo is assigned to, which sends it straight away.
 * A link is only the prompt: the agent takes the work, and its conversation
 * follows it into the task, or it means nothing.
 */
export class Dispatch {
	constructor(
		private readonly drafts: Drafts,
		/** Where a conversation `begin` starts shows before the server says. */
		private readonly feed: ConversationFeed,
		/** The project the page shows, by its `?project=` slug, or null. */
		private readonly project: string | null,
		readonly agents: AgentChoice[],
		/** Every conversation, archived too, newest first. */
		private readonly conversations: ConversationState[],
		private readonly tasks: Details[],
	) {}

	/**
	 * The conversations working `task`, newest first, with what each needs, as
	 * the conversation list says it, so one handed out waits on the one that
	 * handed it out, not on the person; archived ones, put away, are not.
	 */
	on(task: string): Needing[] {
		return this.listed((conversation) => conversation.task === task);
	}

	/**
	 * The conversation the queue holds for queued task `id`, waiting for
	 * an agent until the queue starts it, with what it needs, as `on` says.
	 */
	heldFor(id: number): Needing[] {
		return this.listed((conversation) => conversation.queued === id);
	}

	/** The listed conversations `which` keeps, newest first, with what each needs. */
	private listed(
		which: (conversation: ConversationState) => boolean,
	): Needing[] {
		const listed = needs({
			tasks: this.tasks,
			conversations: this.conversations,
		});
		return this.conversations.flatMap(
			(conversation) =>
				listed.find(
					(each) => each.conversation === conversation && which(conversation),
				) ?? [],
		);
	}

	/** Whether no agent is left on `task`, as `orphaned` says. */
	orphaned(task: string): boolean {
		const details = this.task(task);
		return (
			details !== undefined && orphaned(details, this.conversations) !== null
		);
	}

	/** `task`'s details, while it is still there. */
	task(task: string): Details | undefined {
		return this.tasks.find((each) => each.task === task);
	}

	/**
	 * The conversations that could take `assignment` on: every one listed but those
	 * already on it, which hold it.
	 */
	others(assignment: Assignment): ConversationState[] {
		const on = assignment.kind === "task" ? assignment.task : null;
		return this.conversations.filter(
			(each) => !each.archived && (on === null || each.task !== on),
		);
	}

	/** What an agent's name is, from its id. */
	agentName(agent: string): string {
		return this.agents.find((each) => each.id === agent)?.name ?? agent;
	}

	/**
	 * Composes `assignment`'s prompt for a new conversation with `agent`, one for a
	 * task in its tree, and answers the address of the screen that starts it,
	 * on `model` when given.
	 */
	start(agent: string, assignment: Assignment, model?: string): string {
		const task = assignment.kind === "task" ? assignment.task : null;
		this.compose(newDraft(this.project, task), promptFor(assignment));
		return newAddress(agent, task, model ?? null);
	}

	/**
	 * Starts a conversation with `pick`'s agent on its model and thinking level, and sends it
	 * `assignment`'s prompt, answering its address once it is started, with the
	 * prompt showing as sent. Each setting starts where a new conversation's
	 * would. When it does not start, the address of the screen
	 * that does, the prompt in its composer; when the prompt is refused, it
	 * stays in the conversation's thread as unsent.
	 */
	begin(pick: AgentPick, assignment: Assignment): Promise<string> {
		const task = assignment.kind === "task" ? assignment.task : null;
		return this.beginWith(pick, task, promptFor(assignment));
	}

	/**
	 * Asks for a demo of `task` at `point` in `conversation`, the one that
	 * last worked it, or for null the newest in its tree, put back on the list first when archived; or, when it
	 * is gone or there is none, in a new conversation in the main tree, where
	 * the agent adds the demo's own task. Answers the conversation's address,
	 * the request showing as sent at once; a refused one stays in the thread
	 * as unsent. When no conversation starts, the address of the screen that
	 * starts one, the request in its composer.
	 */
	async demo(
		task: string,
		conversation: string | null,
		point: DemoPoint,
	): Promise<string> {
		const text = demoReference(task, point);
		const found = this.conversations.find((each) =>
			conversation === null ? each.task === task : each.id === conversation,
		);
		if (found === undefined) {
			const agent = agentFor(NEW, this.agents, this.conversations);
			return this.beginWith({ agent }, null, text);
		}
		const back = found.archived
			? archiveConversation(found.id, false)
			: Promise.resolve();
		if (found.archived) {
			void this.feed
				.expect(found.id, { archived: false }, back)
				.catch(() => {});
		}
		const sending = this.feed.send(found.id, text);
		void back
			.then(() => promptConversation(found.id, text, [], false, sending.id))
			.then((state) => this.feed.answered(found.id, sending, state))
			.catch((error: unknown) => this.feed.refused(found.id, sending, error));
		return found.id;
	}

	/**
	 * Starts a conversation with `pick` as `begin` does, in `task`'s tree or
	 * the main tree for null, and sends it `text`.
	 */
	async beginWith(
		pick: AgentPick,
		task: string | null,
		text: string,
	): Promise<string> {
		const left = settingsFor(pick.agent, this.agents, this.conversations);
		const started = await startConversation(
			pick.agent,
			task,
			{
				...Object.fromEntries(left.map((each) => [each.id, each.current])),
				...effortSettings(pick.effort, left),
			},
			pick.model,
			true,
		).catch(() => null);
		if (started === null) {
			this.compose(newDraft(this.project, task), text);
			return newAddress(pick.agent, task, pick.model ?? null);
		}
		this.feed.put(started);
		const sending = this.feed.send(started.id, text);
		void promptConversation(started.id, text, [], false, sending.id)
			.then((state) => this.feed.answered(started.id, sending, state))
			.catch((error: unknown) => this.feed.refused(started.id, sending, error));
		return started.id;
	}

	/**
	 * What `pick` reads as: "Claude", or "Claude · Opus 5.5" on a model, and
	 * "Claude · Opus 5.5 · High" at a thinking level.
	 */
	pickName(pick: AgentPick): string {
		const agent = this.agents.find((each) => each.id === pick.agent);
		const model = agent?.models?.find((each) => each.id === pick.model);
		const level = thinkingOf(agent?.settings ?? []).find(
			(each) => each.value === pick.effort,
		);
		return [
			agent?.name ?? pick.agent,
			pick.model === undefined ? undefined : (model?.name ?? pick.model),
			pick.effort === undefined ? undefined : (level?.name ?? pick.effort),
		]
			.filter((each) => each !== undefined)
			.join(" · ");
	}

	/**
	 * Composes `assignment`'s prompt in conversation `id`'s composer, and answers
	 * its address.
	 */
	link(id: string, assignment: Assignment): string {
		this.compose(id, promptFor(assignment));
		return id;
	}

	/** Puts `text` ahead of whatever waits in the draft under `key`. */
	private compose(key: string, text: string): void {
		const kept = this.drafts.read(key);
		if (kept.includes(text)) {
			return;
		}
		this.drafts.write(key, kept.trim() === "" ? text : `${text}\n\n${kept}`);
	}
}

/** What an agent takes to mean "work on this". */
export function promptFor(assignment: Assignment): string {
	switch (assignment.kind) {
		case "todo":
			return taskNumberReference(assignment.id);
		case "task":
			return taskReference(assignment.task);
	}
}

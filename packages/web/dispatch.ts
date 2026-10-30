import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { AgentPick } from "@stringsync/splates-server/models";
import {
	effortSettings,
	thinkingOf,
} from "@stringsync/splates-server/models/browser";
import {
	type DemoPoint,
	demoReference,
	externals,
	type Need,
	type Needing,
	needs,
	orphaned,
	taskNumberReference,
	taskReference,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { agentFor, NEW, newAddress, settingsFor } from "./conversation-address";
import {
	promptConversation,
	startAutoPick,
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
		readonly drafts: Drafts,
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
		return this.listed((conversation) => conversation.heldForTask === id);
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

	/**
	 * What `task` needs when it is an external agent's, a live task no listed
	 * conversation runs in nor is about to, as `externals` says, else null:
	 * the page can only bring its session in, as it asks in its own.
	 */
	external(task: string): Need | null {
		return (
			externals(this.tasks, this.conversations).find(
				(row) => row.task?.task === task,
			)?.need ?? null
		);
	}

	/** Lists `conversation`, a session just brought in, before the server says. */
	brought(conversation: ConversationState): void {
		this.feed.put(conversation);
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
	 * Starts a conversation on what Auto pick decides for `assignment`, and
	 * sends it the prompt, answering its address once it is started, as
	 * `begin` does: the server answers before the judge, so the thread opens
	 * at once, its agent opening on the pick. When it does not start, the
	 * address of the screen that starts one with the first agent, the prompt
	 * in its composer.
	 */
	async auto(assignment: Assignment): Promise<string> {
		const task = assignment.kind === "task" ? assignment.task : null;
		const text = promptFor(assignment);
		const started = await startAutoPick(
			assignment.kind === "task"
				? { task: assignment.task }
				: { todo: assignment.id },
		).catch(() => null);
		if (started === null) {
			this.compose(newDraft(this.project, task), text);
			return newAddress(
				agentFor(NEW, this.agents, this.conversations),
				task,
				null,
			);
		}
		return this.send(started, text);
	}

	/**
	 * Asks for a demo of `task` at `point` in a new conversation in the main
	 * tree, where the agent adds the demo's own task, answering its address
	 * as `beginWith` does.
	 */
	demo(task: string, point: DemoPoint): Promise<string> {
		const agent = agentFor(NEW, this.agents, this.conversations);
		return this.beginWith({ agent }, null, demoReference(task, point));
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
		const started = await startConversation(pick.agent, task, {
			settings: {
				...Object.fromEntries(left.map((each) => [each.id, each.current])),
				...effortSettings(pick.effort, left),
			},
			model: pick.model,
			assigned: true,
		}).catch(() => null);
		if (started === null) {
			this.compose(newDraft(this.project, task), text);
			return newAddress(pick.agent, task, pick.model ?? null);
		}
		return this.send(started, text);
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

	/**
	 * Shows `started` and sends it `text`, showing as sent at once and kept
	 * in its thread as unsent when refused; answers its address.
	 */
	private send(started: ConversationState, text: string): string {
		this.feed.put(started);
		const sending = this.feed.send(started.id, text);
		void promptConversation(started.id, text, [], false, sending.id)
			.then((state) => this.feed.answered(started.id, sending, state))
			.catch((error: unknown) => this.feed.refused(started.id, sending, error));
		return started.id;
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

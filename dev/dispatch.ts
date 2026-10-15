import type { ConversationState } from "../conversations";
import { type Needing, needs } from "../needs";
import { laneReference, taskReference, todoReference } from "../prompts";
import type { AgentPick } from "../roster";
import type { Details } from "../show";
import { settingsFor } from "./conversation-address";
import { promptConversation, startConversation } from "./conversation-api";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { type Drafts, newDraft } from "./drafts";

/** What a todo, a lane or a task is, to put an agent to work on it. */
export type Assignment =
	| { kind: "todo"; id: number }
	/** A lane by its number, or null for the untriaged todos. */
	| { kind: "lane"; id: number | null }
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
		const listed = needs({
			tasks: this.tasks,
			conversations: this.conversations,
		});
		return this.conversations.flatMap(
			(conversation) =>
				listed.find(
					(each) =>
						each.conversation === conversation && conversation.task === task,
				) ?? [],
		);
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
		const address = task === null ? `new/${agent}` : `new/${agent}/${task}`;
		return model === undefined
			? address
			: `${address}?model=${encodeURIComponent(model)}`;
	}

	/**
	 * Starts a conversation with `pick`'s agent on its model, and sends it
	 * `assignment`'s prompt, answering its address once it is started, with the
	 * prompt showing as sent. Each setting starts where a new conversation's
	 * would. When it does not start, the address of the screen
	 * that does, the prompt in its composer; when the prompt is refused, it
	 * stays in the conversation's thread as unsent.
	 */
	async begin(pick: AgentPick, assignment: Assignment): Promise<string> {
		const task = assignment.kind === "task" ? assignment.task : null;
		const text = promptFor(assignment);
		const left = settingsFor(pick.agent, this.agents, this.conversations);
		const started = await startConversation(
			pick.agent,
			task,
			Object.fromEntries(left.map((each) => [each.id, each.current])),
			pick.model,
			true,
		).catch(() => null);
		if (started === null) {
			return this.start(pick.agent, assignment, pick.model);
		}
		this.feed.put(started);
		const sending = this.feed.send(started.id, text);
		void promptConversation(started.id, text).catch((error: unknown) =>
			this.feed.refused(started.id, sending, error),
		);
		return started.id;
	}

	/** What `pick` reads as: "Claude", or "Claude · Opus 5.5" on a model. */
	pickName(pick: AgentPick): string {
		const agent = this.agents.find((each) => each.id === pick.agent);
		const model = agent?.models?.find((each) => each.id === pick.model);
		const name = agent?.name ?? pick.agent;
		return pick.model === undefined
			? name
			: `${name} · ${model?.name ?? pick.model}`;
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
			return todoReference(assignment.id);
		case "lane":
			return laneReference(assignment.id);
		case "task":
			return taskReference(assignment.task);
	}
}

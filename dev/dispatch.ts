import type { ConversationState } from "../conversations";
import { type Needing, need } from "../needs";
import type { Details } from "../show";
import { laneReference, todoReference } from "./card";
import type { AgentChoice } from "./conversation-feed";
import { type Drafts, newDraft } from "./drafts";

/** What a todo, a lane or a task is, to put an agent to work on it. */
export type Assignment =
	| { kind: "todo"; id: number }
	| { kind: "lane"; id: number }
	| { kind: "task"; task: string };

/**
 * Puts agents to work from the board and the Tasks page: who is on a task
 * already, and a conversation for the rest, started or picked. Neither
 * sends anything: each writes the prompt into a composer and names the
 * conversation address (`#conversations/<address>`) to open it at, so the
 * person picks the agent's settings, or adds to the prompt, before sending.
 * A link is only the prompt: the agent takes the work, and its conversation
 * follows it into the task, or it means nothing.
 */
export class Dispatch {
	constructor(
		private readonly drafts: Drafts,
		/** The project the page shows, by its `?project=` slug, or null. */
		private readonly project: string | null,
		readonly agents: AgentChoice[],
		/** Every conversation, archived too, newest first. */
		private readonly conversations: ConversationState[],
		private readonly tasks: Details[],
	) {}

	/**
	 * The conversations working `task`, newest first, with what each needs;
	 * archived ones, put away, are not.
	 */
	on(task: string): Needing[] {
		const details = this.tasks.find((each) => each.task === task) ?? null;
		return this.conversations
			.filter((each) => each.task === task && !each.archived)
			.map((conversation) => ({
				conversation,
				task: details,
				need: need(details, conversation),
			}));
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
	 * task in its tree, and answers the address of the screen that starts it.
	 */
	start(agent: string, assignment: Assignment): string {
		const task = assignment.kind === "task" ? assignment.task : null;
		this.compose(newDraft(this.project, task), promptFor(assignment));
		return task === null ? `new/${agent}` : `new/${agent}/${task}`;
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
			return `Run \`arbor claim ${assignment.task}\` and carry on from its ARBOR.md.`;
	}
}

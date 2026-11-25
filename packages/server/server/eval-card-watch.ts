import type { Resource } from "core/disposable";
import {
	type Conversations,
	type Message,
	SERVER_TOLD,
} from "../conversations";
import {
	type EvalAutoCard,
	type EvalAutoStart,
	evalBudgetShortPrompt,
	evalCardKey,
} from "../evals";
import { type EvalAsk, stretches } from "../plans";
import type { Project } from "./project";

/** What a run-evals card may name: the scenarios the project lists and the agents saved. */
export interface EvalCardRefs {
	/** Every listed scenario id; null when the project lists none, so none is checked. */
	scenarios: string[] | null;
	/** Every saved agent, as `agent:model@effort`. */
	agents: string[];
}

/** Where a run-evals card's names are checked against. */
export interface EvalCardSource {
	/** What a card may name for a conversation working in `cwd`; null when the project has no evals. */
	refs(project: Project, cwd: string | null): Promise<EvalCardRefs | null>;
	/**
	 * Starts the round a card that can run asks for when the conversation's
	 * approved eval budget covers it, answering what became of it.
	 */
	autoStart?(
		project: Project,
		card: EvalAutoCard,
	): Promise<EvalAutoStart | null>;
}

/**
 * What tells an agent its run-evals card names what cannot run, or null when
 * it all can. The card stays on the page as no more than text, so the agent
 * sends a corrected one.
 */
export function evalCardRefusal(
	ask: Pick<EvalAsk, "scenarios" | "agents">,
	refs: EvalCardRefs,
): string | null {
	const known = new Set(refs.scenarios ?? ask.scenarios);
	const scenarios = ask.scenarios.filter((each) => !known.has(each));
	const saved = new Set(refs.agents);
	const agents = (ask.agents ?? []).filter((each) => !saved.has(each));
	if (scenarios.length === 0 && agents.length === 0) {
		return null;
	}
	const reasons = [
		scenarios.length > 0 && `not scenarios: ${scenarios.join(", ")}`,
		agents.length > 0 &&
			`not saved eval agents: ${agents.join(", ")} (\`splates evals agents\` prints them)`,
	].filter((each) => each !== false);
	return `Your run-evals card cannot be run: ${reasons.join("; ")}. Check the scenario ids against the project's evals list, leave out agents that are not saved, and send the corrected card.`;
}

/**
 * Holds each run-evals card an agent sends to what can run: when a turn ends
 * on a card naming a scenario the project does not list, or an agent that is
 * not saved, the agent is told. A card that can run starts by itself within
 * the conversation's approved eval budget; past it, the agent is told to ask
 * for more.
 */
export class EvalCardWatch implements Resource {
	private readonly unlisten: () => void;

	constructor(
		private readonly project: Project,
		private readonly conversations: Conversations,
		private readonly source: EvalCardSource,
	) {
		this.unlisten = conversations.events.on("ended", (id) => {
			void this.look(id).catch((error: unknown) =>
				this.project.log.error(String(error)),
			);
		});
	}

	/** Checks the run-evals card a conversation's last reply ended on, if any. */
	private async look(id: string): Promise<void> {
		const conversation = (await this.conversations.list()).find(
			(each) => each.state.id === id,
		);
		const last = conversation?.state.messages.at(-1);
		if (conversation === undefined || last?.role !== "agent") {
			return;
		}
		const words = last.parts
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n\n");
		for (const stretch of stretches(words)) {
			if (
				stretch.type !== "permission" ||
				stretch.permission.action !== "run-evals" ||
				stretch.permission.evals === undefined
			) {
				continue;
			}
			// A list that cannot be read is no reason to bounce a card.
			const refs = await this.source
				.refs(this.project, conversation.cwd ?? null)
				.catch((error: unknown) => {
					this.project.log.error(String(error));
					return null;
				});
			const refusal =
				refs === null ? null : evalCardRefusal(stretch.permission.evals, refs);
			if (refusal !== null) {
				await conversation.prompt(refusal, [], undefined, {
					told: SERVER_TOLD,
				});
				return;
			}
			if (refs !== null && this.source.autoStart !== undefined) {
				const ask = stretch.permission.evals;
				const started = await this.source.autoStart(this.project, {
					ask,
					key: evalCardKey(
						ask,
						stretch.permission.title,
						id,
						messageKey(conversation.state.messages, last, conversation.state),
					),
					conversation: id,
					cwd: conversation.cwd ?? null,
				});
				// A round past the budget waits on the agent's ask for more.
				if (started !== null && "short" in started) {
					await conversation.prompt(
						evalBudgetShortPrompt(started.short.ceiling, started.short.budget),
						[],
						undefined,
						{ told: SERVER_TOLD },
					);
				}
				return;
			}
		}
	}

	dispose(): void {
		this.unlisten();
	}
}

/**
 * The id the page gives `message`: its place among the conversation's sent
 * messages, after the prompt a conversation held for its task shows first.
 */
export function messageKey(
	messages: readonly Message[],
	message: Message,
	state: { heldForTask: number | null },
): string {
	const sent = messages.filter((each) => !each.queued);
	return String(sent.indexOf(message) + (state.heldForTask === null ? 0 : 1));
}

import { OctagonXIcon } from "lucide-react";
import { createContext, type JSX, useContext } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import type { ConversationState, Setting } from "../conversations";
import { AskPanel } from "./ask-panel";
import { terminateConversation } from "./conversation-api";
import { useNameOf } from "./conversation-names";
import type { Drafts } from "./drafts";
import { Refusal, useRefusal } from "./refusal";
import { ContextMeter } from "./usage";

/**
 * Every conversation the page holds, archived ones too: what tells whether one
 * answers to another, so is read-only here, and which agents one handed tasks
 * to. Provided once, over every list and thread.
 */
export const Held = createContext<readonly ConversationState[]>([]);

/**
 * The conversation `conversation` answers to, while it is there: it handed
 * `conversation` its task, so the page writes nothing to `conversation`, and
 * every control that would shows its read-only variant. Null for one the
 * person talks to, or once the one it answered to is gone, so it is never
 * stranded.
 */
export function useHandedOutBy(
	conversation: ConversationState,
): ConversationState | null {
	return handedOutBy(conversation, useContext(Held));
}

/**
 * Whether the conversation `id` answers to another, so every control that
 * would write to it shows its read-only variant.
 */
export function useReadOnly(id: string): boolean {
	const held = useContext(Held);
	const conversation = held.find((each) => each.id === id);
	return conversation !== undefined && handedOutBy(conversation, held) !== null;
}

/** What `useHandedOutBy` reads, from the conversations in `held`. */
export function handedOutBy(
	conversation: ConversationState,
	held: readonly ConversationState[],
): ConversationState | null {
	const { handedBy } = conversation;
	return handedBy === null
		? null
		: (held.find((each) => each.id === handedBy) ?? null);
}

/** The conversations `conversation` handed tasks to, oldest first. */
export function useHandedTo(
	conversation: ConversationState,
): ConversationState[] {
	return useContext(Held).filter((each) => each.handedBy === conversation.id);
}

/**
 * In place of the composer of a conversation another handed its task to:
 * the agent answers to that one, so its questions and reviews go there, and
 * the person talks to it there. Terminate is the way out, stopping the agent
 * and telling that one, which decides what becomes of the task. What the
 * composer's row would show, its model, effort and context, it shows read-only:
 * that one picked them.
 */
export function HandedOut({
	conversation,
	by,
	onOpen,
}: {
	conversation: ConversationState;
	by: ConversationState;
	onOpen: (id: string) => void;
}): JSX.Element {
	const nameOf = useNameOf();
	const { refusal, attempt } = useRefusal();
	const working =
		conversation.status === "starting" || conversation.status === "running";
	const picked = settingsLine(conversation.settings);
	return (
		<div
			role="note"
			aria-label="handed out"
			className="flex flex-col gap-1 rounded-(--composer-radius) border px-4 py-3 text-muted-foreground text-sm"
		>
			<div className="flex items-center gap-3">
				<p className="flex-1">
					Handed out by{" "}
					<Button
						variant="link"
						className="h-auto p-0 font-medium"
						onClick={() => onOpen(by.id)}
					>
						{nameOf(by)}
					</Button>
					, which it reports to. Talk to it there.
				</p>
				{working && (
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							void attempt(
								terminateConversation(conversation.id),
								"Not terminated",
							)
						}
					>
						<OctagonXIcon data-icon="inline-start" />
						Terminate
					</Button>
				)}
			</div>
			<div className="flex min-w-0 items-center gap-1 text-xs empty:hidden">
				{picked !== "" && <span className="truncate">{picked}</span>}
				<ContextMeter usage={conversation.usage} />
			</div>
			<Refusal refusal={refusal} className="text-right" />
		</div>
	);
}

/**
 * A session's settings as the composer's pickers read: each pick by its
 * option's name, and a toggle by its own name while on.
 */
function settingsLine(settings: Setting[]): string {
	return settings
		.flatMap((setting) =>
			setting.type === "boolean"
				? setting.current === "on"
					? [setting.name]
					: []
				: [
						setting.options.find((option) => option.value === setting.current)
							?.name ?? setting.current,
					],
		)
		.join(" · ");
}

/**
 * What an agent this conversation handed a task to asks permission for,
 * shown above this one's composer: the agent answers to this one, but only
 * the person can let it run a tool, so they answer here, named by the agent.
 */
export function AgentAsk({
	drafts,
	conversation,
}: {
	drafts: Drafts;
	/** The agent's conversation, which holds the ask. */
	conversation: ConversationState;
}): JSX.Element | null {
	const nameOf = useNameOf();
	if (conversation.ask === null) {
		return null;
	}
	return (
		<AskPanel
			key={conversation.ask.id}
			drafts={drafts}
			conversation={conversation}
			agent={nameOf(conversation)}
			ask={conversation.ask}
			keys={false}
		/>
	);
}

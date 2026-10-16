import { CheckIcon, ListIcon } from "lucide-react";
import { createContext, type JSX, type ReactNode, useContext } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import type { Needing } from "../needs";
import { AgentIcon } from "./agent-icons";
import { reparentConversation } from "./conversation-api";
import { useNameOf } from "./conversation-names";
import { flatten } from "./conversation-rows";
import { Held, useHandedOutBy } from "./handed-out";
import type { Nested } from "./parts";
import type { Refuse } from "./refusal";

/** Where a conversation in a list sits, and where else it could. */
export interface Places {
	/** The conversation it sits under, by id; null at the top. */
	under: string | null;
	/** Every other conversation listed, as they show, but those under it. */
	others: ConversationState[];
}

/**
 * The places of each conversation a list shows, by its id, and the name of
 * each agent: what "Move under…" offers. Provided by each list over its rows;
 * a row with none offers no move.
 */
export const Placing = createContext<{
	places: ReadonlyMap<string, Places>;
	agentOf: (conversation: ConversationState) => string;
}>({ places: new Map(), agentOf: (conversation) => conversation.agent });

/** The places of each conversation in `trees`, as `Placing` provides them. */
export function placesOf(trees: Nested<Needing>[]): Map<string, Places> {
	const listed = flatten(trees).flatMap(({ conversation }) =>
		conversation === null ? [] : [conversation],
	);
	const places = new Map<string, Places>();
	const visit = ({ row, parts }: Nested<Needing>, under: string | null) => {
		const own = row.conversation;
		if (own !== null) {
			const inside = new Set(
				flatten([{ row, parts }]).map((each) => each.conversation?.id),
			);
			places.set(own.id, {
				under,
				others: listed.filter((each) => !inside.has(each.id)),
			});
		}
		for (const part of parts) {
			visit(part, own?.id ?? null);
		}
	};
	for (const tree of trees) {
		visit(tree, null);
	}
	return places;
}

/**
 * `conversation`'s places in the list around it; null where it has none, as
 * for a subagent, which stays under the one it answers to.
 */
export function usePlaces(conversation: ConversationState): Places | null {
	const places = useContext(Placing).places.get(conversation.id) ?? null;
	return useHandedOutBy(conversation) === null ? places : null;
}

/**
 * Asks where in the list to nest `conversation`: at the top, or under any
 * other conversation listed but its own, the one it sits under now checked.
 * Moving it cuts it loose from the lane orchestrator that started it, which
 * says so first.
 */
export function MoveUnder({
	conversation,
	places,
	open,
	onOpenChange,
	refuse,
}: {
	conversation: ConversationState;
	places: Places;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	refuse: Refuse;
}): JSX.Element {
	const nameOf = useNameOf();
	const { agentOf } = useContext(Placing);
	const { startedBy } = conversation;
	const starter = useContext(Held).find((each) => each.id === startedBy);
	const move = (parent: string | null) => {
		onOpenChange(false);
		if (parent !== places.under) {
			void reparentConversation(conversation.id, parent).catch(
				(error: unknown) => refuse("Not moved", error),
			);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-3">
				<DialogHeader>
					<DialogTitle>Move {nameOf(conversation)} under</DialogTitle>
					{starter !== undefined && (
						<DialogDescription>
							{nameOf(starter)} started it. Moved, it is yours alone:{" "}
							{nameOf(starter)} no longer hears from it, wakes it, or archives
							it along.
						</DialogDescription>
					)}
				</DialogHeader>
				<ul
					aria-label="Places"
					className="-mx-2 flex max-h-80 flex-col overflow-y-auto"
				>
					<Place current={places.under === null} onPick={() => move(null)}>
						<ListIcon className="size-4 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate">Nothing: at the top</span>
					</Place>
					{places.others.map((each) => (
						<Place
							key={each.id}
							current={places.under === each.id}
							onPick={() => move(each.id)}
						>
							<AgentIcon
								agent={each.agent}
								name={agentOf(each)}
								className="size-4 text-foreground/70"
							/>
							<span className="min-w-0 flex-1 truncate">{nameOf(each)}</span>
						</Place>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	);
}

/** One place to move a conversation to, checked where it sits now. */
function Place({
	current,
	onPick,
	children,
}: {
	current: boolean;
	onPick: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<li>
			<button
				type="button"
				aria-current={current ? "true" : undefined}
				onClick={onPick}
				className={cn(
					"flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted pointer-coarse:h-12 pointer-coarse:text-base",
					current && "font-medium",
				)}
			>
				{children}
				{current && <CheckIcon className="size-4 shrink-0" />}
			</button>
		</li>
	);
}

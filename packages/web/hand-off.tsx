import type { ConversationState } from "@stringsync/splates-server/conversations";
import { ChevronDownIcon, RotateCwIcon, UserRoundPlusIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { still, touchItems } from "./board";
import { handOffConversation, restartConversation } from "./conversation-api";
import { Dispatching } from "./dispatching";
import type { Refuse } from "./refusal";

/** Choose another agent to continue this task in a new conversation. */
export function HandOffItems({
	conversation,
	refused,
	onStart,
}: {
	conversation: ConversationState;
	refused: Refuse;
	/** Called as a pick hands it off, as to close a dialog. */
	onStart?: () => void;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const { task } = conversation;
	if (context === null || task === null) {
		return null;
	}
	const { dispatch } = context;
	const handOff = (agent: string): void => {
		onStart?.();
		handOffConversation(conversation.id)
			.then((prompt) => dispatch.beginWith({ agent }, task, prompt))
			.then(context.open)
			.catch((error: unknown) => refused("Not handed off", error));
	};
	return (
		<DropdownMenuGroup>
			<DropdownMenuLabel>Hand to a new conversation with</DropdownMenuLabel>
			{dispatch.agents.map((each) => (
				<DropdownMenuItem key={each.id} onClick={() => handOff(each.id)}>
					<AgentMark agent={each.id} name={each.name} />
					{each.name}
				</DropdownMenuItem>
			))}
		</DropdownMenuGroup>
	);
}

/** `HandOffItems` behind a button of its own, for beside a task's actions. */
export function HandOffMenu({
	conversation,
	refused,
	className,
}: {
	conversation: ConversationState;
	refused: Refuse;
	className?: string;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="sm"
						variant="outline"
						className={cn(
							"w-fit gap-1 bg-transparent pointer-coarse:h-10 pointer-coarse:px-3",
							className,
						)}
						{...still}
					/>
				}
			>
				<UserRoundPlusIcon data-icon="inline-start" />
				Hand to a new agent
				<ChevronDownIcon className="text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className={cn("w-56", touchItems)}>
				<HandOffItems conversation={conversation} refused={refused} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Starts the agent of `conversation` again in a new session on its task,
 * told to claim it, for one stuck or dead there.
 */
export function RestartButton({
	conversation,
	refused,
	className,
}: {
	conversation: ConversationState;
	refused: Refuse;
	className?: string;
}): JSX.Element {
	const [restarting, setRestarting] = useState(false);
	return (
		<Button
			size="sm"
			variant="outline"
			disabled={restarting}
			className={cn(
				"bg-transparent pointer-coarse:h-10 pointer-coarse:px-3",
				className,
			)}
			onClick={() => {
				setRestarting(true);
				restartConversation(conversation.id)
					.catch((error: unknown) => refused("Not restarted", error))
					.finally(() => setRestarting(false));
			}}
		>
			<RotateCwIcon />
			{restarting ? "Restarting…" : "Restart"}
		</Button>
	);
}

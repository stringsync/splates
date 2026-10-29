import { ChevronDownIcon, SquareTerminalIcon } from "lucide-react";
import type { JSX } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { AUTO_PICK_NAME, AutoIcon } from "./auto-brand";
import { autoAddress, newAddress } from "./conversation-address";
import { type AgentChoice, agentName } from "./conversation-feed";
import type { Move } from "./page-address";
import type { Terminals } from "./terminals";
import { TITLE } from "./top-bar";

/**
 * A new conversation's title: the agent it starts with, which opens a menu
 * of the agents to start it with instead, in the same tree, what was typed
 * carried over, and a terminal in the main tree.
 */
export function AgentPicker({
	agents,
	agent,
	auto,
	task,
	terminals,
	onOpen,
}: {
	agents: AgentChoice[];
	agent: string;
	/** Whether Auto pick chooses the agent from the first message. */
	auto: boolean;
	/** The task whose tree it starts in; null for the main tree. */
	task: string | null;
	terminals: Terminals;
	onOpen: (id: string, how?: Move) => void;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label="Pick an agent"
						className={cn(
							TITLE,
							"-mx-2 flex items-center gap-1.5 rounded-full px-2 hover:bg-muted active:bg-muted max-md:h-10 md:h-7",
						)}
					/>
				}
			>
				{auto ? <AutoIcon colored /> : <AgentMark agent={agent} />}
				{auto ? AUTO_PICK_NAME : agentName(agents, agent)}
				<ChevronDownIcon className="size-4 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuItem
					className="max-md:h-11"
					onClick={() => onOpen(autoAddress(task), "replace")}
				>
					<AutoIcon colored />
					{AUTO_PICK_NAME}
				</DropdownMenuItem>
				{agents.map((each) => (
					<DropdownMenuItem
						key={each.id}
						className="max-md:h-11"
						onClick={() => onOpen(newAddress(each.id, task), "replace")}
					>
						<AgentMark agent={each.id} name={each.name} />
						{each.name}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				{/* New becomes the terminal, as a draft becomes its conversation. */}
				<DropdownMenuItem
					className="max-md:h-11"
					onClick={() => onOpen(terminals.another(), "replace")}
				>
					<SquareTerminalIcon />
					Terminal
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

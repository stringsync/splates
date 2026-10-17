import { useReactive } from "@webappwiz/react";
import { ChevronDownIcon, PlusIcon, SquareTerminalIcon } from "lucide-react";
import { type JSX, useRef } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { cn } from "#dev/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { composerIn } from "./composer-editor";
import { agentFor, NEW, startsOne } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { useHeld } from "./hooks/use-held";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "./hooks/use-shortcut";
import { useTouch } from "./hooks/use-touch";
import type { Terminals } from "./terminals";

/**
 * New, atop the sidebar, boxed so it stands out from the tabs under it: a menu
 * of the agents to start a conversation with, and a terminal. ⌥⌘N (Ctrl+Alt+N
 * off a Mac), as the settings bind it, starts one as the last was started,
 * and shows beside New while ⌥⌘ is held; ⌥` opens another terminal.
 */
export function NewMenu({
	feed,
	terminals,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	terminals: Terminals;
	/** The conversation shown, by its address, or null. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const { agents, conversations } = useReactive(
		feed,
		(feed) => ({ agents: feed.agents, conversations: feed.conversations }),
		["changed"],
	);
	// Whether the menu last closed on an agent, which its focus follows.
	const picked = useRef(false);
	const touch = useTouch();
	const held = useHeld();
	// With the agent, model, and settings the last one started with.
	useShortcut("shortcuts.new", () => onOpen(NEW));
	const newKey = useHeldKey("shortcuts.new");
	const newShortcut = useShortcutLabel("shortcuts.new");
	useShortcut("shortcuts.newTerminal", () => onOpen(terminals.another()));
	const terminalShortcut = useShortcutLabel("shortcuts.newTerminal");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-current={startsOne(open) ? "page" : undefined}
						className={cn(
							"mb-3 flex h-10 flex-none items-center gap-2.5 rounded-lg border bg-background px-3 text-left text-foreground text-sm hover:bg-accent",
							startsOne(open) && "bg-accent",
						)}
					/>
				}
			>
				<PlusIcon className="size-4" />
				<span className="flex-1">New</span>
				{held && newKey !== null ? (
					<Kbd aria-hidden>{newKey}</Kbd>
				) : (
					<ChevronDownIcon className="size-4 text-muted-foreground" />
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="w-44"
				// Into the composer of the conversation picked, ready to type, rather
				// than back to New, unless a finger is to tap it; otherwise as usual.
				finalFocus={() => {
					if (!picked.current) {
						return true;
					}
					picked.current = false;
					if (touch) {
						return true;
					}
					const section = document.querySelector(
						'section[aria-label="new conversation"]',
					);
					return (section === null ? null : composerIn(section)) ?? true;
				}}
			>
				{agents.map((each) => (
					<DropdownMenuItem
						key={each.id}
						onClick={() => {
							picked.current = true;
							onOpen(`${NEW}/${each.id}`);
						}}
					>
						<AgentIcon agent={each.id} name={each.name} />
						{each.name}
						{newShortcut !== null &&
							each.id === agentFor(NEW, agents, conversations) && (
								<Kbd className="ml-auto">{newShortcut}</Kbd>
							)}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => onOpen(terminals.another())}>
					<SquareTerminalIcon />
					Terminal
					{terminalShortcut !== null && (
						<Kbd aria-hidden className="ml-auto">
							{terminalShortcut}
						</Kbd>
					)}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

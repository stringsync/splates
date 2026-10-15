import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
	ChevronDownIcon,
	ChevronLeftIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { type JSX, useLayoutEffect, useRef } from "react";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import { AgentIcon, AgentMark } from "./agent-icons";
import { composerIn } from "./composer-editor";
import { NEW } from "./conversation-address";
import { agentName } from "./conversation-feed";
import { type Starting, useNewConversation } from "./conversation-home";
import { NamedContext } from "./mentioned";
import { Refusal } from "./refusal";
import type { Terminals } from "./terminals";
import { BarButton, TITLE, TopBar } from "./top-bar";

/**
 * Whether the inbox's composer was just tapped, raising the keyboard, which
 * this screen's composer takes over as it opens: iOS raises the keyboard
 * only for a focus a tap gives, so it is handed on rather than asked for again.
 */
let launched = false;

/** Says the next new conversation opens from a tap on a composer. */
export function launch(): void {
	launched = true;
}

/**
 * A new conversation on a phone, as the chat apps start one: the agent to
 * talk to picked at the top, a greeting in the middle, and the composer along
 * the bottom. The picker offers a terminal in the main tree too, as New does
 * on a wide screen.
 */
export function PhoneHome({
	terminals,
	onBack,
	...starting
}: Starting & {
	terminals: Terminals;
	/** Back to the inbox. */
	onBack: () => void;
}): JSX.Element {
	const { agents, agent, task, onOpen } = starting;
	const { runtime, refusal, controls, mentions, references, named } =
		useNewConversation(starting);
	const section = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		if (launched && section.current !== null) {
			launched = false;
			composerIn(section.current)?.focus();
		}
	}, []);
	const name = agentName(agents, agent);
	return (
		<section
			ref={section}
			aria-label="new conversation"
			className="flex h-full min-h-0 min-w-0 flex-col"
		>
			<TopBar
				leading={
					<BarButton label="Back to inbox" onClick={onBack}>
						<ChevronLeftIcon />
					</BarButton>
				}
				title={
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<button
									type="button"
									aria-label="Pick an agent"
									className={cn(
										TITLE,
										"-mx-2 flex h-10 items-center gap-1.5 rounded-full px-2 active:bg-muted",
									)}
								/>
							}
						>
							{name}
							<ChevronDownIcon className="size-4 text-muted-foreground" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-48">
							{agents.map((each) => (
								<DropdownMenuItem
									key={each.id}
									className="h-11"
									onClick={() => onOpen(`${NEW}/${each.id}`)}
								>
									<AgentIcon agent={each.id} name={each.name} />
									{each.name}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							{/* New becomes the terminal, as a draft becomes its conversation. */}
							<DropdownMenuItem
								className="h-11"
								onClick={() => onOpen(terminals.another(), "replace")}
							>
								<SquareTerminalIcon />
								Terminal
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			/>
			<AssistantRuntimeProvider runtime={runtime}>
				<Composing.Provider value={runtime.thread.composer}>
					<NamedContext value={named}>
						<div className="min-h-0 flex-1">
							<ThreadView
								docked
								autoFocus={false}
								mentions={mentions}
								references={references}
								welcome={
									<div className="fade-in animate-in fill-mode-both flex flex-col items-center gap-3 px-6 text-center duration-200">
										<AgentMark agent={agent} name={name} className="size-10" />
										<p className="font-medium text-2xl tracking-tight">
											What should we work on?
										</p>
										{task !== null && (
											<p className="text-muted-foreground">
												In <span className="font-mono">{task}</span>
											</p>
										)}
									</div>
								}
								above={<Refusal refusal={refusal} className="px-2" />}
								controls={controls}
							/>
						</div>
					</NamedContext>
				</Composing.Provider>
			</AssistantRuntimeProvider>
		</section>
	);
}

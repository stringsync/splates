import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ChevronLeftIcon } from "lucide-react";
import { type JSX, useLayoutEffect, useRef } from "react";
import { Thread as ThreadView } from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { Composing } from "#web/composing.tsx";
import { AgentMark } from "./agent-icons";
import { AgentPicker } from "./agent-picker";
import { AutoIcon } from "./auto-brand";
import { composerIn } from "./composer-editor";
import { agentName } from "./conversation-feed";
import {
	ProjectLine,
	type Starting,
	useNewConversation,
} from "./conversation-home";
import { NamedContext } from "./mentioned";
import { Refusal } from "./refusal";
import type { Terminals } from "./terminals";
import { BarButton, TopBar } from "./top-bar";

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
	const { agents, agent, auto, task, onOpen } = starting;
	const {
		runtime,
		refusal,
		project,
		controls,
		mentions,
		references,
		named,
		starting: busy,
	} = useNewConversation(starting);
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
					<AgentPicker
						agents={agents}
						agent={agent}
						auto={auto}
						task={task}
						terminals={terminals}
						onOpen={onOpen}
					/>
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
										{auto ? (
											<AutoIcon colored className="size-10" />
										) : (
											<AgentMark
												agent={agent}
												name={name}
												className="size-10"
											/>
										)}
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
								above={
									<>
										<Refusal refusal={refusal} className="px-2" />
										<ProjectLine>{project}</ProjectLine>
									</>
								}
								controls={controls}
								starting={busy}
							/>
						</div>
					</NamedContext>
				</Composing.Provider>
			</AssistantRuntimeProvider>
		</section>
	);
}

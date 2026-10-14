import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { type JSX, useContext, useRef, useState } from "react";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import { modelOption } from "../models";
import type { Details } from "../show";
import { AgentBrand, AgentIcon } from "./agent-icons";
import { promptConversation, startConversation } from "./api";
import { Back } from "./back";
import { FILES, filesOf, noted, said, useDraft } from "./composer-drafts";
import { useFileMentions, useNamed, useSystems } from "./composer-triggers";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
} from "./conversation-feed";
import { whereOf } from "./conversation-item";
import { nameOf, reportedAs, unnamed } from "./conversation-names";
import { needOf } from "./conversation-rows";
import { Trunk } from "./dispatching";
import { type Drafts, newDraft } from "./drafts";
import { Mark } from "./mark";
import { NamedContext } from "./mentioned";
import { limitsOf, PlanLimits } from "./plan-limits";
import { useReferences } from "./references";
import { Refusal, useRefusal } from "./refusal";
import { SettingControl } from "./setting-controls";
import { TreesContext } from "./work-row";

/** How many conversations the home screen offers to pick back up. */
const RECENT = 5;

const NO_MESSAGES: ThreadMessageLike[] = [];

/**
 * The screen with no conversation open: an empty thread whose first message
 * starts one with `agent` in `task`'s tree or the main tree, the agent's settings in its
 * composer, and under the greeting the latest unfinished conversations to
 * pick back up, none whose task merged.
 */
export function Home({
	drafts,
	tasks,
	feed,
	agents,
	agent,
	task,
	model,
	conversations,
	refuseIn,
	onOpen,
	onBack,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	tasks: Details[];
	feed: ConversationFeed;
	agents: AgentChoice[];
	/** The agent the conversation starts with, picked beside New conversation. */
	agent: string;
	/** The task whose tree it starts in; null for the main tree. */
	task: string | null;
	/** The model it starts on, by its id on the roster; null for as picked. */
	model: string | null;
	/** Every one, archived too, newest first. */
	conversations: ConversationState[];
	/** Says in a conversation's thread that a write to it was refused. */
	refuseIn: (id: string, title: string, error: unknown) => void;
	onOpen: (id: string) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const { refusal, refuse } = useRefusal();
	// What the agent's sessions offer is known from its latest conversation
	// here that got as far as a session, archived or not, and each setting
	// starts where that one left it; failing that, from its sessions in any
	// project; the first one with an agent on this machine starts with the
	// agent's own defaults.
	const offered =
		conversations.find(
			(each) => each.agent === agent && each.settings.length > 0,
		)?.settings ??
		agents.find((each) => each.id === agent)?.settings ??
		[];
	// A model asked for, as by a todo's agent, shows picked where it is offered.
	const [picks, setPicks] = useState<Record<string, string>>(() => {
		const asked = model === null ? null : modelOption(offered, model);
		return asked === null ? {} : { [asked.setting]: asked.value };
	});
	const listed = conversations.filter((each) => !each.archived);
	const [starting, setStarting] = useState(false);
	const restore = useRef<(text: string, files: File[]) => void>(() => {});
	// Only unfinished work at rest: one at work or waiting on the person is in
	// the sidebar already, and one whose task merged is done.
	const recent = listed
		.filter(
			(each) =>
				needOf(tasks, each).kind === "idle" && reportedAs(each) !== "merged",
		)
		.slice(0, RECENT);
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		isRunning: starting,
		convertMessage: (message: ThreadMessageLike) => message,
		adapters: { attachments: FILES },
		onNew: async (message) => {
			const text = said(message);
			const files = filesOf(message);
			setStarting(true);
			// Each as shown: where it was left, unless picked here.
			const settings = {
				...Object.fromEntries(offered.map((each) => [each.id, each.current])),
				...picks,
			};
			const state = await startConversation(
				agent,
				task,
				settings,
				// Until a session has offered its settings, the server picks it.
				model !== null && offered.length === 0 ? model : undefined,
			).catch((error: unknown) => {
				setStarting(false);
				restore.current(text, files);
				refuse("Not started", error);
				throw error;
			});
			feed.put(state);
			// Shown at once in its thread, so the person watches the agent come
			// up; the message waits on the server for the session to open.
			const sending =
				text !== "" || files.length > 0
					? feed.send(state.id, noted(text, files), files)
					: null;
			onOpen(state.id);
			await promptConversation(state.id, noted(text, files), files).catch(
				(error: unknown) => {
					// The conversation is open by now: what was not sent waits in its
					// composer, its words only.
					if (sending !== null) {
						feed.sent(state.id, sending);
					}
					drafts.write(state.id, text);
					refuseIn(state.id, "Not sent", error);
				},
			);
		},
	});
	restore.current = useDraft(
		runtime,
		drafts,
		newDraft(new URLSearchParams(location.search).get("project"), task),
	);
	const { adapter: mentions, paths } = useFileMentions(task);
	const systems = useSystems(task, tasks);
	const references = useReferences(tasks, [], systems ?? undefined);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		systems,
		task === null
			? root
			: (tasks.find((each) => each.task === task)?.worktree ?? null),
	);

	return (
		<section
			aria-label="new conversation"
			className="flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col gap-3"
		>
			{onBack !== null ? (
				<header className="flex min-h-9 items-center gap-2">
					<Back onBack={onBack} />
					<h2 className="font-medium text-sm">New conversation</h2>
				</header>
			) : (
				// A conversation's header's room, so the welcome sits where theirs do.
				<div aria-hidden className="h-9 shrink-0" />
			)}
			<AssistantRuntimeProvider runtime={runtime}>
				<Composing.Provider value={runtime.thread.composer}>
					<NamedContext value={named}>
						<ThreadView
							mentions={mentions ?? undefined}
							references={references}
							above={<Refusal refusal={refusal} className="px-2" />}
							welcome={
								<div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 font-medium text-2xl tracking-tight duration-200">
									<span>Start a conversation with</span>
									<AgentBrand agent={agent} name={agentName(agents, agent)} />
									{task !== null && (
										<span>
											in <span className="font-mono text-xl">{task}</span>
										</span>
									)}
								</div>
							}
							below={
								<>
									<PlanLimits limits={limitsOf(agents, conversations, agent)} />
									{recent.length > 0 && (
										<section
											aria-label="recent conversations"
											className="mt-4 flex flex-col gap-1 px-2"
										>
											<h3 className="pl-3 font-medium text-muted-foreground text-xs">
												Pick back up
											</h3>
											<ul className="flex flex-col">
												{recent.map((each) => (
													<li key={each.id}>
														<Recent
															conversation={each}
															agent={agentName(agents, each.agent)}
															onOpen={() => onOpen(each.id)}
														/>
													</li>
												))}
											</ul>
										</section>
									)}
								</>
							}
							controls={
								offered.length > 0 ? (
									offered.map((setting) => (
										<SettingControl
											key={setting.id}
											setting={setting}
											value={picks[setting.id] ?? setting.current}
											onChange={(value) =>
												setPicks((picks) => ({ ...picks, [setting.id]: value }))
											}
										/>
									))
								) : (
									<span className="px-1.5 text-[11px] text-muted-foreground">
										Settings appear once {agentName(agents, agent)} starts
									</span>
								)
							}
						/>
					</NamedContext>
				</Composing.Provider>
			</AssistantRuntimeProvider>
		</section>
	);
}

/** A conversation to pick back up: its agent, name, and where it runs. */
function Recent({
	conversation,
	agent,
	onOpen,
}: {
	conversation: ConversationState;
	agent: string;
	onOpen: () => void;
}): JSX.Element {
	const reported = reportedAs(conversation);
	const trunk = useContext(Trunk);
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05]"
		>
			<AgentIcon
				agent={conversation.agent}
				name={agent}
				className="size-3.5 text-foreground/70"
			/>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					unnamed(conversation) && "text-muted-foreground italic",
				)}
			>
				{nameOf(conversation)}
			</span>
			{whereOf(conversation, trunk) !== null && (
				<span className="shrink-0 truncate text-muted-foreground text-xs">
					{whereOf(conversation, trunk)}
				</span>
			)}
			{reported !== null && (
				<Mark need={{ kind: "idle" }} reported={reported} />
			)}
		</button>
	);
}

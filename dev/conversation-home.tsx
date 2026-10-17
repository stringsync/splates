import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { type JSX, useContext, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState, Setting } from "../conversations";
import { modelOption } from "../models";
import type { Details } from "../show";
import { useAdapters } from "./adapters";
import { AgentBrand, AgentIcon } from "./agent-icons";
import { WIDE } from "./app-nav";
import { filesOf, noted, said, useDictated, useDraft } from "./composer-drafts";
import {
	useFileMentions,
	useNamed,
	useProjects,
	useSystems,
} from "./composer-triggers";
import { settingsFor } from "./conversation-address";
import { promptConversation, startConversation } from "./conversation-api";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
} from "./conversation-feed";
import { whereOf } from "./conversation-item";
import {
	reportedAs,
	reportsDone,
	unnamed,
	useNameOf,
} from "./conversation-names";
import { hostingWork, needOf } from "./conversation-rows";
import { Trunk } from "./dispatching";
import { type Drafts, newDraft } from "./drafts";
import { Mark } from "./mark";
import { NamedContext } from "./mentioned";
import type { Move } from "./page-address";
import { limitsOf, PlanLimits } from "./plan-limits";
import { useReferences } from "./references";
import { Refusal, useRefusal } from "./refusal";
import { SettingControls } from "./setting-controls";
import { BELOW_BAR, TopBar } from "./top-bar";
import { TreesContext } from "./work-row";

/** How many conversations the home screen offers to pick back up. */
const RECENT = 5;

const NO_MESSAGES: ThreadMessageLike[] = [];

/** What `useNewConversation` takes: who starts it, where, and what to tell. */
export interface Starting {
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
	/** Opens `id`, in place of what is open for `replace`. */
	onOpen: (id: string, how?: Move) => void;
}

/**
 * An empty thread whose first message starts a conversation with `agent`,
 * opening it once it is up, and what its composer offers: the agent's
 * settings, the files, systems and tasks to mention, and why a start was
 * refused. Laid out by `Home`, or by the phone's own screen.
 */
export function useNewConversation({
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
}: Starting) {
	const { refusal, refuse } = useRefusal();
	const offered = settingsFor(agent, agents, conversations);
	const modelSetting = offered.find(
		(each) => each.category === "model" || each.id === "model",
	);
	const [picks, setPicks] = useState<Record<string, string>>({});
	// Resolve against each refreshed catalog, without losing an unavailable request.
	const asked =
		model === null ? null : modelOption(offered, model, agent === "opencode");
	const requested =
		model === null
			? undefined
			: (picks[modelSetting?.id ?? ""] ?? asked?.value ?? model);
	const current = (setting: Setting) =>
		picks[setting.id] ??
		(setting.id === modelSetting?.id ? requested : undefined) ??
		setting.current;

	const [starting, setStarting] = useState(false);
	const restore = useRef<(text: string, files: File[]) => void>(() => {});
	const dictated = useRef<() => boolean>(() => false);
	const adapters = useAdapters();
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		isRunning: starting,
		convertMessage: (message: ThreadMessageLike) => message,
		adapters,
		onNew: async (message) => {
			const text = said(message);
			const files = filesOf(message);
			const spoken = text !== "" && dictated.current();
			// Running, the thread drops its composer to the bottom: it slides
			// there at once, rather than when the server answers.
			const dropped = slide(() => setStarting(true));
			// Each as shown: where it was left, unless picked here.
			const settings = {
				...Object.fromEntries(offered.map((each) => [each.id, current(each)])),
				...picks,
			};
			const state = await startConversation(
				agent,
				task,
				settings,
				// Keep explicit requests even when the cached catalog no longer offers them.
				// A manual replacement wins; the server validates the exact identity.
				requested,
				// Asked for by a todo's agent, so no pick of the person's.
				model !== null,
			).catch((error: unknown) => {
				void slide(() => setStarting(false));
				restore.current(text, files);
				refuse("Not started", error);
				throw error;
			});
			feed.put(state);
			// Shown at once in its thread, so the person watches the agent come
			// up; the message waits on the server for the session to open.
			const sending =
				text !== "" || files.length > 0
					? feed.send(state.id, noted(text, files), files, text, spoken)
					: null;
			// After the drop, or the thread would cut it short.
			await dropped;
			void slide(() => onOpen(state.id, "replace"));
			await promptConversation(
				state.id,
				noted(text, files),
				files,
				spoken,
				sending?.id,
			).catch((error: unknown) => {
				// The conversation is open by now: what was not sent stays in its
				// thread, to send again or edit there.
				if (sending !== null) {
					feed.refused(state.id, sending, error);
				} else {
					refuseIn(state.id, "Not sent", error);
				}
			});
		},
	});
	restore.current = useDraft(
		runtime,
		drafts,
		newDraft(new URLSearchParams(location.search).get("project"), task),
	);
	dictated.current = useDictated(runtime);
	const { adapter: mentions, paths } = useFileMentions(task);
	const systems = useSystems(task, tasks);
	const projects = useProjects();
	const references = useReferences(
		tasks,
		[],
		systems ?? undefined,
		projects ?? undefined,
	);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		systems,
		projects,
		task === null
			? root
			: (tasks.find((each) => each.task === task)?.worktree ?? null),
	);
	const controls =
		offered.length > 0 ? (
			<SettingControls
				settings={offered}
				current={current}
				onChange={(setting, value) =>
					setPicks((picks) => ({ ...picks, [setting.id]: value }))
				}
			/>
		) : (
			<span className="px-1.5 text-[11px] text-muted-foreground">
				Settings appear once {agentName(agents, agent)} starts
			</span>
		);
	return {
		runtime,
		refusal,
		starting,
		controls,
		mentions: mentions ?? undefined,
		references,
		named,
	};
}

/**
 * The screen with no conversation open: an empty thread whose first message
 * starts one with `agent` in `task`'s tree or the main tree, the agent's settings in its
 * composer, and under the greeting the latest unfinished conversations to
 * pick back up, none whose task merged.
 */
export function Home(starting: Starting): JSX.Element {
	const { tasks, agents, agent, task, conversations, onOpen } = starting;
	const { runtime, refusal, controls, mentions, references, named } =
		useNewConversation(starting);
	const listed = conversations.filter((each) => !each.archived);
	// Only unfinished work at rest: one at work, through its subagents too, or
	// waiting on the person is in the sidebar already, and one whose task
	// merged, or whose lanes finished, is done.
	const hosting = hostingWork(tasks, conversations);
	const recent = listed
		.filter(
			(each) =>
				needOf(tasks, each).kind === "idle" &&
				!hosting.has(each.id) &&
				!reportsDone(each),
		)
		.slice(0, RECENT);

	return (
		<section
			aria-label="new conversation"
			className={cn(BELOW_BAR, "flex min-h-0 min-w-0 flex-col gap-3")}
		>
			<TopBar title="New conversation" />
			<AssistantRuntimeProvider runtime={runtime}>
				<Composing.Provider value={runtime.thread.composer}>
					<NamedContext value={named}>
						<ThreadView
							mentions={mentions}
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
							controls={controls}
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
	const nameOf = useNameOf();
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

/**
 * Runs `change` in a view transition, which moves each element named on both
 * sides of it, such as the composer, and fades the rest; at once where the
 * browser has none or motion is unwelcome. A phone changes at once too: its
 * keyboard closes as the message goes, and a composer sliding down beside it
 * reads as jank. Settles once it has played.
 */
async function slide(change: () => void): Promise<void> {
	if (
		!("startViewTransition" in document) ||
		!matchMedia(WIDE).matches ||
		matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		change();
		return;
	}
	await document
		.startViewTransition(async () => {
			flushSync(change);
			// assistant-ui's runtime takes up a change a task later, as with
			// `isRunning`: wait it out, so the transition ends where the page does.
			await new Promise((resolve) => setTimeout(resolve));
		})
		.finished.catch(() => {});
}

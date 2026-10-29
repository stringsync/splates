import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import type {
	ConversationState,
	Setting,
} from "@stringsync/splates-server/conversations";
import { modelOption } from "@stringsync/splates-server/models/browser";
import { orphaned } from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { Thread as ThreadView } from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { Composing } from "#web/composing.tsx";
import { cn } from "#web/lib/utils.ts";
import { useAdapters } from "./adapters";
import { AgentBrand } from "./agent-icons";
import { AgentPicker } from "./agent-picker";
import { WIDE } from "./app-nav";
import { AUTO_PICK_NAME, AutoIcon } from "./auto-brand";
import type { AutoPickControl } from "./auto-pick-switch";
import { Board } from "./board";
import { filesOf, noted, said, useDictated, useDraft } from "./composer-drafts";
import { composerIn } from "./composer-editor";
import { useFileMentions, useNamed, useProjects } from "./composer-triggers";
import {
	AUTO,
	autoAddress,
	autoModelChosen,
	NEW,
	newAddress,
	rememberAuto,
	rememberAutoModel,
	settingsFor,
	withDraft,
} from "./conversation-address";
import {
	chooseDefault,
	promptConversation,
	startAutoPick,
	startConversation,
} from "./conversation-api";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
} from "./conversation-feed";
import { type Drafts, newDraft } from "./drafts";
import { useTouch } from "./hooks/use-touch";
import { Orphaned } from "./list-rows";
import { NamedContext } from "./mentioned";
import type { Move } from "./page-address";
import { limitsOf, PlanLimits } from "./plan-limits";
import { shownProject, useProjectName } from "./project-places";
import { ProjectSwitcher } from "./projects";
import { useReferences } from "./references";
import { Refusal } from "./refusal";
import { SettingControls } from "./setting-controls";
import type { Terminals } from "./terminals";
import { BELOW_BAR, TopBar } from "./top-bar";
import { TreesContext } from "./work-row";

/** How many tasks the home screen offers to pick back up. */
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
	/** Whether Auto pick chooses the agent from the first message, `agent` standing in until then. */
	auto: boolean;
	/** The task whose tree it starts in; null for the main tree. */
	task: string | null;
	/** The model it starts on, by its id on the roster; null for as picked. */
	model: string | null;
	/** Separate draft within this tree; null for its original draft. */
	identity: string | null;
	/** Every one, archived too, newest first. */
	conversations: ConversationState[];
	/** Says in a conversation's thread that a write to it was refused. */
	refuseIn: (id: string, title: string, error: unknown) => void;
	/** Opens `id`, in place of what is open for `replace`. */
	onOpen: (id: string, how?: Move) => void;
	/**
	 * Why a start under each draft was refused, kept by the page, since the
	 * conversation is open by the time the server says.
	 */
	refusals: ReadonlyMap<string, string>;
	/** Goes back to `address` from conversation `id`, its start refused, if it is still open. */
	onRefused: (id: string, address: string) => void;
}

/**
 * An empty thread whose first message starts a conversation with `agent`,
 * opening it once it is up, and what its composer offers: the agent's
 * settings, the files and tasks to mention, and why a start was
 * refused. Laid out by `Home`, or by the phone's own screen.
 */
export function useNewConversation({
	drafts,
	tasks,
	feed,
	agents,
	agent,
	auto,
	task,
	model,
	identity,
	conversations,
	refuseIn,
	onOpen,
	refusals,
	onRefused,
}: Starting) {
	const offered = settingsFor(agent, agents, conversations);
	const modelSetting = offered.find(
		(each) => each.category === "model" || each.id === "model",
	);
	const [picks, setPicks] = useState<Record<string, string>>({});
	// How many settings are on their way to being kept as the agent's default.
	const [keeping, setKeeping] = useState(0);
	// A model a todo asked for stands: Auto pick is the person's own choice.
	const [autoModel, setAutoModel] = useState(autoModelChosen);
	const autoPick: AutoPickControl = {
		on: autoModel && model === null,
		switch: (on) => {
			setAutoModel(on);
			rememberAutoModel(on);
		},
	};
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

	// Held while the start is on its way: the composer stays where it is,
	// its Send busy, and the thread opens once the server has the conversation.
	const [starting, setStarting] = useState(false);
	const busy = useRef(false);
	const dictated = useRef<() => boolean>(() => false);
	const adapters = useAdapters();
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		convertMessage: (message: ThreadMessageLike) => message,
		adapters,
		onNew: async (message) => {
			const text = said(message);
			const files = filesOf(message);
			// Back in its composer, as one start at a time goes.
			const keep = () => {
				if (!drafts.holds(draft)) {
					drafts.attach(draft, files);
					drafts.write(draft, text);
				}
			};
			if (busy.current) {
				keep();
				return;
			}
			busy.current = true;
			setStarting(true);
			const spoken = text !== "" && dictated.current();
			const id = feed.newId();
			// Each as shown: where it was left, unless picked here.
			const settings = {
				...Object.fromEntries(offered.map((each) => [each.id, current(each)])),
				...picks,
			};
			const prompt = noted(text, files);
			const state = await (auto
				? startAutoPick({
						words: text,
						task,
						agent,
						id,
						attachments: files.map((file) => ({
							name: file.name,
							mimeType: file.type,
						})),
					})
				: startConversation(agent, task, {
						settings,
						// Keep explicit requests even when the cached catalog no longer offers them.
						// A manual replacement wins; the server validates the exact identity.
						model: requested,
						// Asked for by a todo's agent, so no pick of the person's.
						assigned: model !== null,
						autoPick: autoPick.on,
						id,
					})
			)
				.catch((error: unknown) => {
					// The words back where they were typed, unless something else
					// was typed there since.
					keep();
					refuseIn(draft, "Not started", error);
					onRefused(id, address);
					return null;
				})
				.finally(() => {
					busy.current = false;
					setStarting(false);
				});
			if (state === null) {
				return;
			}
			// What the server streamed of it meanwhile is newer than its answer,
			// which would step the row back.
			if (!feed.conversations.some((each) => each.id === id)) {
				feed.put(state);
			}
			drafts.started(draft);
			rememberAuto(auto);
			// Its message shows in the thread as it opens, sending until the
			// server has it.
			const sending =
				text !== "" || files.length > 0
					? feed.send(id, prompt, files, text, spoken)
					: null;
			void slide(() => onOpen(id, "replace"));
			const answered = await promptConversation(
				id,
				prompt,
				files,
				spoken,
				sending?.id,
			).catch((error: unknown) => {
				// What was not sent stays in its thread, to send again or edit there.
				if (sending !== null) {
					feed.refused(id, sending, error);
				} else {
					refuseIn(id, "Not sent", error);
				}
				return null;
			});
			if (sending !== null && answered !== null) {
				feed.answered(id, sending, answered);
			}
		},
	});
	const draft = newDraft(shownProject(), task, identity);
	const address = withDraft(
		auto ? autoAddress(task) : newAddress(agent, task, model),
		identity,
	);
	// So its row in the sidebar opens it again with this agent and model.
	useEffect(() => drafts.place(draft, address), [drafts, draft, address]);
	useDraft(runtime, drafts, draft);
	dictated.current = useDictated(runtime);
	const { adapter: mentions, paths } = useFileMentions(task);
	const projects = useProjects();
	const references = useReferences(tasks, [], projects ?? undefined);
	const trees = useContext(TreesContext);
	// As the page heads itself, which keeps the name for this tab.
	const projectName = useProjectName(undefined);
	const root = trees?.root ?? null;
	const named = useNamed(
		paths,
		projects,
		task === null
			? root
			: (tasks.find((each) => each.task === task)?.worktree ?? null),
	);
	// On Auto pick the agent is yet to be picked: only its switch shows, off
	// for the agent it stands in with.
	const controls = auto ? (
		<SettingControls
			settings={[]}
			current={(setting) => setting.current}
			onChange={() => {}}
			autoPick={{
				on: true,
				chooses:
					"Chooses the agent, model and effort from your first message. Off, it starts on the agent you pick.",
				// Off, New starts on the agent Auto pick stood in with.
				switch: (on) => {
					if (!on) {
						onOpen(newAddress(agent, task), "replace");
					}
				},
			}}
		/>
	) : offered.length > 0 ? (
		<span aria-busy={keeping > 0} className="contents">
			<SettingControls
				agent={agent}
				settings={offered}
				current={current}
				autoPick={model === null ? autoPick : undefined}
				onChange={(setting, value) => {
					const before = current(setting);
					setPicks((picks) => ({ ...picks, [setting.id]: value }));
					setKeeping((keeping) => keeping + 1);
					// Kept as the agent's default now, whether or not this one starts;
					// put back when the server refuses it.
					void chooseDefault(agent, setting.id, value)
						.catch((error: unknown) => {
							setPicks((picks) => ({ ...picks, [setting.id]: before }));
							refuseIn(draft, `${setting.name} not kept`, error);
						})
						.finally(() => setKeeping((keeping) => keeping - 1));
				}}
			/>
		</span>
	) : (
		<span className="px-1.5 text-[11px] text-muted-foreground">
			Settings appear once {agentName(agents, agent)} starts
		</span>
	);
	// Picked, the page shows that project's own screen to start one, what was
	// typed carried there; its trees are its own, so none of this one's task.
	const project = (
		<ProjectSwitcher
			name={projectName}
			keyed={false}
			scope
			path={false}
			servers={false}
			className="mx-0"
			hash={`#conversations/${withDraft(auto ? `${NEW}/${AUTO}` : `${NEW}/${agent}`, identity)}`}
			onPick={(each) => drafts.move(draft, newDraft(each.slug, null, identity))}
		/>
	);
	return {
		runtime,
		refusal: refusals.get(draft) ?? null,
		project,
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
 * composer, the agent picked in its bar, as on a phone, or a terminal, and under the greeting the tasks no agent is left on,
 * to pick back up.
 */
export function Home({
	terminals,
	...starting
}: Starting & { terminals: Terminals }): JSX.Element {
	const { tasks, agents, agent, auto, task, conversations, onOpen } = starting;
	const section = useRef<HTMLElement>(null);
	const touch = useTouch();
	useEffect(() => {
		if (!touch && section.current !== null) {
			composerIn(section.current)?.focus();
		}
	}, [touch]);
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
	// Only tasks no agent is left on: a conversation, or a task an agent is
	// on, is in the sidebar already, to open from there.
	const orphans = tasks
		.filter((each) => orphaned(each, conversations) !== null)
		.slice(0, RECENT);

	return (
		<section
			ref={section}
			aria-label="new conversation"
			className={cn(BELOW_BAR, "flex min-h-0 min-w-0 flex-col gap-3")}
		>
			<TopBar
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
						<ThreadView
							mentions={mentions}
							references={references}
							above={
								<>
									<Refusal refusal={refusal} className="px-2" />
									<ProjectLine>{project}</ProjectLine>
								</>
							}
							welcome={
								<div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 font-medium text-2xl tracking-tight duration-200">
									<span>Start a conversation with</span>
									{auto ? (
										<span className="flex items-center gap-2">
											<AutoIcon colored className="size-[1em]" />
											{AUTO_PICK_NAME}
										</span>
									) : (
										<AgentBrand agent={agent} name={agentName(agents, agent)} />
									)}
									{task !== null && (
										<span>
											in <span className="font-mono text-xl">{task}</span>
										</span>
									)}
								</div>
							}
							below={
								<>
									{!auto && (
										<PlanLimits
											limits={limitsOf(agents, conversations, agent)}
										/>
									)}
									{orphans.length > 0 && (
										<section
											aria-label="pick back up"
											className="mt-4 flex flex-col gap-1 px-2"
										>
											<h3 className="pl-3 font-medium text-muted-foreground text-xs">
												Pick back up
											</h3>
											<ul className="flex flex-col">
												{orphans.map((each) => (
													<li key={each.task}>
														<OrphanedTask task={each.task} />
													</li>
												))}
											</ul>
										</section>
									)}
								</>
							}
							controls={controls}
							starting={busy}
						/>
					</NamedContext>
				</Composing.Provider>
			</AssistantRuntimeProvider>
		</section>
	);
}

/** The project a new conversation starts in, as a line atop its composer. */
export function ProjectLine({
	children,
}: {
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="-mb-2 flex min-h-9 min-w-0 items-center px-2">
			{children}
		</div>
	);
}

/** A task no agent is left on, to pick back up from its dialog. */
function OrphanedTask({ task }: { task: string }): JSX.Element {
	const board = useContext(Board);
	return (
		<button
			type="button"
			onClick={() => board.openTask(task)}
			className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05]"
		>
			<Orphaned />
			<span className="min-w-0 flex-1 truncate font-mono text-sm">{task}</span>
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

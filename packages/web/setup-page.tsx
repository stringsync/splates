import type { TaskRecord } from "@splates/server/board";
import {
	configChangeReference,
	MERGE,
	setupReference,
} from "@splates/server/plans/browser";
import type { AreaProgress, StepProgress } from "@splates/server/setup";
import { useReactive } from "core/react";
import {
	Fragment,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { RulesEditor } from "./auto-pick-rules";
import {
	agentFor,
	autoModelChosen,
	NEW,
	startsAuto,
} from "./conversation-address";
import {
	promptConversation,
	startAutoPick,
	startConversation,
} from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { ReadFailed, StillWaiting } from "./countdown";
import { Markdown } from "./markdown";
import type { Move, SetupOpen } from "./page-address";
import { RouteTrail } from "./route-trail";
import {
	autoPickBrowserSteps,
	RulesEditorContext,
} from "./setup-auto-pick-steps";
import { type ConfigChanges, ConfigChangesContext } from "./setup-config-field";
import { JourneyDone, SetupIndex, StepField, StepForm } from "./setup-form";
import { numbered, StepInstructions } from "./setup-instructions";
import { DONE, SetupJourney } from "./setup-journey";
import { SetupContext } from "./setup-state";
import { JOURNEY_ENDS, STEP_BODIES, STEP_STOPS } from "./setup-steps";
import { UndoDialog } from "./setup-undo";
import { TopBar } from "./top-bar";

/** Intentional setup: choose an area, then answer its steps a page at a time. */
export function SetupPage({
	feed,
	onOpen,
	todos,
	open,
	onSetup,
	onWelcome,
}: {
	/** Where a conversation starts, or null while `splates server` holds none. */
	feed: ConversationFeed | null;
	/** Opens the conversation started on a step. */
	onOpen: (id: string) => void;
	/** The project's tasks, which Auto pick's try picks from. */
	todos: readonly TaskRecord[];
	/** The journey and step the address has Setup on. */
	open: SetupOpen;
	/** Sets Setup on a journey and step, or the index for a null journey. */
	onSetup: (area: string | null, step?: string | null, how?: Move) => void;
	/** Opens the Welcome page. */
	onWelcome: () => void;
}): JSX.Element {
	const { progress, error, refresh, held } = useContext(SetupContext);
	const selected = open.area;
	const [undoing, setUndoing] = useState<string | null>(null);
	const area = progress?.areas.find((area) => area.id === selected);
	return (
		<section aria-label="setup" className="flex min-w-0 flex-col gap-8">
			<TopBar
				title={
					area ? (
						<RouteTrail
							items={[
								{ label: "Setup", onClick: () => onSetup(null) },
								{ label: area.title },
							]}
						/>
					) : (
						"Setup"
					)
				}
			/>
			{!area && (
				<p className="text-muted-foreground text-sm">
					<button type="button" className="underline" onClick={onWelcome}>
						Back to the welcome page
					</button>
				</p>
			)}
			{progress === null &&
				(error === null ? (
					<SetupLoading />
				) : (
					<ReadFailed
						error={`Couldn't read your setup: ${error}`}
						onRetry={refresh}
					/>
				))}
			{progress !== null &&
				(area ? (
					<Journey
						key={area.id}
						area={area}
						stepId={open.step}
						onStep={(step) => onSetup(area.id, step, "replace")}
						feed={feed}
						todos={todos}
						onOpen={onOpen}
						onLeave={() => {
							held.drop(area.id);
							onSetup(null);
						}}
						onUndo={() => setUndoing(area.id)}
					/>
				) : (
					<SetupIndex
						areas={progress.areas}
						onSelect={(id) => onSetup(id)}
						onUndo={setUndoing}
					/>
				))}
			<UndoDialog
				area={undoing}
				onClose={(undone) => {
					setUndoing(null);
					if (undone && undoing !== null) {
						held.drop(undoing);
						onSetup(null);
					}
				}}
			/>
		</section>
	);
}

/**
 * Shown while setup is read, which takes a few seconds the first time: the
 * index's grouped rows, each a title, a progress line and a chevron.
 */
function SetupLoading(): JSX.Element {
	return (
		<div role="status" className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<p className="text-muted-foreground text-sm">Reading your setup…</p>
				<StillWaiting />
			</div>
			<div aria-hidden className="flex flex-col gap-6">
				{[3, 2].map((rows) => (
					<ul
						key={rows}
						className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
					>
						{Array.from({ length: rows }, (_, index) => (
							<li
								// biome-ignore lint/suspicious/noArrayIndexKey: fixed, never reordered
								key={index}
								className="flex min-h-16 items-center gap-3 px-4"
							>
								<span className="flex flex-1 flex-col gap-2">
									<Skeleton className="h-4 w-40" />
									<Skeleton className="h-3 w-24" />
								</span>
								<Skeleton className="size-4 rounded-full" />
							</li>
						))}
					</ul>
				))}
			</div>
		</div>
	);
}

/** One area as a form, a page at a time, as `SetupJourney` walks it. */
function Journey({
	area,
	stepId,
	onStep,
	feed,
	todos,
	onOpen,
	onLeave,
	onUndo,
}: {
	area: AreaProgress;
	/** The step the address names, or null for none. */
	stepId: string | null;
	/** Puts the step shown in the address. */
	onStep: (step: string) => void;
	feed: ConversationFeed | null;
	todos: readonly TaskRecord[];
	onOpen: (id: string) => void;
	onLeave: () => void;
	onUndo: () => void;
}): JSX.Element {
	const { settle, held } = useContext(SetupContext);
	// Held beyond this page, so a step left running goes on and the journey
	// is found where it was left.
	const { journey, rules } = held.obtain(area.id, () => {
		const rules = new RulesEditor();
		const journey = new SetupJourney(
			area,
			{
				...autoPickBrowserSteps(rules),
			},
			STEP_STOPS,
		);
		return { journey, rules };
	});
	const { step, at, next } = useReactive(
		journey,
		(journey) => ({ step: journey.step, at: journey.at, next: journey.next }),
		["changed"],
	);
	useEffect(() => journey.events.on("settled", settle), [journey, settle]);
	// The address and the journey follow each other: a step the address
	// names (back, forward, a link) is gone to, else the step shown is put
	// in the address.
	const shown = step?.id ?? DONE;
	const named = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (stepId !== named.current) {
			named.current = stepId;
			if (stepId !== null && stepId !== shown) {
				journey.goTo(stepId);
				return;
			}
		}
		if (stepId !== shown) {
			onStep(shown);
		}
	}, [stepId, shown, journey, onStep]);
	const working = next.kind === "working";
	// Closing or reloading the tab mid-run asks first: a long step is easy
	// to lose track of, and the browser words the prompt.
	useEffect(() => {
		if (!working) {
			return;
		}
		const ask = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", ask);
		return () => window.removeEventListener("beforeunload", ask);
	}, [working]);
	if (step === undefined) {
		const End = JOURNEY_ENDS[area.id];
		return (
			<JourneyDone title={area.title} onLeave={onLeave} onUndo={onUndo}>
				{End !== undefined && (
					<End feed={feed} onOpen={onOpen} onLeave={onLeave} />
				)}
			</JourneyDone>
		);
	}
	// Starts a conversation that says `text`, as ⌥⌘N would: Auto pick judging
	// the words when the last conversation started on it, else the agent New
	// offers. Answers its id once it is up, its message shown on its way, and
	// kept in the thread, unsent, should the server refuse it.
	const begin =
		feed === null
			? null
			: async (text: string): Promise<string> => {
					const state = await (startsAuto(NEW)
						? startAutoPick({ words: text, task: null })
						: startConversation(
								agentFor(NEW, feed.agents, feed.conversations),
								null,
								{ autoPick: autoModelChosen() },
							));
					feed.put(state);
					const sending = feed.send(state.id, text);
					void promptConversation(state.id, text, [], false, sending.id)
						.then((answered) => feed.answered(state.id, sending, answered))
						.catch((error: unknown) => feed.refused(state.id, sending, error));
					return state.id;
				};
	const onAgent =
		begin === null
			? null
			: () => {
					begin(setupReference(step.id)).then(onOpen, (error: Error) =>
						journey.failed(error.message),
					);
				};
	const configChanges: ConfigChanges | null =
		begin === null || feed === null
			? null
			: {
					start: (field) =>
						begin(configChangeReference(field.task, field.change)),
					merge: async (conversation) => {
						await promptConversation(conversation, MERGE);
					},
					open: onOpen,
				};
	const Body = STEP_BODIES[step.id];
	return (
		<RulesEditorContext value={rules}>
			<ConfigChangesContext value={configChanges}>
				<StepForm
					key={step.id}
					title={step.title}
					why={<Markdown text={step.why} inline />}
					detail={
						step.detail === null ? undefined : (
							<Markdown text={step.detail} inline />
						)
					}
					found={
						step.found === null ? undefined : (
							<Markdown text={step.found} inline />
						)
					}
					waiting={waitingOn(step, journey.steps, (index) =>
						journey.goToIndex(index),
					)}
					warning={
						step.warning === null ? undefined : (
							<Markdown text={step.warning} inline />
						)
					}
					at={at + 1}
					of={journey.steps.length}
					steps={journey.steps}
					onGo={(index) => journey.goToIndex(index)}
					next={next}
					// Read before the fields lock, since a disabled field sends nothing.
					onNext={(form) => void journey.press(new FormData(form))}
					onAgent={onAgent}
					undo={area.undoable ? area.title : null}
					onUndo={onUndo}
				>
					{Body !== undefined ? (
						<Body
							step={step}
							feed={feed}
							onOpen={onOpen}
							journey={journey}
							todos={todos}
						/>
					) : numbered(step.user) ? (
						<StepInstructions
							text={step.user}
							under={{
								1: step.fields.map((field) => (
									<StepField key={field.name} field={field} />
								)),
							}}
						/>
					) : step.fields.length > 0 ? (
						step.fields.map((field) => (
							<StepField key={field.name} field={field} />
						))
					) : (
						<Markdown text={step.user} />
					)}
				</StepForm>
			</ConfigChangesContext>
		</RulesEditorContext>
	);
}

/** The steps a waiting step waits on, each a link to its page; none when it waits on nothing. */
function waitingOn(
	step: StepProgress,
	steps: readonly StepProgress[],
	onGo: (index: number) => void,
): ReactNode {
	if (step.status !== "waiting") {
		return undefined;
	}
	const open = steps.flatMap((each, index) =>
		step.after.includes(each.id) && each.status !== "done"
			? [{ each, index }]
			: [],
	);
	if (open.length === 0) {
		return undefined;
	}
	return (
		<>
			Waits on{" "}
			{open.map(({ each, index }, at) => (
				<Fragment key={each.id}>
					{at > 0 && ", "}
					<button
						type="button"
						className="cursor-pointer underline"
						onClick={() => onGo(index)}
					>
						{each.title}
					</button>
				</Fragment>
			))}
			.
		</>
	);
}

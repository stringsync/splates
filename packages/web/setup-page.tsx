import type { TaskRecord } from "@stringsync/splates-server/board";
import { setupReference } from "@stringsync/splates-server/plans/browser";
import type { AreaProgress } from "@stringsync/splates-server/setup";
import { useReactive } from "@webappwiz/react";
import { Loader2Icon } from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
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
import { Markdown } from "./markdown";
import {
	autoPickBrowserSteps,
	RulesEditorContext,
} from "./setup-auto-pick-steps";
import {
	coordinatorBrowserSteps,
	MoveWatch,
	MoveWatchContext,
} from "./setup-coordinator-steps";
import { JourneyDone, SetupIndex, StepField, StepForm } from "./setup-form";
import { numbered, StepInstructions } from "./setup-instructions";
import { SetupJourney } from "./setup-journey";
import { SetupContext } from "./setup-state";
import { JOURNEY_ENDS, STEP_BODIES, STEP_STOPS } from "./setup-steps";
import { UndoDialog } from "./setup-undo";
import { TopBar } from "./top-bar";

/** Intentional setup: choose an area, then answer its steps a page at a time. */
export function SetupPage({
	feed,
	onOpen,
	todos,
}: {
	/** Where a conversation starts, or null while `splates server` holds none. */
	feed: ConversationFeed | null;
	/** Opens the conversation started on a step. */
	onOpen: (id: string) => void;
	/** The project's tasks, which Auto pick's try picks from. */
	todos: readonly TaskRecord[];
}): JSX.Element {
	const { progress } = useContext(SetupContext);
	const [selected, setSelected] = useState<string | null>(null);
	const [undoing, setUndoing] = useState<string | null>(null);
	const area = progress?.areas.find((area) => area.id === selected);
	return (
		<section aria-label="setup" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Setup" />
			{progress === null && <SetupLoading />}
			{progress !== null &&
				(area ? (
					<Journey
						key={area.id}
						area={area}
						feed={feed}
						todos={todos}
						onOpen={onOpen}
						onLeave={() => setSelected(null)}
						onUndo={() => setUndoing(area.id)}
					/>
				) : (
					<SetupIndex
						areas={progress.areas}
						onSelect={setSelected}
						onUndo={setUndoing}
					/>
				))}
			<UndoDialog
				area={undoing}
				onClose={(undone) => {
					setUndoing(null);
					if (undone) {
						setSelected(null);
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
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2Icon className="size-4 animate-spin" aria-hidden /> Reading your
				setup…
			</p>
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
									<Skeleton className="h-4 w-40 motion-reduce:animate-none" />
									<Skeleton className="h-3 w-24 motion-reduce:animate-none" />
								</span>
								<Skeleton className="size-4 rounded-full motion-reduce:animate-none" />
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
	feed,
	todos,
	onOpen,
	onLeave,
	onUndo,
}: {
	area: AreaProgress;
	feed: ConversationFeed | null;
	todos: readonly TaskRecord[];
	onOpen: (id: string) => void;
	onLeave: () => void;
	onUndo: () => void;
}): JSX.Element {
	const { settle } = useContext(SetupContext);
	const [move] = useState(() => new MoveWatch());
	const [rules] = useState(() => new RulesEditor());
	const [journey] = useState(
		() =>
			new SetupJourney(
				area,
				{
					...coordinatorBrowserSteps(move),
					...autoPickBrowserSteps(rules),
				},
				STEP_STOPS,
			),
	);
	const { step, at, next } = useReactive(
		journey,
		(journey) => ({ step: journey.step, at: journey.at, next: journey.next }),
		["changed"],
	);
	useEffect(() => journey.events.on("settled", settle), [journey, settle]);
	useEffect(() => () => move.stop(), [move]);
	const working = next.kind === "working";
	// Closing or reloading the tab mid-run asks first: a long step such as
	// `pulumi up` is easy to lose track of, and the browser words the prompt.
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
	const onAgent =
		feed === null
			? null
			: () => {
					// Where ⌥⌘N would start: Auto pick judging the words when the last
					// conversation started on it, else the agent New offers.
					const text = setupReference(step.id);
					(startsAuto(NEW)
						? startAutoPick({ words: text, task: null })
						: startConversation(
								agentFor(NEW, feed.agents, feed.conversations),
								null,
								{ autoPick: autoModelChosen() },
							)
					)
						.then(async (state) => {
							// Open once it is up, its message shown on its way, and
							// kept in the thread, unsent, should the server refuse it.
							feed.put(state);
							const sending = feed.send(state.id, text);
							onOpen(state.id);
							await promptConversation(state.id, text, [], false, sending.id)
								.then((answered) => feed.answered(state.id, sending, answered))
								.catch((error: unknown) =>
									feed.refused(state.id, sending, error),
								);
						})
						.catch((error: Error) => journey.failed(error.message));
				};
	const Body = STEP_BODIES[step.id];
	return (
		<MoveWatchContext value={move}>
			<RulesEditorContext value={rules}>
				<StepForm
					key={step.id}
					title={step.title}
					why={<Markdown text={step.why} inline />}
					detail={
						step.detail === null ? undefined : (
							<Markdown text={step.detail} inline />
						)
					}
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
					onLeave={onLeave}
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
			</RulesEditorContext>
		</MoveWatchContext>
	);
}

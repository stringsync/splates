import type { TaskRecord } from "@splates/server/board";
import type { StepProgress } from "@splates/server/setup";
import type { JSX } from "react";
import type { ConversationFeed } from "./conversation-feed";
import { AUTO_PICK_STEPS, AUTO_PICK_STOPS } from "./setup-auto-pick-steps";
import type { SetupJourney } from "./setup-journey";
import { NATIVE_STEPS } from "./setup-native-steps";

/** What a step's own page body is handed. */
// vet-ignore objects-over-callbacks: props handed to a React component, which are how React passes events
export interface StepBodyProps {
	step: StepProgress;
	/** Where a conversation starts, or null while `splates server` holds none. */
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
	/** The journey the step is on, as to go back to an earlier step. */
	journey: SetupJourney;
	/** The project's tasks, as for a step that tries something on one. */
	todos: readonly TaskRecord[];
}

/** Pages of a journey drawn by its own controls, by step id. */
export type StepBodies = Record<string, (props: StepBodyProps) => JSX.Element>;

/**
 * The steps whose page is more than the fields their shape asks, each
 * journey's from a file of its own. A step not here is drawn from its
 * `fields` alone, or its `user` line when it has none.
 */
export const STEP_BODIES: StepBodies = {
	...NATIVE_STEPS,
	...AUTO_PICK_STEPS,
};

/**
 * The steps a walk through a journey stops on even when done, as an editor
 * of what is set up, each journey's from a file of its own.
 */
export const STEP_STOPS: ReadonlySet<string> = new Set(AUTO_PICK_STOPS);

// vet-ignore objects-over-callbacks: props handed to a React component, which are how React passes events
/** What a journey's done page is handed. */
export interface JourneyEndProps {
	/** Where a conversation starts, or null while `splates server` holds none. */
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
	/** Back to the setup index, as once the journey is undone. */
	onLeave: () => void;
}

/** What a journey's done page offers beside "Back to setup", by area id. */
export type JourneyEnds = Record<
	string,
	(props: JourneyEndProps) => JSX.Element
>;

/**
 * The journeys whose done page offers what to do next, as "Start a
 * conversation", each journey's from a file of its own.
 */
export const JOURNEY_ENDS: JourneyEnds = {};

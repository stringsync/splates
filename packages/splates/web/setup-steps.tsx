import type { JSX } from "react";
import type { StepProgress } from "../setup";
import type { ConversationFeed } from "./conversation-feed";
import type { SetupJourney } from "./setup-journey";
import { OPENCODE_STEPS } from "./setup-opencode-steps";

/** What a step's own page body is handed. */
export interface StepBodyProps {
	step: StepProgress;
	/** Where a conversation starts, or null while `splates server` holds none. */
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
	/** The journey the step is on, as to go back to an earlier step. */
	journey: SetupJourney;
}

/** Pages of a journey drawn by its own controls, by step id. */
export type StepBodies = Record<string, (props: StepBodyProps) => JSX.Element>;

/**
 * The steps whose page is more than the fields their shape asks, each
 * journey's from a file of its own. A step not here is drawn from its
 * `fields` alone, or its `user` line when it has none.
 */
export const STEP_BODIES: StepBodies = { ...OPENCODE_STEPS };

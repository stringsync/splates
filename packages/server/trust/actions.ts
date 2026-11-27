// The one list of what each trust band allows and what each decision weighs.
// The server's gates read it, and the Trust page renders it, so the key the
// user reads is the rule the server applies.
import { ASSUME_AT, WAIT_BELOW } from "./band";
import type { DecisionOutcome, DecisionSource, TrustBand } from "./types";

/** An action trust gates, or a rule that holds at any trust. */
export type TrustActionId =
	| "merge-after-approval"
	| "ask-then-wait"
	| "merge-without-approval"
	| "ask-then-go"
	| "everything-ask-and-go-allows"
	| "assume-reversible"
	| "ask-overturned-kinds"
	| "only-user-ships"
	| "always-ask-risky";

/** Where an action applies: from a band up, or at any trust. */
export type TrustActionBand = TrustBand | "any";

export interface TrustAction {
	id: TrustActionId;
	/** The band the action belongs to; "any" holds at every trust. */
	band: TrustActionBand;
	/** What the action lets an agent do, or what it holds it to, as the Trust page shows it to the user. */
	label: string;
	/** True when the server refuses otherwise; false when only the skill asks it. */
	enforced: boolean;
}

/** The action named `id`. */
export function trustAction(id: TrustActionId): TrustAction {
	const found = TRUST_ACTIONS.find((each) => each.id === id);
	if (found === undefined) {
		throw new Error(`unknown trust action ${id}`);
	}
	return found;
}

/**
 * Whether an agent in `band` may take action `id`: true from the action's
 * band up, and always for an "any" action. Pass the band from `bandOf`, which
 * already reads the Allow trusted decisions toggle and the agent's scope.
 */
export function allows(band: TrustBand, id: TrustActionId): boolean {
	const action = trustAction(id);
	if (action.band === "any") {
		return true;
	}
	return TRUST_BANDS.indexOf(band) >= TRUST_BANDS.indexOf(action.band);
}

/** The lowest score (0–100) at which action `id` is allowed; 0 for an "any" action. */
export function floorOf(id: TrustActionId): number {
	const { band } = trustAction(id);
	return band === "any" ? 0 : BAND_FLOORS[band];
}

/** Bands from lowest to highest trust. */
export const TRUST_BANDS: readonly TrustBand[] = [
	"ask-and-wait",
	"ask-and-go",
	"assume",
];

/** The lowest score (0–100) of each band. */
export const BAND_FLOORS: Record<TrustBand, number> = {
	"ask-and-wait": 0,
	"ask-and-go": WAIT_BELOW,
	assume: ASSUME_AT,
};

/** What one decision adds to evidence for (alpha) and against (beta) trust. */
export interface DecisionWeight {
	alpha: number;
	beta: number;
}

/**
 * Every trust-gated action, in the order the Trust page shows them. Within a
 * band, an action holds from that band up; the bands below a threshold hold
 * the limits instead. Agents may always ask and wait instead of acting on
 * trust: these are ceilings, never floors.
 */
export const TRUST_ACTIONS: readonly TrustAction[] = [
	{
		id: "merge-after-approval",
		band: "ask-and-wait",
		label: "Merges only after you approve the plan",
		enforced: true,
	},
	{
		id: "ask-then-wait",
		band: "ask-and-wait",
		label: "Asks, then waits for your answer",
		enforced: false,
	},
	{
		id: "merge-without-approval",
		band: "ask-and-go",
		label: "Merges without waiting on the plan",
		enforced: true,
	},
	{
		id: "ask-then-go",
		band: "ask-and-go",
		label: "Asks, and carries on with its pick meanwhile",
		enforced: false,
	},
	{
		id: "everything-ask-and-go-allows",
		band: "assume",
		label: "Everything Ask & go allows",
		enforced: true,
	},
	{
		id: "assume-reversible",
		band: "assume",
		label:
			"Makes reversible calls itself, each shown as an Assumed line you can overturn",
		enforced: false,
	},
	{
		id: "ask-overturned-kinds",
		band: "assume",
		label: "Asks first on any kind of call overturned lately",
		enforced: false,
	},
	{
		id: "only-user-ships",
		band: "any",
		label: "Only you ship",
		enforced: true,
	},
	{
		id: "always-ask-risky",
		band: "any",
		label:
			"Always asks before spending money, deleting data or work, or changing security",
		enforced: false,
	},
];

/**
 * What each decision weighs, by where it came from and how the user met it.
 * Overturns of costly or unasked picks weigh more than kept picks.
 */
export const DECISION_WEIGHTS: Record<
	DecisionSource,
	Record<DecisionOutcome, DecisionWeight>
> = {
	question: {
		kept: { alpha: 1, beta: 0 },
		amended: { alpha: 0, beta: 0 },
		overturned: { alpha: 0, beta: 2 },
	},
	mockup: {
		kept: { alpha: 1, beta: 0 },
		amended: { alpha: 0, beta: 0 },
		overturned: { alpha: 0, beta: 2 },
	},
	plan: {
		kept: { alpha: 1, beta: 0 },
		amended: { alpha: 0, beta: 0 },
		overturned: { alpha: 0, beta: 2 },
	},
	unasked: {
		kept: { alpha: 1, beta: 0 },
		amended: { alpha: 0, beta: 0 },
		overturned: { alpha: 0, beta: 3 },
	},
	redo: {
		kept: { alpha: 1, beta: 0 },
		amended: { alpha: 0, beta: 0 },
		overturned: { alpha: 0, beta: 3 },
	},
	revert: {
		kept: { alpha: 1, beta: 0 },
		amended: { alpha: 0, beta: 0 },
		overturned: { alpha: 0, beta: 3 },
	},
};

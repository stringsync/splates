/** Canonical map key for a project × agent/model bucket. */
export function trustKey({ project, agent, model, scope }: TrustKey): string {
	const key = `${project}\0${agent}\0${model ?? ""}`;
	return scope === undefined ? key : `${key}\0${scope}`;
}

/** The kind of decision an agent made, used for trust breakdowns. */
export type DecisionKind =
	| "visual"
	| "design"
	| "defaults"
	| "scope"
	| "approval";

export const DECISION_KINDS: readonly DecisionKind[] = [
	"visual",
	"design",
	"defaults",
	"scope",
	"approval",
];

/** Where a recorded decision came from. */
export type DecisionSource =
	| "question"
	| "plan"
	| "mockup"
	| "unasked"
	| "redo"
	| "revert";

/** How the user met the agent's decision. */
export type DecisionOutcome = "kept" | "amended" | "overturned";

/** Identifies one project × agent/model trust bucket. */
export interface TrustKey {
	/** The project's main tree path (same key as Outcomes and Adherence). */
	project: string;
	/** The agent id (e.g. "claude", "codex", "antigravity"). */
	agent: string;
	/** The model display name (e.g. "Opus 4.6"), or null when unknown. */
	model: string | null;
	/** The declared directory prefix, absent for the project default. */
	scope?: string;
}

/** One recorded agent decision and its outcome, a line of `~/.splates/trust-decisions.jsonl`. */
export interface TrustDecision extends TrustKey {
	/** Deterministic deduplication key (e.g. conversation:msg:q, redo:task, revert:sha). */
	id: string;
	/** Present on reads when the user excluded this decision from trust. */
	undone?: boolean;
	/** ISO timestamp when the decision outcome was observed. */
	at: string;
	kind: DecisionKind;
	source: DecisionSource;
	outcome: DecisionOutcome;
	/** Short description of the question, plan, or task for auditability. */
	subject: string;
	/** What the agent picked, for a question it offered a `(chosen)` pick on; absent when unknown. */
	picked?: string;
	/** What the user answered instead, for an overturned pick; absent when unknown or kept. */
	instead?: string;
	/** Changed paths recorded with task penalties that have no live worktree. */
	files?: string[];
	/** For a later overturn, when the original assumption was made in its task. */
	taskAt?: string;
	conversation: string | null;
	task: string | null;
}

/** Whether a model's trust is computed from history or pinned by the user. */
export type TrustMode = "dynamic" | "static";

/** Stored per project × agent/model trust setting in `~/.splates/trust-settings.json`. */
export interface TrustSetting extends TrustKey {
	mode: TrustMode;
	/** Static trust value (0–100), used when `mode === "static"`. */
	value: number;
	/** Manually set dynamic starting value (0–100), applied from `dynamicAt` onward. */
	dynamicBase?: number | null;
	/** ISO timestamp when `dynamicBase` was set; earlier decisions do not pull the score away from it. */
	dynamicAt?: string | null;
	/** ISO timestamp of the last reset; decisions before this are ignored. */
	resetAt: string | null;
	/** ISO timestamp when this setting was last updated. */
	updatedAt: string;
}

/** Counts of recorded decision outcomes. */
export interface DecisionCounts {
	kept: number;
	amended: number;
	overturned: number;
	total: number;
}

/** Trust score and counts for one decision kind. */
export interface TrustKindBreakdown {
	kind: DecisionKind;
	score: number;
	counts: DecisionCounts;
}

/** Computed trust summary for one project × agent/model. */
export interface TrustEntry extends TrustKey {
	/** Effective trust (0–100): static value when static, dynamic score when dynamic. */
	score: number;
	/** Always-computed dynamic score (0–100) from decisions since `resetAt`. */
	dynamicScore: number;
	mode: TrustMode;
	/** Stored static value (0–100), or null if never set. */
	staticValue: number | null;
	resetAt: string | null;
	counts: DecisionCounts;
	kinds: TrustKindBreakdown[];
	/** ISO timestamp of the most recent decision or setting update, or null. */
	lastAt: string | null;
}

/** How an agent at a given trust treats a reversible call. */
export type TrustBand = "assume" | "ask-and-go" | "ask-and-wait";

/** One reversible call an agent made without asking, from a `🛡 Assumed:` line, a line of `~/.splates/trust-assumptions.jsonl`. */
export interface TrustAssumption extends TrustKey {
	/** `assumed:<conversation>:<number>`. */
	id: string;
	/** Its place among the conversation's assumptions, from 1, as `[SPLATES OVERTURN <n>]` names it. */
	number: number;
	/** ISO timestamp when it was first seen. */
	at: string;
	kind: DecisionKind;
	/** What the agent went with. */
	assumed: string;
	/** What it would have been otherwise. */
	alternative: string;
	conversation: string;
	task: string | null;
}

/** An assumption with what became of it. */
export interface AssumptionView extends TrustAssumption {
	/** When and to what the user overturned it, or null while it stands. */
	overturned: { at: string; instead: string } | null;
	/**
	 * Whether its conversation is still at work on it (not archived, and on
	 * its task still), so Overturn can tell the agent; false once finished,
	 * where only Mark wrong is left. Set by the server's route.
	 */
	open?: boolean;
}

/** What an agent should do with a reversible call, at its trust. */
export interface TrustPosture {
	entry: TrustEntry;
	band: TrustBand;
	/** Kinds an overturned assumption sent back to asking, whatever the band. */
	asking: DecisionKind[];
}

/** One overturned pick that led to a rule suggestion. */
export interface RuleCorrection {
	id: string;
	at: string;
	subject: string;
	picked?: string;
	instead?: string;
	agent: string;
	model: string | null;
	task: string | null;
	conversation: string | null;
}

/** A pending Backlog rule suggestion task paired with the corrections behind it. */
export interface RuleSuggestionView {
	/** The project's main tree path. */
	project: string;
	/** The project's slug, used to queue or dismiss the Backlog task. */
	slug: string;
	/** The Backlog task's id. */
	taskId: number;
	/** The Backlog task's subject (e.g. `Write down a rule for: …`). */
	subject: string;
	/** ISO timestamp when the Backlog task was created. */
	createdAt: string;
	/** The repeated corrections behind this suggestion, oldest first. */
	corrections: RuleCorrection[];
}

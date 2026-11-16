import type { Jev } from "./jev";
import type { Signal, SignalKind } from "./signals";
import type { Transcript } from "./timeline";

/** How much each signal says something is wrong, 0 to 1. */
export const SIGNAL_WEIGHTS: Record<SignalKind, number> = {
	mark: 1,
	highlight: 0.8,
	exception: 0.7,
	"rage-click": 0.7,
	"page-error": 0.6,
	"request-failed": 0.6,
	"console-error": 0.5,
	"log-error": 0.5,
	retry: 0.5,
	"dead-click": 0.4,
	"request-slow": 0.3,
};

/** How much each kind of remark is worth looking at, 0 to 1. */
export const REMARK_WEIGHTS: Record<string, number> = {
	bug: 1,
	"visual issue": 0.7,
	"confusing ux": 0.7,
	"design issue": 0.5,
	idea: 0.3,
	question: 0.3,
	"narration only": 0,
};

/** The speech score: how much of it is the problem, the kind of remark and the importance. */
export const SPEECH_WEIGHTS = { problem: 0.5, remark: 0.3, importance: 0.2 };
/** With `about`, the share of the final score that is relevance to it. */
export const ABOUT_WEIGHT = 0.7;

export const IMPORTANCE = [
	"Narrates calmly, nothing is wrong",
	"Mentions something off in passing",
	"Clearly bothered by it",
	"Insists it is badly broken or blocks them",
];

export interface MomentEvent {
	at: number;
	type: string;
	component?: string;
	selector?: string;
	text?: string;
	still?: string;
	label?: string;
	elements?: { component?: string; selector?: string; text?: string }[];
}

/** What Jev said of an utterance, as it came back. */
export interface Judgment {
	problem?: number;
	screen?: number;
	remark?: { choice: string; probabilities: Record<string, number> };
	importance?: number;
	/** Per signal asked about: its place among them, what it was, and how related Jev found it. */
	related?: { index: number; signal: string; noul: number }[];
}

export interface Moment {
	rank: number;
	start: number;
	end: number;
	score: number;
	/** The parts of the score, each 0 to 1. */
	parts: { code: number; speech?: number; about?: number };
	said?: string;
	pointed?: string;
	still?: string;
	signals: Signal[];
	judgment?: Judgment;
}

export interface MomentsInput {
	transcript: Transcript;
	signals: Signal[];
	events: MomentEvent[];
	jev?: Jev;
	about?: string;
}

export interface MomentsResult {
	moments: Moment[];
	/** Notes for the top of `moments.md`: why Jev was not used, or where it failed. */
	notes: string[];
}

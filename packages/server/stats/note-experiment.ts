import { Duration, SystemWallClock } from "webappwiz/time";
import { ROUTING } from "../notes";
import type { Event } from "../records";
import type { NoteSource } from "./note-events";
import type { Outcome } from "./outcomes";

/** A prospective comparison, independent of whether routing succeeded. */
export class NoteExperiment {
	constructor(
		private readonly sources: NoteSource[],
		private readonly outcomes: Outcome[],
		private readonly now = new SystemWallClock().now(),
	) {}

	read(): ExperimentReport {
		const enrolled: Enrollment[] = [];
		for (const source of this.sources) {
			const byConversation = new Map<string, Event[]>();
			for (const event of source.events) {
				if (event.conversation === null || event.reason !== null) {
					continue;
				}
				const own = byConversation.get(event.conversation) ?? [];
				own.push(event);
				byConversation.set(event.conversation, own);
			}
			const seen = new Set<string>();
			for (const event of source.events) {
				if (
					event.action !== "notes assigned" ||
					event.reason !== null ||
					event.conversation === null ||
					event.version !== ROUTING.experiment.version ||
					seen.has(event.conversation)
				) {
					continue;
				}
				seen.add(event.conversation);
				const until = Date.parse(event.assignedAt) + FOLLOW_UP.ms;
				const events = (byConversation.get(event.conversation) ?? []).filter(
					(each) =>
						each.reason === null &&
						each.conversation === event.conversation &&
						each.at >= event.assignedAt &&
						Date.parse(each.at) <= Math.min(this.now, until),
				);
				const own = this.outcomes.filter(
					(each) =>
						each.project === source.project &&
						each.conversation === event.conversation &&
						!each.base.startsWith("task/") &&
						each.endedAt >= event.assignedAt,
				);
				// Tasks already running at enrollment cannot be credited to the treatment.
				const clean = own.filter((each) => each.startedAt >= event.assignedAt);
				const task =
					events.some((each) => each.action === "add" && each.task !== null) ||
					clean.some((each) => Date.parse(each.startedAt) <= until);
				const judgments = events.filter(
					(each) => each.action === "notes attached",
				);
				// The enrollment prompt describes behavior before treatment, not an effect of it.
				const followups = judgments.filter((each) => each.afterReply !== false);
				const failures = events.filter(
					(each) => each.action === "notes routing failed",
				).length;
				enrolled.push({
					at: event.assignedAt,
					holdout: event.holdout,
					task,
					mature: this.now >= until,
					corrected: followups.some(
						(each) => each.corrects !== undefined && each.corrects >= 0.5,
					),
					missing:
						failures > 0 ||
						judgments.length === 0 ||
						followups.some((each) => each.corrects === undefined),
					failures,
					judgments: judgments.length,
					spend: events.reduce(
						(sum, each) =>
							sum +
							(each.action === "notes attached" ||
							each.action === "note applied"
								? (each.dollars ?? 0)
								: 0),
						0,
					),
					latencies: judgments.flatMap((each) =>
						each.ms === undefined ? [] : [each.ms],
					),
					reads: events.filter(
						(each) => each.action === "note read" && !each.subagent,
					).length,
					applied: events.filter(
						(each) =>
							each.action === "note applied" && (each.probability ?? 0) >= 0.5,
					).length,
					inProgress: own.length - clean.length,
					outcomes: clean.filter(
						(each) => Date.parse(each.endedAt) <= Math.min(this.now, until),
					),
				});
			}
		}
		enrolled.sort((one, other) => one.at.localeCompare(other.at));
		const pointed = this.arm(enrolled.filter((each) => !each.holdout));
		const holdout = this.arm(enrolled.filter((each) => each.holdout));
		const bounds = difference(pointed, holdout);
		const ready = pointed.mature === TARGET && holdout.mature === TARGET;
		return {
			version: ROUTING.experiment.version,
			followUpDays: 7,
			targetPerArm: TARGET,
			worthwhile: BENEFIT,
			pointed,
			holdout,
			difference: bounds,
			decision:
				!ready || bounds === null
					? "collecting"
					: bounds[1] < -BENEFIT
						? "worthwhile"
						: bounds[0] > -BENEFIT
							? "not worthwhile"
							: "inconclusive",
			models: this.models(enrolled),
		};
	}

	private arm(all: Enrollment[]): ExperimentArm {
		const tasks = all.filter((each) => each.task);
		// A fixed cohort avoids repeatedly stopping whenever a favorable estimate appears.
		const cohort = all.slice(0, TARGET);
		const mature = cohort.filter((each) => each.mature);
		const ended = all.flatMap((each) => each.outcomes);
		const merged = ended.filter((each) => each.ended === "merged");
		const used = merged.filter((each) => each.usage !== undefined);
		const turned = merged.filter((each) => each.turns !== undefined);
		const latencies = all
			.flatMap((each) => each.latencies)
			.sort((one, other) => one - other);
		return {
			assigned: all.length,
			tasks: tasks.length,
			mature: mature.length,
			pending: cohort.length - mature.length,
			corrected: mature.filter((each) => each.corrected).length,
			missing: mature.filter((each) => each.missing && !each.corrected).length,
			judgments: all.reduce((sum, each) => sum + each.judgments, 0),
			spend: all.reduce((sum, each) => sum + each.spend, 0),
			p95:
				latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null,
			failures: all.reduce((sum, each) => sum + each.failures, 0),
			reads: all.reduce((sum, each) => sum + each.reads, 0),
			applied: all.reduce((sum, each) => sum + each.applied, 0),
			inProgress: all.reduce((sum, each) => sum + each.inProgress, 0),
			merged: merged.length,
			removed: ended.length - merged.length,
			firstTry: merged.filter((each) => each.failedMerges === 0).length,
			used: used.length,
			tokens: used.reduce(
				(sum, each) =>
					sum + (each.usage?.input ?? 0) + (each.usage?.output ?? 0),
				0,
			),
			turned: turned.length,
			turns: turned.reduce((sum, each) => sum + (each.turns ?? 0), 0),
		};
	}

	private models(enrolled: Enrollment[]): ExperimentReport["models"] {
		const models = new Map<
			string,
			{ agent: string | null; model: string | null }
		>();
		for (const each of enrolled.flatMap((row) => row.outcomes)) {
			models.set(JSON.stringify([each.agent, each.model]), {
				agent: each.agent,
				model: each.model,
			});
		}
		return [...models.values()].map(({ agent, model }) => {
			const only = enrolled.map((each) => ({
				...each,
				outcomes: each.outcomes.filter(
					(outcome) => outcome.agent === agent && outcome.model === model,
				),
			}));
			return {
				agent,
				model,
				pointed: this.modelArm(only.filter((each) => !each.holdout)),
				holdout: this.modelArm(only.filter((each) => each.holdout)),
			};
		});
	}

	private modelArm(enrolled: Enrollment[]): ModelArm {
		const { merged, firstTry, used, tokens } = this.arm(enrolled);
		return { merged, firstTry, used, tokens };
	}
}

const FOLLOW_UP = Duration.days(7);
const TARGET = 400;
const BENEFIT = 0.05;

interface Enrollment {
	at: string;
	holdout: boolean;
	task: boolean;
	mature: boolean;
	corrected: boolean;
	missing: boolean;
	failures: number;
	judgments: number;
	spend: number;
	latencies: number[];
	reads: number;
	applied: number;
	inProgress: number;
	outcomes: Outcome[];
}

/** Counts over assigned conversations; primary counts are capped at the fixed cohort. */
export interface ExperimentArm {
	assigned: number;
	tasks: number;
	mature: number;
	pending: number;
	corrected: number;
	missing: number;
	judgments: number;
	spend: number;
	p95: number | null;
	failures: number;
	reads: number;
	applied: number;
	inProgress: number;
	merged: number;
	removed: number;
	firstTry: number;
	used: number;
	tokens: number;
	turned: number;
	turns: number;
}

/** Frozen phase and review rule, with older conversations excluded. */
export interface ExperimentReport {
	version: string;
	followUpDays: number;
	targetPerArm: number;
	worthwhile: number;
	pointed: ExperimentArm;
	holdout: ExperimentArm;
	/** Conservative 95% interval for pointed minus holdout correction incidence, allowing missing labels either value. */
	difference: [number, number] | null;
	decision: "collecting" | "worthwhile" | "not worthwhile" | "inconclusive";
	models: {
		agent: string | null;
		model: string | null;
		pointed: ModelArm;
		holdout: ModelArm;
	}[];
}

type ModelArm = Pick<ExperimentArm, "merged" | "firstTry" | "used" | "tokens">;

function difference(
	pointed: ExperimentArm,
	holdout: ExperimentArm,
): [number, number] | null {
	if (pointed.mature === 0 || holdout.mature === 0) {
		return null;
	}
	const pLow = wilson(pointed.corrected, pointed.mature)[0];
	const pHigh = wilson(pointed.corrected + pointed.missing, pointed.mature)[1];
	const hLow = wilson(holdout.corrected, holdout.mature)[0];
	const hHigh = wilson(holdout.corrected + holdout.missing, holdout.mature)[1];
	return [Math.max(-1, pLow - hHigh), Math.min(1, pHigh - hLow)];
}

function wilson(passed: number, total: number): [number, number] {
	// Bonferroni: two 97.5% marginal intervals give nominal 95% joint coverage.
	const critical = 2.241402727604947;
	const rate = passed / total;
	const denom = 1 + (critical * critical) / total;
	const center = (rate + (critical * critical) / (2 * total)) / denom;
	const radius =
		(critical *
			Math.sqrt(
				(rate * (1 - rate)) / total +
					(critical * critical) / (4 * total * total),
			)) /
		denom;
	return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

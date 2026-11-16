/**
 * Moments: where in a session an agent should look first. Code signals
 * (`signals.ts`) and Jev's judgments of what was said combine into one score
 * per moment, with every weight here in code; the raw answers stay in
 * `moments.jsonl`. Nothing here depends on a prompt, except `about`, which
 * re-ranks against one.
 */
import type { Answer, Jev, Question } from "./jev";
import {
	ABOUT_WEIGHT,
	IMPORTANCE,
	type Judgment,
	type Moment,
	type MomentEvent,
	type MomentsInput,
	type MomentsResult,
	REMARK_WEIGHTS,
	SIGNAL_WEIGHTS,
	SPEECH_WEIGHTS,
} from "./moment-types";
import { describeSignal } from "./signal-text";
import type { Signal } from "./signals";
import { target, type Utterance } from "./timeline";

/** How far before an utterance starts and after it ends a signal can still be about it. */
const BEFORE_MS = 3000;
const AFTER_MS = 5000;
/** Signals further apart than this are not one silent moment. */
const CLUSTER_MS = 5000;
/** The most signals asked about per utterance. */
const MAX_RELATED = 12;
/** A log line is listed under a moment when Jev puts at least this on it being related. */
const RELATED = 0.5;
/** Narration with no signal is kept only at or above this score. */
const KEEP = 0.2;

/** How much a set of signals says something is wrong, 0 to 1. */
export function codeScore(signals: Signal[]): number {
	const weights = signals
		.map((signal) => SIGNAL_WEIGHTS[signal.signal] ?? 0.3)
		.sort((left, right) => right - left);
	const [top = 0, ...rest] = weights;
	return Math.min(
		1,
		top + rest.reduce((sum, weight) => sum + weight * 0.25, 0),
	);
}

/** The speech score from Jev's answers about an utterance. */
export function speechScore(judgment: Judgment): number {
	const remark = judgment.remark
		? Object.entries(judgment.remark.probabilities).reduce(
				(sum, [name, probability]) =>
					sum + probability * (REMARK_WEIGHTS[name] ?? 0),
				0,
			)
		: 0;
	return (
		SPEECH_WEIGHTS.problem * (judgment.problem ?? 0) +
		SPEECH_WEIGHTS.remark * remark +
		SPEECH_WEIGHTS.importance * (judgment.importance ?? 0)
	);
}

/** The questions about one utterance and the signals near it, and the state they refer to. */
export function utteranceRequest(
	utterance: string,
	neighbours: { previous?: string; next?: string },
	pointed: string | undefined,
	signals: Signal[],
): { state: unknown; questions: Record<string, Question> } {
	const state = {
		utterance,
		previous: neighbours.previous,
		next: neighbours.next,
		"element under the pointer": pointed,
		events: signals.map(describeSignal),
	};
	const questions: Record<string, Question> = {
		problem: {
			type: "noul",
			instructions:
				"The speaker in `utterance` is reporting a problem with the software they are using.",
		},
		screen: {
			type: "noul",
			instructions:
				"The speaker in `utterance` is referring to something currently on the screen.",
		},
		remark: {
			type: "choice",
			instructions: "What kind of remark is `utterance`?",
			criteria: kindChoices,
		},
		importance: {
			type: "score",
			instructions:
				"How important the speaker seems to think what they say in `utterance` is.",
			criteria: IMPORTANCE,
		},
	};
	signals.forEach((_signal, index) => {
		questions[`related_${index}`] = {
			type: "noul",
			instructions: `\`events[${index}]\` is plausibly related to what the speaker says in \`utterance\` (or \`previous\` and \`next\`).`,
		};
	});
	return { state, questions };
}

/** Builds the unranked-by-prompt, ranked moments of a session. */
export async function buildMoments(
	input: MomentsInput,
): Promise<MomentsResult> {
	const { transcript, events } = input;
	const startedAt = transcript.startedAt;
	const wall = (seconds: number): number => startedAt + seconds * 1000;
	// An agent's remark is judged like a spoken line, at the moment it was made.
	const speech: Utterance[] = [
		...transcript.utterances,
		...events.flatMap((event): Utterance[] =>
			event.type === "mark" && event.label
				? [
						{
							start: (event.at - startedAt) / 1000,
							end: (event.at - startedAt) / 1000,
							text: event.label,
							words: [],
						},
					]
				: [],
		),
	].sort((left, right) => left.start - right.start);
	const notes: string[] = [];
	if (!input.jev) {
		notes.push(
			"Jev was not used (no TYPESAFE_API_KEY): moments are ranked by code signals alone, and speech without a signal beside it is not listed.",
		);
	}
	const signals = [...input.signals].sort((left, right) => left.at - right.at);
	const { owned, alone } = assign(
		signals,
		speech.map((utterance) => ({
			start: wall(utterance.start),
			end: wall(utterance.end),
		})),
	);
	const moments: Omit<Moment, "rank">[] = [];
	let failures = 0;
	await Promise.all(
		speech.map(async (utterance: Utterance, index) => {
			const start = wall(utterance.start);
			const end = wall(utterance.end);
			const mine = (owned[index] ?? [])
				.sort(
					(left, right) =>
						Math.abs(left.at - start) - Math.abs(right.at - start),
				)
				.slice(0, MAX_RELATED)
				.sort((left, right) => left.at - right.at);
			const where = pointedAt(events, start, end);
			let judgment: Judgment | undefined;
			if (input.jev) {
				const request = utteranceRequest(
					utterance.text,
					{ previous: speech[index - 1]?.text, next: speech[index + 1]?.text },
					where.pointed,
					mine,
				);
				try {
					judgment = judgmentFrom(
						await input.jev.ask(request.state, request.questions),
						mine,
					);
				} catch (error) {
					failures++;
					if (failures === 1) {
						notes.push(
							`Jev failed on some speech (${(error as Error).message}); that speech was judged by code signals alone.`,
						);
					}
				}
			}
			const kept = mine.filter((signal, at) => {
				const asked = judgment?.related?.find((item) => item.index === at);
				return !isLog(signal) || asked === undefined || asked.noul >= RELATED;
			});
			const code = codeScore(kept);
			const spoken = judgment ? speechScore(judgment) : undefined;
			const score = either(code, spoken ?? 0);
			if (kept.length === 0 && score < KEEP) {
				return;
			}
			moments.push({
				start: Math.min(start, kept[0]?.at ?? start),
				end: Math.max(end, kept.at(-1)?.at ?? end),
				score,
				parts: { code, speech: spoken },
				said: utterance.text,
				pointed: where.pointed,
				still:
					(kept
						.map((signal) => signal.detail.still)
						.find((still) => typeof still === "string") as
						| string
						| undefined) ?? where.still,
				signals: kept,
				judgment,
			});
		}),
	);
	let cluster: Signal[] = [];
	const close = (): void => {
		const first = cluster[0];
		const last = cluster.at(-1);
		if (first && last) {
			const where = pointedAt(events, first.at, last.at);
			const code = codeScore(cluster);
			moments.push({
				start: first.at,
				end: last.at,
				score: code,
				parts: { code },
				pointed: where.pointed,
				still:
					(cluster
						.map((signal) => signal.detail.still)
						.find((still) => typeof still === "string") as
						| string
						| undefined) ?? where.still,
				signals: cluster,
			});
		}
		cluster = [];
	};
	for (const signal of alone) {
		if (
			cluster.length > 0 &&
			signal.at - (cluster.at(-1)?.at ?? 0) > CLUSTER_MS
		) {
			close();
		}
		cluster.push(signal);
	}
	close();
	return { moments: rank(moments), notes };
}

/** Re-ranks moments against a prompt: one request per moment asking whether it is about it. */
export async function rankAbout(
	moments: Moment[],
	about: string,
	jev: Jev,
): Promise<Moment[]> {
	const scored = await Promise.all(
		moments.map(async (moment) => {
			const answers = await jev.ask(
				{
					request: about,
					moment: {
						said: moment.said,
						pointed: moment.pointed,
						events: moment.signals.map(describeSignal),
					},
				},
				{
					about: {
						type: "noul",
						instructions:
							"`moment` is relevant to what `request` asks about: it shows, mentions or helps explain it.",
					},
				},
			);
			const answer = answers.about;
			const relevance = answer?.type === "noul" ? answer.noul : 0;
			return {
				...moment,
				parts: { ...moment.parts, about: relevance },
				score: ABOUT_WEIGHT * relevance + (1 - ABOUT_WEIGHT) * moment.score,
			};
		}),
	);
	return rank(scored);
}

const isLog = (signal: Signal): boolean => signal.source !== "events";

/** The element the pointer was over around `[from, to]`: the latest one seen, and the first still of an event there. */
function pointedAt(
	events: MomentEvent[],
	from: number,
	to: number,
): { pointed?: string; still?: string } {
	let pointed: string | undefined;
	let still: string | undefined;
	for (const event of events) {
		if (event.at < from - 1000 || event.at > to) {
			continue;
		}
		if (event.still && !still) {
			still = event.still;
		}
		if (
			["move", "paused", "click"].includes(event.type) &&
			(event.component || event.selector || event.text)
		) {
			pointed = target(event);
		}
		if (event.type === "highlight" && event.elements?.[0]) {
			pointed = target(event.elements[0]);
		}
	}
	return { pointed, still };
}

/** Each signal goes to the utterance nearest it whose window holds it; the rest are alone. */
function assign(
	signals: Signal[],
	utterances: { start: number; end: number }[],
): { owned: Signal[][]; alone: Signal[] } {
	const owned: Signal[][] = utterances.map(() => []);
	const alone: Signal[] = [];
	for (const signal of signals) {
		let best = -1;
		let bestDistance = Number.POSITIVE_INFINITY;
		utterances.forEach((utterance, index) => {
			if (
				signal.at < utterance.start - BEFORE_MS ||
				signal.at > utterance.end + AFTER_MS
			) {
				return;
			}
			const distance = Math.max(
				utterance.start - signal.at,
				signal.at - utterance.end,
				0,
			);
			if (distance < bestDistance) {
				best = index;
				bestDistance = distance;
			}
		});
		if (best >= 0) {
			owned[best]?.push(signal);
		} else {
			alone.push(signal);
		}
	}
	return { owned, alone };
}

/** Two independent reasons to look: either is enough, both more so. */
const either = (left: number, right: number): number =>
	1 - (1 - left) * (1 - right);

function judgmentFrom(
	answers: Record<string, Answer>,
	signals: Signal[],
): Judgment {
	const noul = (id: string): number | undefined => {
		const answer = answers[id];
		return answer?.type === "noul" ? answer.noul : undefined;
	};
	const remark = answers.remark;
	const importance = answers.importance;
	return {
		problem: noul("problem"),
		screen: noul("screen"),
		remark:
			remark?.type === "choice"
				? { choice: remark.choice, probabilities: remark.probabilities }
				: undefined,
		importance:
			importance?.type === "score"
				? importance.score / (IMPORTANCE.length - 1)
				: undefined,
		related: signals.flatMap((signal, index) => {
			const value = noul(`related_${index}`);
			return value === undefined
				? []
				: [{ index, signal: describeSignal(signal), noul: value }];
		}),
	};
}

function rank(moments: Omit<Moment, "rank">[]): Moment[] {
	return [...moments]
		.sort((left, right) => right.score - left.score || left.start - right.start)
		.map((moment, index) => ({ ...moment, rank: index + 1 }));
}

const kindChoices: Record<string, string> = {
	bug: "Something does not work or errors",
	"visual issue": "Something looks wrong: layout, styling, rendering",
	"design issue": "The design is poor or inconsistent",
	"confusing ux":
		"It is unclear how to do something, or it behaves surprisingly",
	idea: "A suggestion for something new or better",
	question: "The speaker asks or wonders about something",
	"narration only": "Describing what they are doing, with no complaint",
};

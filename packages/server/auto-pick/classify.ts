import { aborts } from "webappwiz/abort";
import { Duration } from "webappwiz/time";
import {
	DIFFICULTIES,
	type DifficultyId,
	KINDS,
	type KindId,
	type TaskClass,
} from "./classes";
import { JUDGE_CREDS } from "./judge";
import type { Judge, Noul, Verdict } from "./system-one";

/**
 * What the judge said of a task: the probability, 0 to 1, that it is each
 * kind of work and each difficulty. A question left unanswered is a coin toss.
 */
export interface Classification {
	kinds: Record<KindId, number>;
	difficulty: Record<DifficultyId, number>;
}

/** A classification, or why there is none, in a short line the page can show. */
export type Classified =
	| { ok: true; classification: Classification }
	| { ok: false; reason: string };

/** What `classify` reads. */
export interface ClassifyInput {
	/** The task's subject line. */
	subject: string;
	/** The rest of the task: its body or a conversation's first prompt. */
	detail: string;
	/** The decision model; null when no cred for one is kept. */
	judge: Judge | null;
	/** How long the judge may take; 5 seconds when not given. */
	timeout?: Duration;
	/** Gives up on the judgment, and rejects with its reason, when it aborts. */
	signal?: AbortSignal;
}

/** How long `classify` waits on the judge. */
const DEFAULT_TIMEOUT = Duration.secs(5);

/**
 * The detail the judge reads, at most this long: the head says how big the
 * work is, and a provider cuts a long state short without saying.
 */
export const DETAIL_CHARS = 4000;

/**
 * Asks the judge every question about the task in one judgment. With no
 * judge, or one that fails or is slow, says why instead; rejects only when
 * `input.signal` aborts.
 */
export async function classify(input: ClassifyInput): Promise<Classified> {
	if (input.judge === null) {
		return {
			ok: false,
			reason: `no judge: keep ${JUDGE_CREDS.jev.join(", ")} for Jev, or ${JUDGE_CREDS.clef.join(" and ")} for Clef`,
		};
	}
	const timeout = input.timeout ?? DEFAULT_TIMEOUT;
	const signals = [AbortSignal.timeout(timeout.ms)];
	if (input.signal !== undefined) {
		signals.push(input.signal);
	}
	const signal = AbortSignal.any(signals);
	try {
		const verdict = await aborts.race(
			signal,
			input.judge.judge(
				{
					state: {
						subject: input.subject,
						detail: input.detail.slice(0, DETAIL_CHARS),
					},
					questions: {
						...questions("kind", KINDS),
						...questions("difficulty", DIFFICULTIES),
					},
				},
				{ signal },
			),
		);
		return {
			ok: true,
			classification: {
				kinds: answers(verdict, "kind", KINDS),
				difficulty: answers(verdict, "difficulty", DIFFICULTIES),
			},
		};
	} catch (error) {
		if (input.signal?.aborted) {
			throw input.signal.reason;
		}
		return {
			ok: false,
			reason: signal.aborted
				? `the judge took over ${timeout.ms / 1000}s`
				: `the judge failed (${error instanceof Error ? error.message : String(error)})`,
		};
	}
}

/** The questions a group asks, by `group:id`, so no two groups' ids meet. */
function questions<Id extends string>(
	group: string,
	classes: readonly TaskClass<Id>[],
): Record<string, Noul> {
	return Object.fromEntries(
		classes.map((each) => [`${group}:${each.id}`, each.noul]),
	);
}

/** A group's answers by class id, a coin toss for any left unanswered. */
function answers<Id extends string>(
	verdict: Verdict,
	group: string,
	classes: readonly TaskClass<Id>[],
): Record<Id, number> {
	return Object.fromEntries(
		classes.map((each) => [
			each.id,
			verdict.answers.get(`${group}:${each.id}`) ?? 0.5,
		]),
	) as Record<Id, number>;
}

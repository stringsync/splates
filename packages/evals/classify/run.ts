import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CONTRACT_FORMAT,
	type ContractBatch,
	type ContractDetail,
	type ContractResult,
	RESULTS_FILE,
} from "@evals/evals/contract";
import {
	type Classified,
	classify,
	type Judge,
	type Verdict,
} from "@splates/server/auto-pick";
import { Duration } from "core/time";
import {
	aboutOf,
	type ClassifySpec,
	expectations,
	met,
	probabilityOf,
	SUITE,
} from "./spec";

/** The target every classification cell names: the model Jev's calls ask for. */
export const JEV_TARGET = { model: "jev-latest", agent: "jev" } as const;

/** What the ledger says classification evals' Jev calls were for, so Billing shows them as `jev-latest evals`. */
export const PURPOSE = "evals";

/** How long a cell waits on the judge, longer than Auto pick's 5s: an eval would rather wait than error. */
const TIMEOUT = Duration.secs(30);

export interface ClassifyRunOptions {
	/** Where the batch directory is made. */
	directory: string;
	/** The judge each cell asks; null makes every cell an error saying why. */
	judge: Judge | null;
	/** Runs of each spec, 1 by default. */
	reps?: number;
	/** Told of each cell as it lands. */
	landed?: (line: string) => void;
}

/**
 * Asks the judge about each spec's request, `reps` times, into a new batch
 * directory in the `splates-evals/1` format, one check per class the spec
 * grades; returns the directory.
 */
export async function runClassify(
	specs: readonly ClassifySpec[],
	opts: ClassifyRunOptions,
): Promise<string> {
	await mkdir(opts.directory, { recursive: true });
	const dir = await mkdtemp(join(opts.directory, "batch-"));
	const reps = Math.max(1, opts.reps ?? 1);
	const cells = specs.flatMap((spec) =>
		Array.from({ length: reps }, (_, repetition) => ({ spec, repetition })),
	);
	const batch: ContractBatch = {
		format: CONTRACT_FORMAT,
		startedAt: new Date().toISOString(),
		title: SUITE,
		producer: "auto-pick",
		cells: cells.map(({ spec, repetition }, index) => ({
			id: cellId(index),
			case: spec.id,
			group: spec.groups.join(" > "),
			groups: spec.groups,
			sentence: spec.sentence,
			about: spec.sentence,
			target: { ...JEV_TARGET },
			repetition,
		})),
	};
	await writeFile(join(dir, "batch.json"), JSON.stringify(batch, null, "\t"));
	// One at a time: each call is a second or two and costs a fraction of a cent.
	for (const [index, { spec }] of cells.entries()) {
		const id = cellId(index);
		const { result, detail } = await runCell(spec, opts.judge);
		await writeFile(
			join(dir, `${id}.json`),
			JSON.stringify(detail, null, "\t"),
		);
		await writeFile(
			join(dir, RESULTS_FILE),
			`${JSON.stringify({ cell: id, ...result, detail: `${id}.json` })}\n`,
			{ flag: "a" },
		);
		opts.landed?.(`${result.status}\t${spec.id}\tjev`);
	}
	return dir;
}

/** One spec asked once: its result line, less the cell, and its detail file. */
export async function runCell(
	spec: ClassifySpec,
	judge: Judge | null,
): Promise<{
	result: Omit<ContractResult, "cell" | "detail">;
	detail: ContractDetail;
}> {
	const started = Date.now();
	const spent = judge === null ? null : priced(judge);
	const classified: Classified = await classify({
		...spec.request,
		judge: spent?.judge ?? null,
		timeout: TIMEOUT,
	});
	const milliseconds = Date.now() - started;
	const input = requestText(spec);
	const cost = {
		milliseconds,
		...(spent?.dollars() === undefined ? {} : { costUsd: spent.dollars() }),
		...(spent?.tokens() === undefined ? {} : { tokens: spent.tokens() }),
	};
	if (!classified.ok) {
		return {
			result: { status: "error", reason: classified.reason, ...cost },
			detail: { input, reply: classified.reason },
		};
	}
	const graded = expectations(spec.judged).map((expectation) => {
		const probability = probabilityOf(classified.classification, expectation);
		return {
			id: expectation.id,
			about: aboutOf(expectation),
			pass: met(expectation, probability),
			probability,
		};
	});
	const failed = graded.filter((each) => !each.pass);
	return {
		result: {
			status: failed.length === 0 ? "pass" : "fail",
			score: (graded.length - failed.length) / graded.length,
			...(failed.length === 0
				? {}
				: {
						reason: failed
							.map((each) => `${each.id} ${percent(each.probability)}`)
							.join(", "),
					}),
			...cost,
		},
		detail: {
			input,
			rubric: graded.map((each) => each.about).join("\n"),
			reply: answersText(classified.classification),
			checks: graded.map(({ id, about, pass, probability }) => ({
				id,
				about: `${about}: ${percent(probability)}`,
				pass,
			})),
		},
	};
}

/** A judge that keeps what its calls cost, as Jev's verdicts say. */
function priced(judge: Judge): {
	judge: Judge;
	dollars: () => number | undefined;
	tokens: () => number | undefined;
} {
	let last: Verdict | undefined;
	return {
		judge: {
			judge: async (judgment, opts) => {
				last = await judge.judge(judgment, opts);
				return last;
			},
		},
		dollars: () => last?.dollars,
		tokens: () =>
			last?.usage === undefined
				? undefined
				: last.usage.input + last.usage.output,
	};
}

/** The request as the page shows a run's input. */
function requestText(spec: ClassifySpec): string {
	const { subject, detail, attachments = [] } = spec.request;
	return [
		subject,
		"",
		detail,
		...(attachments.length === 0
			? []
			: [
					"",
					`Attachments: ${attachments.map((each) => `${each.name} (${each.mimeType})`).join(", ")}`,
				]),
	].join("\n");
}

/** Every answer the judge gave, a group a line, as the run's reply. */
function answersText(
	classification: Extract<Classified, { ok: true }>["classification"],
): string {
	return Object.entries(classification)
		.map(
			([group, answers]) =>
				`${group}: ${Object.entries(answers as Record<string, number>)
					.map(([id, probability]) => `${id} ${percent(probability)}`)
					.join(", ")}`,
		)
		.join("\n");
}

function percent(probability: number): string {
	return `${Math.round(probability * 100)}%`;
}

/** Cell `index` of a batch, as its result line names it. */
function cellId(index: number): string {
	return `run-${String(index).padStart(3, "0")}`;
}

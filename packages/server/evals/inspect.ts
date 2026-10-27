import type { ContractCell, ContractDetail, ContractResult } from "./contract";
import { CONTRACT_FORMAT } from "./contract";
import type { Imported } from "./import";
import type { EvalCheck, EvalStep } from "./types";

/**
 * An Inspect AI eval log, as `inspect eval` writes it with `--log-format json`
 * or `inspect log dump` prints it: only the fields a batch is made from.
 */
export interface InspectLog {
	status?: string;
	eval: {
		task: string;
		model: string;
		created?: string;
	};
	stats?: { started_at?: string };
	error?: { message?: string } | null;
	samples?: InspectSample[];
}

interface InspectSample {
	id: string | number;
	epoch?: number;
	input: string | InspectMessage[];
	target?: string | string[];
	messages?: InspectMessage[];
	output?: { completion?: string };
	scores?: Record<string, InspectScore> | null;
	error?: { message?: string } | null;
	model_usage?: Record<string, { total_tokens?: number; total_cost?: number }>;
	total_time?: number | null;
}

interface InspectScore {
	value: unknown;
	answer?: string | null;
	explanation?: string | null;
}

interface InspectMessage {
	role: string;
	content: string | InspectContent[];
	tool_calls?: { id: string; function: string; arguments: unknown }[] | null;
	tool_call_id?: string | null;
}

type InspectContent = { type: string; text?: string; reasoning?: string };

/**
 * `log` as a splates-evals/1 batch: a cell per sample and epoch, which passes
 * when every scorer's value, as Inspect reads it as a number (`C` 1, `P` 0.5,
 * `I` 0), reaches `passAt`.
 */
export function inspectBatch(log: InspectLog, passAt: number): Imported {
	const samples = log.samples ?? [];
	const cells: ContractCell[] = samples.map((sample, index) => ({
		id: `c${index}`,
		case: String(sample.id),
		group: log.eval.task,
		target: { model: log.eval.model },
		repetition: (sample.epoch ?? 1) - 1,
	}));
	return {
		batch: {
			format: CONTRACT_FORMAT,
			startedAt: new Date(
				log.stats?.started_at ?? log.eval.created ?? Date.now(),
			).toISOString(),
			title: `${log.eval.task} on ${log.eval.model}`,
			cells,
		},
		results: samples.map((sample, index) =>
			resultOf(`c${index}`, sample, passAt),
		),
		details: new Map(
			samples.map((sample, index) => [`c${index}`, detailOf(sample, passAt)]),
		),
	};
}

function resultOf(
	cell: string,
	sample: InspectSample,
	passAt: number,
): ContractResult {
	const usage = Object.values(sample.model_usage ?? {});
	const tokens = sum(usage.map((each) => each.total_tokens));
	const costUsd = sum(usage.map((each) => each.total_cost));
	const measured = {
		...(tokens === undefined ? {} : { tokens }),
		...(costUsd === undefined ? {} : { costUsd }),
		...(typeof sample.total_time === "number"
			? { milliseconds: Math.round(sample.total_time * 1000) }
			: {}),
		detail: `${cell}.json`,
	};
	if (sample.error) {
		return {
			cell,
			status: "error",
			reason: sample.error.message ?? "the sample errored",
			...measured,
		};
	}
	const scores = Object.entries(sample.scores ?? {});
	if (scores.length === 0) {
		return {
			cell,
			status: "error",
			reason: "no scorer scored it",
			...measured,
		};
	}
	const values = scores.map(([, score]) => scoreValue(score.value));
	const known = values.filter((value) => value !== null);
	const score =
		known.length === 0
			? undefined
			: known.reduce((total, value) => total + value, 0) / known.length;
	return {
		cell,
		status: values.every((value) => value !== null && value >= passAt)
			? "pass"
			: "fail",
		...(score === undefined || score < 0 || score > 1 ? {} : { score }),
		...(reasonOf(scores) === "" ? {} : { reason: reasonOf(scores) }),
		...measured,
	};
}

function detailOf(sample: InspectSample, passAt: number): ContractDetail {
	const target = [sample.target ?? []].flat();
	return {
		input:
			typeof sample.input === "string"
				? sample.input
				: sample.input.map(textOf).join("\n\n"),
		...(target.length === 0 ? {} : { rubric: target.join("\n") }),
		reply: sample.output?.completion ?? "",
		checks: Object.entries(sample.scores ?? {}).map(
			([name, score]): EvalCheck => {
				const value = scoreValue(score.value);
				return {
					id: name,
					about: score.explanation ?? score.answer ?? String(score.value),
					pass: value !== null && value >= passAt,
				};
			},
		),
		transcript: transcriptOf(sample.messages ?? []),
	};
}

/** A score's value as Inspect's `value_to_float` reads it, or null when it is no number. */
function scoreValue(value: unknown): number | null {
	if (typeof value === "number") {
		return value;
	}
	if (typeof value === "boolean") {
		return value ? 1 : 0;
	}
	if (typeof value === "string") {
		const letter = { C: 1, P: 0.5, I: 0, N: 0 }[value];
		if (letter !== undefined) {
			return letter;
		}
		const lower = value.toLowerCase();
		if (lower === "yes" || lower === "true") {
			return 1;
		}
		if (lower === "no" || lower === "false") {
			return 0;
		}
		const number = Number(value);
		return value.trim() === "" || Number.isNaN(number) ? null : number;
	}
	return null;
}

function reasonOf(scores: [string, InspectScore][]): string {
	const reasons = scores.filter(([, score]) => score.explanation);
	if (reasons.length === 1) {
		return reasons[0]?.[1].explanation ?? "";
	}
	return reasons
		.map(([name, score]) => `${name}: ${score.explanation}`)
		.join("\n");
}

/** The conversation as steps: text for what each side said, a tool step for each call with what it returned. */
function transcriptOf(messages: InspectMessage[]): EvalStep[] {
	const outputs = new Map(
		messages
			.filter((message) => message.role === "tool" && message.tool_call_id)
			.map((message) => [message.tool_call_id, textOf(message)]),
	);
	return messages.flatMap((message): EvalStep[] => {
		if (message.role === "tool") {
			return [];
		}
		const text = textOf(message);
		return [
			...(text === ""
				? []
				: [{ kind: "text" as const, text: `${message.role}: ${text}` }]),
			...(message.tool_calls ?? []).map((call) => ({
				kind: "tool" as const,
				name: call.function,
				input: JSON.stringify(call.arguments),
				output: outputs.get(call.id) ?? null,
			})),
		];
	});
}

function textOf(message: InspectMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content
		.map((part) => part.text ?? "")
		.filter((text) => text !== "")
		.join("\n");
}

function sum(values: (number | undefined)[]): number | undefined {
	const known = values.filter((value) => typeof value === "number");
	return known.length === 0
		? undefined
		: known.reduce((total, value) => total + value, 0);
}

import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
	EvalCell,
	EvalCheck,
	EvalDetail,
	EvalRun,
	EvalStep,
	EvalTarget,
	EvalVerdict,
} from "./types";

/** What a `batch.json` in the public format says it is. */
export const CONTRACT_FORMAT = "splates-evals/1";

/** The file each finished cell appends its line to, in its batch's directory. */
export const RESULTS_FILE = "results.jsonl";

/** Whether `saved`, a `batch.json`, is in the public format. */
export function isContractBatch(saved: unknown): saved is ContractBatch {
	return (
		typeof saved === "object" &&
		saved !== null &&
		(saved as { format?: unknown }).format === CONTRACT_FORMAT &&
		Array.isArray((saved as { cells?: unknown }).cells)
	);
}

/** The run id of cell `cell` of batch `batch`, as `EvalRun.id` names it. */
export function contractRunId(batch: string, cell: string): string {
	return `${batch}#${cell}`;
}

/** The cells of `batch`, saved in directory `dir` as `id`, each with its last result line. */
export async function contractCells(
	dir: string,
	id: string,
	batch: ContractBatch,
): Promise<{ targets: EvalTarget[]; grid: EvalCell[] }> {
	const results = await resultsOf(dir);
	const targets: EvalTarget[] = [];
	const grid = batch.cells.map((cell) => {
		const target = contractTarget(cell.target);
		if (!targets.some((each) => each.key === target.key)) {
			targets.push(target);
		}
		const result = results.get(cell.id);
		return {
			scenario: cell.case,
			aspect: cell.group ?? "",
			requirement: cell.about ?? "",
			target: target.key,
			repetition: cell.repetition ?? 0,
			run:
				result === undefined ? null : runOf(contractRunId(id, cell.id), result),
		};
	});
	return { targets, grid };
}

/** Cell `cell` of the batch in `dir`, saved as `id`, opened whole; null when it has not finished. */
export async function contractDetail(
	dir: string,
	id: string,
	batch: ContractBatch,
	cell: string,
): Promise<EvalDetail | null> {
	const planned = batch.cells.find((each) => each.id === cell);
	const result = (await resultsOf(dir)).get(cell);
	if (planned === undefined || result === undefined) {
		return null;
	}
	const detail = await detailOf(dir, result.detail);
	return {
		...runOf(contractRunId(id, cell), result),
		producer: batch.producer ?? null,
		scenario: planned.case,
		aspect: planned.group ?? "",
		requirement: planned.about ?? "",
		target: contractTarget(planned.target),
		repetition: planned.repetition ?? 0,
		input: detail.input ?? "",
		rubric: detail.rubric ?? null,
		checks: detail.checks ?? [],
		judge: detail.judge ?? null,
		reply: detail.reply ?? "",
		transcript: detail.transcript ?? [],
	};
}

function contractTarget(target: ContractTarget): EvalTarget {
	const agent = target.agent ?? "";
	const variant = target.variant ?? null;
	return {
		key: `${agent}/${target.model}${target.effort === undefined ? "" : `@${target.effort}`}${variant === null ? "" : ` @${variant}`}`,
		agent,
		model: target.model,
		effort: target.effort ?? null,
		skill: variant,
	};
}

function runOf(id: string, result: ContractResult): EvalRun {
	return {
		id,
		status: result.status,
		tokens: result.tokens ?? null,
		costUsd: result.costUsd ?? null,
		milliseconds: result.milliseconds ?? 0,
		...(result.status === "error" && result.reason !== undefined
			? { error: result.reason }
			: {}),
		...(result.score === undefined ? {} : { score: result.score }),
		...(result.reason === undefined ? {} : { reason: result.reason }),
		...(result.url === undefined ? {} : { url: result.url }),
	};
}

/**
 * Each cell's last line of `results.jsonl` in `dir`. A line that is not a
 * result, such as one half written, is skipped.
 */
async function resultsOf(dir: string): Promise<Map<string, ContractResult>> {
	const text = await readFile(join(dir, RESULTS_FILE), "utf8").catch(
		(error: unknown) => {
			if ((error as { code?: string }).code === "ENOENT") {
				return "";
			}
			throw error;
		},
	);
	const results = new Map<string, ContractResult>();
	for (const line of text.split("\n")) {
		const result = parsed(line);
		if (result !== null) {
			results.set(result.cell, result);
		}
	}
	return results;
}

function parsed(line: string): ContractResult | null {
	if (line.trim() === "") {
		return null;
	}
	try {
		const result = JSON.parse(line) as Partial<ContractResult>;
		return typeof result.cell === "string" &&
			(result.status === "pass" ||
				result.status === "fail" ||
				result.status === "error")
			? (result as ContractResult)
			: null;
	} catch {
		return null;
	}
}

/** The detail file `name` in `dir`, or nothing when there is none or it is outside `dir`. */
async function detailOf(
	dir: string,
	name: string | undefined,
): Promise<ContractDetail> {
	if (name === undefined) {
		return {};
	}
	const path = resolve(dir, name);
	if (!path.startsWith(resolve(dir) + sep)) {
		return {};
	}
	return readFile(path, "utf8").then(
		(text) => JSON.parse(text) as ContractDetail,
		() => ({}),
	);
}

/**
 * `batch.json` as any framework writes it (`designs/evals-contract.md`):
 * every cell it plans, before any runs.
 */
export interface ContractBatch {
	format: typeof CONTRACT_FORMAT;
	/** As ISO 8601. */
	startedAt: string;
	title?: string;
	/** Who wrote the batch; `splates` for splates's own harness, which the page gives its skill controls. */
	producer?: string;
	cells: ContractCell[];
}

/** One case on one target at one repetition. */
export interface ContractCell {
	/** Unique in its batch; what a result line names it by. */
	id: string;
	case: string;
	/** What the page groups cases under. */
	group?: string;
	/** What the case asks, in words. */
	about?: string;
	target: ContractTarget;
	repetition?: number;
}

/** Free-form labels for what a cell ran on. */
export interface ContractTarget {
	model: string;
	agent?: string;
	effort?: string;
	/** Anything else the run varied, such as a prompt's revision. */
	variant?: string;
}

/** A line of `results.jsonl`: how one cell ended. */
export interface ContractResult {
	cell: string;
	status: "pass" | "fail" | "error";
	/** From 0 to 1, for a framework that grades on a scale. */
	score?: number;
	reason?: string;
	tokens?: number;
	costUsd?: number;
	milliseconds?: number;
	/** The framework's own view of the cell. */
	url?: string;
	/** A JSON file in the batch's directory with what the cell did, `ContractDetail`. */
	detail?: string;
}

/** What a result's `detail` file holds, every field optional. */
export interface ContractDetail {
	input?: string;
	rubric?: string;
	reply?: string;
	checks?: EvalCheck[];
	judge?: EvalVerdict;
	transcript?: EvalStep[];
}

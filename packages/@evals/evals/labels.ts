import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	CONTRACT_FORMAT,
	type ContractBatch,
	type ContractDetail,
	type ContractResult,
	RESULTS_FILE,
} from "./contract";
import { restoreRun } from "./keep";
import { type Current, regradeBatch } from "./regrade";

/**
 * A stored run someone confirmed as good or bad. An evals file exports these
 * as `labels`; they are tests for the graders, not for the skill.
 */
export interface Label {
	/** The scenario the run answered. */
	scenario: string;
	/** A one-run batch directory, relative to the evals file's folder. */
	run: string;
	/** What the graders must say of it. */
	expect: "pass" | "fail";
	/** One line on why the person judged it so. */
	why: string;
}

export interface CheckLabelOptions {
	/** Re-run the judge too; it costs tokens, so the person starts it. */
	judge?: boolean;
}

/** Why today's graders disagree with `label` (stored under `base`), or null when they agree. */
export async function checkLabel(
	label: Label,
	base: string,
	current: readonly Current[],
	opts: CheckLabelOptions = {},
): Promise<string | null> {
	const dir = resolve(base, label.run);
	const at = `${label.run} (${label.scenario})`;
	if (!current.some((each) => each.scenario.id === label.scenario)) {
		return `${at}: no scenario ${label.scenario}`;
	}
	let report: Awaited<ReturnType<typeof regradeBatch>>;
	try {
		report = await regradeBatch(dir, current, { judge: opts.judge === true });
	} catch (error) {
		return `${at}: cannot be regraded: ${error instanceof Error ? error.message : error}`;
	}
	const graded = report.graded.find((each) => each.scenario === label.scenario);
	if (graded === undefined) {
		const why = report.skipped.find(
			(each) => each.scenario === label.scenario,
		)?.why;
		return `${at}: not graded${why === undefined ? "" : `: ${why}`}`;
	}
	if (graded.now !== label.expect) {
		return `${at}: labelled ${label.expect} (${label.why}) but the graders now say ${graded.now}`;
	}
	return null;
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;
const SECRET_SHAPES: RegExp[] = [
	/sk-[A-Za-z0-9_-]{16,}/g,
	/gh[pousr]_[A-Za-z0-9]{20,}/g,
	/github_pat_[A-Za-z0-9_]{20,}/g,
	/AKIA[0-9A-Z]{16}/g,
	/xox[abprs]-[A-Za-z0-9-]{10,}/g,
	/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** `text` with the values of secret-looking environment variables and well-known token shapes replaced. */
export function scrubText(text: string, env: NodeJS.ProcessEnv): string {
	let out = text;
	const values = Object.entries(env)
		.filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined &&
				entry[1].length >= 8 &&
				SECRET_NAME.test(entry[0]),
		)
		.map((entry) => entry[1])
		.sort((left, right) => right.length - left.length);
	for (const value of values) {
		out = out.split(value).join("[redacted]");
	}
	for (const shape of SECRET_SHAPES) {
		out = out.replace(shape, (_match, prefix) =>
			typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]",
		);
	}
	return out;
}

export interface CopyRunOptions {
	/** The environment whose secret values are scrubbed; this process's by default. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Copies run `run` of the batch in `batch` into the empty `dest` as a one-run
 * batch that a `Label` can name, scrubbed of secrets. Throws, copying nothing,
 * when the run's kept repo holds something that looks like a secret.
 */
export async function copyRun(
	batch: string,
	run: string,
	dest: string,
	opts: CopyRunOptions = {},
): Promise<void> {
	const env = opts.env ?? process.env;
	const manifest = JSON.parse(
		await readFile(join(batch, "batch.json"), "utf8"),
	) as ContractBatch;
	if (manifest.format !== CONTRACT_FORMAT) {
		throw new Error(`${batch} is not a ${CONTRACT_FORMAT} batch`);
	}
	const cell = manifest.cells.find((each) => each.id === run);
	const line = (await readFile(join(batch, RESULTS_FILE), "utf8"))
		.split("\n")
		.filter((each) => each !== "")
		.map((each) => JSON.parse(each) as ContractResult)
		.find((each) => each.cell === run);
	if (cell === undefined || line === undefined) {
		throw new Error(`no finished run ${run} in ${batch}`);
	}
	await mkdir(dest, { recursive: true });
	if ((await readdir(dest)).length > 0) {
		throw new Error(`${dest} is not empty`);
	}
	const detailFile = line.detail ?? `${run}.json`;
	const detail = JSON.parse(
		await readFile(join(batch, detailFile), "utf8"),
	) as ContractDetail;
	if (detail.repo !== undefined) {
		const restored = await restoreRun(batch, run);
		try {
			const dump = await restored.outcome.repo.run([
				"git",
				"log",
				"-p",
				"--all",
				"--format=%B",
			]);
			const files = await restored.outcome.repo.run(["git", "ls-files"]);
			let tree = "";
			for (const file of files.split("\n").filter((each) => each !== "")) {
				tree += await restored.outcome.repo.run(["cat", file]).catch(() => "");
			}
			const found = [dump, tree];
			if (found.some((text) => scrubText(text, env) !== text)) {
				throw new Error(
					`${run}'s kept repo holds something that looks like a secret; it cannot be copied`,
				);
			}
		} finally {
			await restored.remove();
		}
		await cp(join(batch, detail.repo.bundle), join(dest, `${run}.bundle`));
		if (detail.repo.diff !== undefined) {
			const diff = await readFile(join(batch, detail.repo.diff), "utf8");
			await writeFile(join(dest, `${run}.diff`), scrubText(diff, env));
		}
	}
	const kept: ContractDetail = {
		...detail,
		...(detail.repo === undefined
			? {}
			: {
					repo: {
						bundle: `${run}.bundle`,
						...(detail.repo.diff === undefined ? {} : { diff: `${run}.diff` }),
					},
				}),
	};
	await writeFile(
		join(dest, `${run}.json`),
		scrubText(JSON.stringify(kept, null, "\t"), env),
	);
	await writeFile(
		join(dest, RESULTS_FILE),
		`${JSON.stringify({ ...line, detail: `${run}.json`, url: undefined })}\n`,
	);
	await writeFile(
		join(dest, "batch.json"),
		scrubText(JSON.stringify({ ...manifest, cells: [cell] }, null, "\t"), env),
	);
}

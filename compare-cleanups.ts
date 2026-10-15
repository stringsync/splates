import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { cli } from "webappwiz/cmd";
import { Credentials } from "webappwiz/creds";
import {
	CLEF_DOLLARS_PER_TOKEN,
	ClefDecider,
	type Decider,
	JEV_DOLLARS_PER_TOKEN,
	JevDecider,
} from "webappwiz/decide";
import {
	CorrectionDropper,
	FillerDropper,
	ListFormatter,
	MissingWordFlagger,
} from "webappwiz/dictate";
import { z } from "zod";
import {
	type CleanupsFor,
	type Compared,
	compareCleanups,
	describeEdit,
	sentPrompts,
	summarize,
} from "./cleanup-comparison";
import { CLEANUP_MODELS, type CleanupModel } from "./cleanup-models";
import { CountingDecider } from "./counting-decider";
import { SYSTEM_STORES } from "./creds";
import {
	CLOUDFLARE_ACCOUNT,
	CLOUDFLARE_TOKEN,
	credsFor,
	TYPESAFE_KEY,
} from "./dev-decider";
import { tagSystems } from "./dev-tag-systems";
import { MeteredDecider } from "./metered-decider";
import { readSystems } from "./systems";

/*
 * Runs the dictation cleanups over the prompts sent in this project's Claude
 * Code transcripts on each model, to pick a model and thresholds from real
 * text. `estimate` spends nothing; `run` spends real money, so estimate
 * first. Never run from tests.
 *
 *   bun packages/arbor/compare-cleanups.ts estimate
 *   bun packages/arbor/compare-cleanups.ts run --limit 50
 */

const COMPARED: CleanupModel[] = ["jev-latest", "clef", "clef-flash"];

/** How many disagreements a report prints for each cleanup. */
const EXAMPLES = 8;

/** The main tree of the checkout this script runs in. */
const ROOT = await mainTree(join(import.meta.dir, "../.."));

const app = cli("compare-cleanups");

for (const [verb, spends] of [
	["estimate", false],
	["run", true],
] as const) {
	app
		.command(verb)
		.description(
			spends
				? "run the cleanups on each model, spending real money"
				: "count the requests a run would send, and what they would cost",
		)
		.option("limit", z.coerce.number().int().positive().optional(), {
			description: "only the most recent prompts, this many",
		})
		.repeated("model", z.enum(CLEANUP_MODELS.map((model) => model.value)), {
			description: `a model to compare (${COMPARED.join(", ")} by default)`,
		})
		.action(async (opts, { log }) => {
			const models = opts.model.length > 0 ? opts.model : COMPARED;
			const prompts = await promptsOf(ROOT);
			const picked = opts.limit ? prompts.slice(-opts.limit) : prompts;
			log.info(`${picked.length} prompts of ${prompts.length} sent`);
			const systems = await readSystems(ROOT);
			const cleanupsFor: CleanupsFor = (decider) => ({
				corrections: new CorrectionDropper(decider),
				filler: new FillerDropper(decider),
				tags: {
					clean: (text) => tagSystems(decider, basename(ROOT), systems, text),
				},
				lists: new ListFormatter(decider),
				missing: new MissingWordFlagger(decider),
			});
			if (!spends) {
				const counting = new CountingDecider();
				await compareCleanups(picked, { counting }, cleanupsFor);
				let total = 0;
				for (const model of models) {
					const dollars = counting.dollars(dollarsPerToken(model));
					total += dollars;
					log.info(
						`${model}: ${counting.requests} requests, about $${dollars.toFixed(4)}`,
					);
				}
				log.info(
					`about $${total.toFixed(2)} in all, erring high; \`run\` spends it`,
				);
				return;
			}
			const metered = Object.fromEntries(
				await Promise.all(
					models.map(
						async (model) =>
							[model, new MeteredDecider(await deciderOf(model))] as const,
					),
				),
			);
			const compared = await compareCleanups(picked, metered, cleanupsFor, {
				progress: (done) => {
					if (done % 25 === 0 || done === picked.length) {
						log.info(`${done}/${picked.length}`);
					}
				},
			});
			const out = join(tmpdir(), `compare-cleanups-${Date.now()}.json`);
			await writeFile(out, JSON.stringify(compared, null, "\t"));
			console.log(report(compared, metered));
			log.info(`every outcome is in ${out}`);
		});
}

await app.run({});

/** The main tree of the git checkout at `dir`, worktree or not. */
async function mainTree(dir: string): Promise<string> {
	const common = Bun.spawnSync(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		{ cwd: dir },
	);
	return dirname(common.stdout.toString().trim());
}

/**
 * The prompts sent in `root`'s Claude Code transcripts and its worktrees',
 * which Claude Code keeps under its path with every `/` and `.` a `-`.
 */
async function promptsOf(root: string): Promise<string[]> {
	const projects = join(homedir(), ".claude", "projects");
	const prefix = root.replace(/[/.]/g, "-");
	const files: { path: string; modified: number }[] = [];
	for (const dir of await readdir(projects)) {
		if (!dir.startsWith(prefix)) {
			continue;
		}
		for (const name of await readdir(join(projects, dir))) {
			if (name.endsWith(".jsonl")) {
				const path = join(projects, dir, name);
				files.push({ path, modified: (await Bun.file(path).stat()).mtimeMs });
			}
		}
	}
	files.sort((older, newer) => older.modified - newer.modified);
	return sentPrompts(
		await Promise.all(files.map((file) => readFile(file.path, "utf8"))),
	);
}

function dollarsPerToken(model: CleanupModel): number {
	return model === "clef" || model === "clef-flash"
		? CLEF_DOLLARS_PER_TOKEN[model]
		: JEV_DOLLARS_PER_TOKEN;
}

/** `model`'s decider, on the creds `arbor dev` keeps for it. */
async function deciderOf(model: CleanupModel): Promise<Decider> {
	const creds = new Credentials([
		await SYSTEM_STORES.project(ROOT),
		SYSTEM_STORES.device,
	]);
	const values: Record<string, string> = {};
	for (const name of credsFor(model)) {
		const value = await creds.get(name);
		if (value === undefined) {
			throw new Error(
				`${model} needs ${name}: save it on arbor dev's Creds page first`,
			);
		}
		values[name] = value;
	}
	if (model === "jev-latest" || model === "jev-preview") {
		return new JevDecider(values[TYPESAFE_KEY] ?? "", { model });
	}
	return new ClefDecider(
		values[CLOUDFLARE_ACCOUNT] ?? "",
		values[CLOUDFLARE_TOKEN] ?? "",
		{ model },
	);
}

/** The comparison as markdown: per cleanup, what each model did, then cost. */
function report(
	compared: Compared[],
	metered: Record<string, MeteredDecider>,
): string {
	const lines: string[] = [];
	for (const summary of summarize(compared)) {
		lines.push(
			`## ${summary.cleanup}`,
			"",
			`${summary.touched} prompts touched; the models disagree on ${summary.disagreed.length}.`,
			"",
			"| model | changed | left unsure | failed |",
			"| --- | --- | --- | --- |",
			...Object.keys(summary.changed).map(
				(model) =>
					`| ${model} | ${summary.changed[model]} | ${summary.unsure[model]} | ${summary.failed[model]} |`,
			),
			"",
		);
		for (const each of summary.disagreed.slice(0, EXAMPLES)) {
			lines.push(`> ${each.prompt.replace(/\n/g, "\n> ")}`, "");
			for (const [model, outcome] of Object.entries(each.outcomes)) {
				if ("failed" in outcome) {
					lines.push(`- **${model}** failed: ${outcome.failed}`);
					continue;
				}
				const changed =
					outcome.text === each.prompt
						? "unchanged"
						: JSON.stringify(outcome.text);
				lines.push(`- **${model}**: ${changed}`);
				for (const edit of outcome.edits) {
					lines.push(`  - unsure: ${describeEdit(outcome.text, edit)}`);
				}
			}
			lines.push("");
		}
	}
	lines.push("## Cost", "");
	for (const [model, decider] of Object.entries(metered)) {
		lines.push(
			`- ${model}: ${decider.requests} requests, $${decider.dollars.toFixed(4)}`,
		);
	}
	return lines.join("\n");
}

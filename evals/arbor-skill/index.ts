// Evals for the arbor skill: scenarios run against `claude -p` and graded,
// by code where a program can tell and by a model for the rest. Each run
// costs real money, so only a person starts one, from a terminal; see README.md.
import { homedir } from "node:os";
import { join } from "node:path";
import { cli } from "webappwiz/cmd";
import type { Logger } from "webappwiz/log";
import { z } from "zod";
import { Batch, fixtureVersion } from "./batch";
import { report } from "./report";
import { Results } from "./results";
import { SCENARIOS } from "./scenarios";
import { type Variant, variant } from "./variants";

const evals = cli("arbor-skill-evals");

/** The skill versions compared when none are named: trunk's, then this tree's. */
const DEFAULT_SKILLS = ["main", join(import.meta.dir, "../../skills/arbor")];

const RESULTS = join(homedir(), ".arbor", "skill-evals");

evals
	.command("run")
	.description(
		"run the scenarios a skill change touches, after saying what it will cost and asking",
	)
	.rest("skills", z.string(), {
		description:
			"skill versions, each a directory or a git ref; the first is the baseline (default: main, then skills/arbor)",
	})
	.repeated("scenario", z.string(), {
		description: "run this scenario, whatever changed",
	})
	.option("reps", z.coerce.number().int().positive(), {
		default: 3,
		description: "runs of each scenario per version",
	})
	.option("model", z.string(), {
		default: "opus",
		description: "the agent's model",
	})
	.option("grader", z.string(), {
		default: "opus",
		description: "the model grading judgment items",
	})
	.option("parallel", z.coerce.number().int().positive(), {
		default: 7,
		description: "runs at once",
	})
	.action(async (opts, { log }) => {
		const batch = await plan(log, opts);
		if (batch === null) {
			return;
		}
		const estimate = await batch.estimate();
		log.info(
			`${estimate.runs} runs to make (${estimate.kept} kept) on ${opts.model}, about $${estimate.runUsd.toFixed(2)}, ${
				estimate.pastRuns === 0
					? "a guess, with no past runs"
					: `from ${estimate.pastRuns} past runs`
			}; ${estimate.grades} grades on ${opts.grader}, about $${estimate.gradeUsd.toFixed(2)}`,
		);
		if (estimate.runs + estimate.grades > 0) {
			if (!process.stdin.isTTY) {
				throw new Error(
					"these evals spend money, so they run only from a terminal, for a person who says yes",
				);
			}
			if (
				prompt(
					`Spend about $${(estimate.runUsd + estimate.gradeUsd).toFixed(2)}? [y/N]`,
				)
					?.trim()
					.toLowerCase() !== "y"
			) {
				log.info("nothing run");
				return;
			}
			const spent = await batch.run(log);
			log.info(`spent $${spent.toFixed(2)}`);
		}
		log.info(
			`\n${report(
				await batch.verdicts(),
				batch.variants.map((each) => each.label),
			)}`,
		);
	});

evals
	.command("report")
	.description(
		"print the kept runs of the scenarios a skill change touches; runs nothing",
	)
	.rest("skills", z.string(), { description: "skill versions, as for run" })
	.repeated("scenario", z.string(), {
		description: "report this scenario, whatever changed",
	})
	.option("reps", z.coerce.number().int().positive(), {
		default: 3,
		description: "runs of each scenario per version",
	})
	.option("model", z.string(), {
		default: "opus",
		description: "the agent's model",
	})
	.action(async (opts, { log }) => {
		const batch = await plan(log, { ...opts, grader: "opus", parallel: 1 });
		if (batch !== null) {
			log.info(
				report(
					await batch.verdicts(),
					batch.variants.map((each) => each.label),
				),
			);
		}
	});

interface PlanOptions {
	skills: string[];
	scenario: string[];
	reps: number;
	model: string;
	grader: string;
	parallel: number;
}

/** The batch the options ask for, saying what changed; null when nothing would run. */
async function plan(log: Logger, opts: PlanOptions): Promise<Batch | null> {
	const repo = join(import.meta.dir, "../..");
	const given = opts.skills.length > 0 ? opts.skills : DEFAULT_SKILLS;
	const variants: Variant[] = [];
	for (const each of given) {
		const found = await variant(each, { repo });
		if (variants.some((other) => other.hash === found.hash)) {
			log.info(
				`${each} is the same skill as one already named; running it once`,
			);
			continue;
		}
		variants.push(found);
	}
	let scenarios = SCENARIOS.filter((each) => opts.scenario.includes(each.id));
	const unknown = opts.scenario.filter(
		(id) => !SCENARIOS.some((each) => each.id === id),
	);
	if (unknown.length > 0) {
		throw new Error(
			`no such scenario: ${unknown.join(", ")} (there are ${SCENARIOS.map((each) => each.id).join(", ")})`,
		);
	}
	if (opts.scenario.length === 0) {
		const picked = Batch.pick(variants);
		scenarios = picked.scenarios;
		if (variants.length > 1) {
			log.info(`changed sections: ${picked.changed.join(", ") || "none"}`);
		}
		if (picked.uncovered.length > 0) {
			log.info(`no scenario reads: ${picked.uncovered.join(", ")}`);
		}
	}
	if (scenarios.length === 0) {
		log.info("no scenario touches what changed; name one with --scenario");
		return null;
	}
	log.info(`scenarios: ${scenarios.map((each) => each.id).join(", ")}`);
	const results = new Results(RESULTS, await fixtureVersion());
	return new Batch(variants, scenarios, results, opts);
}

await evals.run({});

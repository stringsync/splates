import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "webappwiz/log";
import decisions from "./decisions.probes";
import { nativeTarget } from "./native-target";
import { type Allowance, admit } from "./probe-affordability";
import { projectEvalBudgets } from "./probe-budget-cli";
import type { SkillChange } from "./probe-change";
import { pairedBatchReport } from "./probe-pair";
import { freezeSnapshots } from "./probe-snapshots";
import { hash, type ProbeModule, runProbes } from "./runner";

interface PairOptions {
	plan: boolean;
	directory: string;
	root: string;
	targets: string[];
	mode: "discovery" | "explicit";
	codexHome?: string;
	codexFixtureWrites?: boolean;
	reps: number;
	parallel: number;
	spending: Allowance;
	reservation: Allowance;
	cliHash: string;
	harnessHash: string;
	reproduction: string[];
}

/** Plan or confirm one change-gated experiment; all snapshots share one admission batch. */
export async function pairedCli(
	module: ProbeModule,
	change: SkillChange,
	opts: PairOptions,
	log: Logger,
): Promise<void> {
	if (opts.parallel !== 1) {
		throw new Error(
			"Paired experiments require --parallel 1 for stop-on-failure ordering",
		);
	}
	if (
		new Set(opts.targets).size !== opts.targets.length ||
		!opts.targets.length
	) {
		throw new Error(
			"Paired experiments require unique explicit native targets",
		);
	}
	if (
		!opts.targets.some((value) => value.startsWith("codex:")) ||
		!opts.targets.some((value) => value.startsWith("claude:")) ||
		opts.targets.some((value) => !/^(codex|claude):/.test(value))
	) {
		throw new Error("Paired experiments require both Codex and Claude targets");
	}
	for (const probe of module.probes) {
		const frozen = decisions.probes.find(
			(value) =>
				value.id === probe.id &&
				["decisions/local-choice", "decisions/answer"].includes(value.id),
		);
		if (!frozen || hash({ ...probe, bounds: frozen.bounds }) !== hash(frozen)) {
			throw new Error(
				"Paired experiments require the frozen decision tuning cases and assertions",
			);
		}
	}
	const targetsFor = (
		snapshots: {
			role: "baseline" | "candidate";
			source: string;
			hash: string;
		}[],
	) =>
		opts.targets.flatMap((value) =>
			snapshots.map((snapshot) => ({
				...nativeTarget(value, {
					source: snapshot.source,
					mode: opts.mode,
					allowance: opts.reservation,
					codexHome: opts.codexHome,
					codexFixtureWrites: opts.codexFixtureWrites,
					expectedHash: snapshot.hash,
				}),
				snapshot: { role: snapshot.role, hash: snapshot.hash },
			})),
		);
	const planned = targetsFor([
		{ role: "baseline", source: change.skill, hash: change.beforeHash },
		{ role: "candidate", source: change.skill, hash: change.afterHash },
	]);
	const jobs = module.probes.flatMap((probe) =>
		planned.flatMap((target) =>
			Array.from({ length: opts.reps }, () => ({ probe, target })),
		),
	);
	const quotes = admit(jobs, opts.spending);
	log.info(
		`Paired experiment: ${jobs.length} cells; baseline ${change.beforeHash}; candidate ${change.afterHash}; aggregate reservation ${JSON.stringify(quotes.reduce<Allowance>((sum, value) => ({ tokens: sum.tokens + (value?.tokens ?? 0), microUsd: sum.microUsd + (value?.microUsd ?? 0) }), { tokens: 0, microUsd: 0 }))}. One shared reservation; monitored limits may overshoot, Codex USD unknown.`,
	);
	if (opts.plan) {
		log.info(
			"Plan only: no native startup, authentication, reservation or model execution. Effective versions/models/reasoning and permissions remain unverified.",
		);
		return;
	}
	if (!process.stdin.isTTY) {
		throw new Error("Paid paired probes require a terminal and confirmation");
	}
	if (
		prompt("Start this potentially paid paired experiment? [y/N]")
			?.trim()
			.toLowerCase() !== "y"
	) {
		return;
	}
	await mkdir(opts.directory, { recursive: true });
	const directory = await mkdtemp(join(opts.directory, "experiment-"));
	const snapshots = await freezeSnapshots(change, directory);
	const targets = targetsFor(snapshots);
	const sharedBudget = await projectEvalBudgets(opts.root);
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	try {
		const runs = await runProbes(module, targets, {
			directory,
			parallel: 1,
			reps: opts.reps,
			skillHash: change.afterHash,
			cliHash: opts.cliHash,
			budget: opts.spending,
			sharedBudget,
			signal: controller.signal,
			stopOnFailure: true,
			reproduction: opts.reproduction,
			experiment: {
				kind: "paired",
				baselineRevision: change.baseline,
				snapshots,
				harnessHash: opts.harnessHash,
				sharedBudget: await sharedBudget.report(),
				ordering: "probe, family, baseline then candidate, repetition",
				authPolicy:
					"native isolated home; explicit Codex home used in place; no copied credentials",
			},
		});
		log.info(`Paired manifest and every cell: ${directory}`);
		log.info(pairedBatchReport(runs));
		if (runs.some((run) => run.result.status !== "pass")) {
			process.exitCode = 1;
		}
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}

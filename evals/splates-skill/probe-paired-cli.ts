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
	unchanged?: boolean;
	plan: boolean;
	/** Start without the terminal confirmation, for a run the user asked an agent to start. */
	yes?: boolean;
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

/** Plan or confirm an admitted experiment with one reservation for every cell. */
export async function pairedCli(
	module: ProbeModule,
	change: SkillChange,
	log: Logger,
	opts: PairOptions,
): Promise<void> {
	const unchanged = opts.unchanged === true;
	const claudeOnly =
		unchanged &&
		opts.targets.length === 1 &&
		opts.targets[0]?.startsWith("claude:");
	if (
		unchanged &&
		(change.files.length ||
			change.beforeHash !== change.afterHash ||
			opts.reps !== 1 ||
			(!claudeOnly && opts.targets.length !== 2) ||
			module.probes.length !== 1 ||
			module.probes[0]?.id !== "decisions/local-choice")
	) {
		throw new Error(
			"Unchanged baseline requires identical snapshots, one Claude target or both native families, local-choice only and --reps 1",
		);
	}
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
		!claudeOnly &&
		(!opts.targets.some((value) => value.startsWith("codex:")) ||
			!opts.targets.some((value) => value.startsWith("claude:")) ||
			opts.targets.some((value) => !/^(codex|claude):/.test(value)))
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
		if (
			unchanged &&
			(probe.bounds.milliseconds > frozen.bounds.milliseconds ||
				probe.bounds.turns > frozen.bounds.turns ||
				probe.bounds.tokens > frozen.bounds.tokens)
		) {
			throw new Error(
				"Unchanged baseline bounds cannot exceed the frozen local-choice limits",
			);
		}
	}
	const targetsFor = (
		snapshots: {
			role: "baseline" | "candidate" | "current";
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
	const planned = targetsFor(
		unchanged
			? [{ role: "current", source: change.skill, hash: change.afterHash }]
			: [
					{ role: "baseline", source: change.skill, hash: change.beforeHash },
					{ role: "candidate", source: change.skill, hash: change.afterHash },
				],
	);
	const jobs = module.probes.flatMap((probe) =>
		planned.flatMap((target) =>
			Array.from({ length: opts.reps }, () => ({ probe, target })),
		),
	);
	const quotes = admit(jobs, opts.spending);
	log.info(
		`${unchanged ? "Unchanged baseline (no candidate comparison)" : "Paired experiment"}: ${jobs.length} cells; baseline ${change.beforeHash}; selected ${change.afterHash}; aggregate reservation ${JSON.stringify(quotes.reduce<Allowance>((sum, value) => ({ tokens: sum.tokens + (value?.tokens ?? 0), microUsd: sum.microUsd + (value?.microUsd ?? 0) }), { tokens: 0, microUsd: 0 }))}. One shared reservation; monitored limits may overshoot, Codex USD unknown.`,
	);
	if (opts.plan) {
		log.info(
			"Plan only: no native startup, authentication, reservation or model execution. Effective versions/models/reasoning and permissions remain unverified.",
		);
		return;
	}
	if (!opts.yes && !process.stdin.isTTY) {
		throw new Error(
			"Paid experiment probes require a terminal and confirmation, or --yes",
		);
	}
	if (
		!opts.yes &&
		prompt(
			`Start this potentially paid ${unchanged ? "unchanged baseline" : "paired experiment"}? [y/N]`,
		)
			?.trim()
			.toLowerCase() !== "y"
	) {
		return;
	}
	await mkdir(opts.directory, { recursive: true });
	const directory = await mkdtemp(join(opts.directory, "experiment-"));
	const snapshots = await freezeSnapshots(change, directory, unchanged);
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
				kind: unchanged ? "unchanged-baseline" : "paired",
				baselineRevision: change.baseline,
				snapshots,
				harnessHash: opts.harnessHash,
				sharedBudget: await sharedBudget.report(),
				ordering: unchanged
					? "local-choice, family, current snapshot, one repetition"
					: "probe, family, baseline then candidate, repetition",
				authPolicy:
					"native isolated home; explicit Codex home used in place; no copied credentials",
			},
		});
		log.info(`Experiment manifest and every cell: ${directory}`);
		log.info(pairedBatchReport(runs));
		if (runs.some((run) => run.result.status !== "pass")) {
			process.exitCode = 1;
		}
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}

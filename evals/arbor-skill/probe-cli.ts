import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { nativeTarget } from "./native-target";
import { cliAdapter } from "./probe-adapters";
import { admit, budget } from "./probe-affordability";
import { evalBudgetCli, projectEvalBudgets } from "./probe-budget-cli";
import { skillChange, smokeProbes } from "./probe-change";
import { probeReport } from "./probe-report";
import {
	configurationHash,
	hash,
	type ProbeModule,
	readRun,
	runProbes,
	type StoredRun,
	type Target,
	validate,
} from "./runner";

const root = resolve(import.meta.dir, "../..");
const defaultDirectory = join(homedir(), ".arbor", "probe-evals");

/** Load selected aspect modules, or discover the local .probes.ts modules when paths is empty. */
export async function loadModules(paths: string[]): Promise<ProbeModule> {
	const discovered = paths.length
		? paths
		: (await readdir(import.meta.dir))
				.filter((path) => path.endsWith(".probes.ts"))
				.sort()
				.map((path) => join(import.meta.dir, path));
	const modules: ProbeModule[] = [];
	for (const path of discovered) {
		modules.push(
			(await import(pathToFileURL(resolve(path)).href)).default as ProbeModule,
		);
	}
	const combined = {
		probes: modules.flatMap((module) => module.probes),
		seeds: modules.flatMap((module) => module.seeds),
	};
	validate(combined.probes);
	return combined;
}

export async function treeHash(directory: string): Promise<string> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: unknown[] = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (["node_modules", ".git", "dist"].includes(entry.name)) {
			continue;
		}
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push([entry.name, await treeHash(path)]);
		} else if (entry.isFile()) {
			files.push([entry.name, hash(await readFile(path, "utf8"))]);
		}
	}
	return hash(files);
}

export async function storedRuns(directory: string): Promise<StoredRun[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				return [];
			}
			throw error;
		},
	);
	const runs: StoredRun[] = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (entry.isDirectory() && entry.name.startsWith("run-")) {
			runs.push(await readRun(join(directory, entry.name, "result.json")));
		}
	}
	return runs;
}

export async function fastCli(
	args: string[],
	log: Logger = new ConsoleLogger(),
): Promise<void> {
	if (args[0] === "budgets") {
		await evalBudgetCli(args.slice(1), root, log);
		return;
	}
	const plannedAt = performance.now();
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			probe: { type: "string", multiple: true },
			kind: { type: "string" },
			aspect: { type: "string", multiple: true },
			requirement: { type: "string", multiple: true },
			module: { type: "string", multiple: true },
			target: { type: "string", multiple: true },
			"skill-mode": { type: "string", default: "discovery" },
			"codex-home": { type: "string" },
			"reserve-tokens": { type: "string", default: "2000" },
			"reserve-usd": { type: "string", default: "0.05" },
			reps: { type: "string", default: "1" },
			parallel: { type: "string", default: "1" },
			baseline: { type: "string" },
			"max-tokens": { type: "string" },
			"max-usd": { type: "string" },
			milliseconds: { type: "string" },
			turns: { type: "string" },
			tokens: { type: "string" },
			skill: { type: "string", default: join(root, "skills/arbor") },
			directory: { type: "string", default: defaultDirectory },
			failed: { type: "boolean", default: false },
			"allow-unmetered": { type: "boolean", default: false },
			help: { type: "boolean", default: false },
		},
	});
	const command = positionals[0] ?? "fast";
	if (values.help) {
		log.info(HELP);
		return;
	}
	if (
		positionals.length > 1 ||
		!["fast", "run", "list", "plan", "report"].includes(command)
	) {
		throw new Error(
			"Select fast, list, plan, report, or explicit e2e. Use --help.",
		);
	}
	if (values.kind !== undefined && !["cli", "agent"].includes(values.kind)) {
		throw new Error("--kind must be cli or agent");
	}
	const directory = resolve(values.directory);
	const parallel = number(values.parallel, 1);
	const spending = budget(values["max-tokens"], values["max-usd"]);
	const reps = number(values.reps, 1);
	const reservation = budget(values["reserve-tokens"], values["reserve-usd"]);
	const mode = values["skill-mode"];
	if (mode !== "discovery" && mode !== "explicit") {
		throw new Error("--skill-mode must be discovery or explicit");
	}
	const selected = (value: {
		id: string;
		aspect: string;
		requirement: { id: string };
		execution: { kind: string };
	}) =>
		(!values.kind || values.kind === value.execution.kind) &&
		(!values.probe?.length || values.probe.includes(value.id)) &&
		(!values.aspect?.length || values.aspect.includes(value.aspect)) &&
		(!values.requirement?.length ||
			values.requirement.includes(value.requirement.id));
	if (command === "report") {
		const runs = (await storedRuns(directory)).filter(
			(run) =>
				selected(run.probe) && (!values.failed || run.result.status !== "pass"),
		);
		log.info(probeReport(runs));
		return;
	}
	const module = await loadModules(values.module ?? []);
	for (const [flag, selectors, known] of [
		["probe", values.probe, module.probes.map((probe) => probe.id)],
		["aspect", values.aspect, module.probes.map((probe) => probe.aspect)],
		[
			"requirement",
			values.requirement,
			module.probes.map((probe) => probe.requirement.id),
		],
	] as const) {
		for (const selector of selectors ?? []) {
			if (!known.includes(selector)) {
				throw new Error(`unknown ${flag}: ${selector}`);
			}
		}
	}
	module.probes = module.probes.filter(selected).map((probe) => ({
		...probe,
		bounds: {
			milliseconds: number(values.milliseconds, probe.bounds.milliseconds),
			turns: number(values.turns, probe.bounds.turns),
			tokens: number(values.tokens, probe.bounds.tokens),
		},
	}));
	if (command === "list") {
		log.info(
			module.probes
				.map(
					(probe) =>
						`${probe.id}\t${probe.aspect}\t${probe.requirement.id}\t${probe.execution.kind}`,
				)
				.join("\n") ||
				"No probes registered. Add an aspect .probes.ts module or select --module PATH.",
		);
		return;
	}
	if (!module.probes.length) {
		throw new Error(
			"No probes selected. Add an aspect .probes.ts module or select --module PATH.",
		);
	}
	const skill = resolve(values.skill);
	let baseline: string | undefined;
	const hasAgents = module.probes.some(
		(probe) => probe.execution.kind === "agent",
	);
	if (hasAgents) {
		if (values["allow-unmetered"]) {
			throw new Error(
				"--allow-unmetered is forbidden for model execution: declared native controls and aggregate reservations are required",
			);
		}
		const change = await skillChange(skill, values.baseline);
		baseline = change.baseline;
		log.info(
			`Skill baseline ${baseline}; ${change.beforeHash} -> ${change.afterHash}; changed: ${change.files.join(", ") || "none"}`,
		);
		if (!change.files.length) {
			log.info(
				"Skipped model execution: Arbor skill/references unchanged. Zero model requests.",
			);
			return;
		}
		if (
			!values.probe?.length &&
			!values.aspect?.length &&
			!values.requirement?.length &&
			!values.failed
		) {
			module.probes = smokeProbes(module.probes, change.files);
		}
		// A per-probe limit can only be smaller than the aggregate invocation cap.
		module.probes = module.probes.map((probe) => ({
			...probe,
			bounds: {
				...probe.bounds,
				tokens: Math.min(probe.bounds.tokens, spending.tokens),
			},
		}));
	}

	log.info(
		`Selected: ${module.probes.map((probe) => probe.id).join(", ")}; reps ${reps}; parallel ${parallel}; aggregate admission limits ${spending.tokens} tokens / USD ${(spending.microUsd / 1000000).toFixed(6)}`,
	);
	if (command === "plan") {
		log.info(
			"Plan only: no authentication/model execution. Native tokens are monitored; USD is monitored for Claude/OpenCode and unavailable for Codex. In-flight work may overshoot; billing is incomplete and reservations remain outstanding.",
		);
		return;
	}
	const [skillHash, cliHash] = await Promise.all([
		treeHash(skill),
		treeHash(join(root, "packages/arbor")),
	]);
	const targets: Target[] = [];
	for (const value of values.target ?? []) {
		const target = nativeTarget(value, {
			source: skill,
			mode,
			allowance: reservation,
			codexHome: values["codex-home"]
				? resolve(values["codex-home"])
				: undefined,
		});
		if (
			targets.some(
				(each) =>
					each.adapter.id === target.adapter.id && each.model === target.model,
			)
		) {
			throw new Error(`duplicate target: ${value}`);
		}
		targets.push(target);
	}
	if (
		module.probes.some((probe) => probe.execution.kind === "agent") &&
		!targets.length
	) {
		throw new Error(
			"Agent probes require explicit --target agent:model (repeat for comparisons)",
		);
	}
	if (!targets.length) {
		targets.push({ adapter: cliAdapter, model: null });
	}
	let previous: StoredRun[] | undefined;
	if (values.failed) {
		previous = (await storedRuns(directory)).filter(
			(run) =>
				run.result.status !== "pass" &&
				run.run.identity.skillHash === skillHash &&
				run.run.identity.cliHash === cliHash,
		);
		module.probes = module.probes.filter((probe) =>
			previous?.some((run) => hash(run.probe) === hash(probe)),
		);
		if (!module.probes.length) {
			throw new Error(
				"No compatible non-passing probes to rerun; changed skill/CLI/cases require a fresh selection.",
			);
		}
	}
	if (module.probes.some((probe) => probe.execution.kind === "agent")) {
		admit(
			module.probes.flatMap((probe) =>
				targets.flatMap((target) =>
					Array.from({ length: reps }, () => ({ probe, target })),
				),
			),
			spending,
		);
		if (!process.stdin.isTTY) {
			throw new Error("Paid agent probes require a terminal and confirmation");
		}
		log.info(
			`${module.probes.length} probes, ${targets.length} targets, ${values.reps} repetitions; parallel ${values.parallel}. Aggregate admission limits: ${spending.tokens} tokens, USD ${(spending.microUsd / 1000000).toFixed(6)}. Per-session reservation: up to ${reservation.tokens} tokens / USD ${(reservation.microUsd / 1000000).toFixed(6)}. Tokens monitored; Claude/OpenCode USD monitored; Codex USD unavailable. In-flight overshoot is possible. All drivers report incomplete billing: shared reservations remain outstanding, even on success, and can indefinitely exhaust a window. No live affordability or full adherence claim.`,
		);
		if (
			prompt("Start these potentially paid agent probes? [y/N]")
				?.trim()
				.toLowerCase() !== "y"
		) {
			return;
		}
	}
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	try {
		const reproduction = [
			"bin/wiz",
			"dev",
			"eval",
			"fast",
			"--skill",
			skill,
			"--directory",
			directory,
			"--skill-mode",
			mode,
			"--reserve-tokens",
			String(reservation.tokens),
			"--reserve-usd",
			(reservation.microUsd / 1000000).toFixed(6),
			...(values["codex-home"]
				? ["--codex-home", resolve(values["codex-home"])]
				: []),
			...(values.module?.flatMap((path) => ["--module", resolve(path)]) ?? []),
			...(baseline
				? [
						"--baseline",
						baseline,
						"--max-tokens",
						String(spending.tokens),
						"--max-usd",
						(spending.microUsd / 1000000).toFixed(6),
					]
				: []),
			...["milliseconds", "turns", "tokens"].flatMap((key) => {
				const value = values[key as "milliseconds" | "turns" | "tokens"];
				return value ? [`--${key}`, value] : [];
			}),
		];
		log.info(
			`Planning/identity capture: ${Math.round(performance.now() - plannedAt)}ms`,
		);
		const runs = await runProbes(module, targets, {
			directory,
			parallel,
			reps,
			skillHash,
			cliHash,
			allowUnmetered: false,
			budget: spending,
			sharedBudget: module.probes.some(
				(probe) => probe.execution.kind === "agent",
			)
				? await projectEvalBudgets(root)
				: undefined,
			signal: controller.signal,
			reproduction,
			include: (probe, target) =>
				previous === undefined ||
				previous.some(
					(run) =>
						run.probe.id === probe.id &&
						run.run.identity.model === target.model &&
						run.run.identity.adapterVersion ===
							`${target.adapter.id}@${target.adapter.version}` &&
						run.run.identity.fixtureHash ===
							hash([
								probe.seed,
								module.seeds.find(
									(seed) =>
										seed.id === probe.seed.id &&
										seed.version === probe.seed.version,
								)?.fingerprint,
							]) &&
						run.run.identity.configHash ===
							configurationHash(probe, target, values["allow-unmetered"]),
				),
			completed(run, path) {
				log.info(
					`${run.probe.id} ${run.agent}/${run.run.identity.model ?? "none"} rep ${run.run.identity.repetition + 1}: ${run.result.status} (${Math.round(run.run.usage.milliseconds)}ms) ${path}`,
				);
			},
		});
		if (!runs.length) {
			throw new Error(
				"No compatible failed combinations selected; adapter/config/fixture changed. Use a fresh selection.",
			);
		}
		log.info(probeReport(runs));
		if (runs.some((run) => run.result.status !== "pass")) {
			process.exitCode = 1;
		}
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}
function number(value: string | undefined, fallback: number): number {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`expected positive integer, got ${value}`);
	}
	return parsed;
}
const HELP = `bin/wiz dev eval [fast|list|plan|report] [options]
  --probe ID | --aspect NAME | --requirement ID (repeatable; groups intersect)
  --kind cli|agent        select local CLI checks or agent probes
  --module PATH            explicit ProbeModule; default discovers *.probes.ts
  budgets [set <tokens/window|nothing>|reset] [--format json]  free shared token budget controls
  --target agent:model     native claude:MODEL, codex:MODEL, opencode:PROVIDER/MODEL (repeat)
  --skill-mode discovery|explicit  native skill loading (default discovery)
  --codex-home PATH        existing native auth/config in place; may write runtime metadata
  --reserve-tokens 2000 --reserve-usd 0.05  per-session reservation, not estimated price
  --parallel 1 --reps 1    bounded independent combinations
  --milliseconds N --turns N --tokens N   override each probe's bounds
  --baseline REV          required Git baseline for skill/reference change gate
  --max-tokens 4000 --max-usd 0.10  aggregate admission limits (configuration maxima 10000 / 0.25)
  --allow-unmetered        rejected for model execution
  --failed                 rerun compatible non-passing probes; report filters non-passes
  --skill DIR --directory DIR
  plan                     free change-gated smoke selection; no model launch
  report                   read-only deterministic report, no agent or grader
  e2e report ...           free saved legacy reports; execution lacks enforced metering`;

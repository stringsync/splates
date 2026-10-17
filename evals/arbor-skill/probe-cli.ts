import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Roster } from "@webappwiz/arbor/probe-runtime";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { acpAdapter, cliAdapter } from "./probe-adapters";
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
	const plannedAt = performance.now();
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			probe: { type: "string", multiple: true },
			aspect: { type: "string", multiple: true },
			requirement: { type: "string", multiple: true },
			module: { type: "string", multiple: true },
			target: { type: "string", multiple: true },
			reps: { type: "string", default: "1" },
			parallel: { type: "string", default: "2" },
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
		!["fast", "run", "list", "report"].includes(command)
	) {
		throw new Error("Select fast, list, report, or explicit e2e. Use --help.");
	}
	const directory = resolve(values.directory);
	const parallel = number(values.parallel, 2);
	const reps = number(values.reps, 1);
	const selected = (value: {
		id: string;
		aspect: string;
		requirement: { id: string };
	}) =>
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
	const [skillHash, cliHash] = await Promise.all([
		treeHash(skill),
		treeHash(join(root, "packages/arbor")),
	]);
	const roster = values.target?.length
		? await new Roster(
				join(
					process.env.ARBOR_HOME ?? join(homedir(), ".arbor"),
					"agents.json",
				),
				{ fs: new NodeFs() },
			).agents()
		: [];
	const targets: Target[] = [];
	for (const value of values.target ?? []) {
		const [id, ...modelParts] = value.split(":");
		const model = modelParts.join(":");
		if (!id || !model) {
			throw new Error("--target requires agent:model");
		}
		const agent = roster.find((each) => each.id === id);
		if (!agent) {
			throw new Error(`unknown configured agent: ${id}`);
		}
		if (
			agent.models.length &&
			!agent.models.some((each) => each.id === model)
		) {
			throw new Error(`unknown model ${model} for ${id}`);
		}
		if (
			targets.some((each) => each.adapter.id === id && each.model === model)
		) {
			throw new Error(`duplicate target: ${value}`);
		}
		targets.push({ adapter: acpAdapter(agent, skill), model });
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
		if (!process.stdin.isTTY) {
			throw new Error("Paid agent probes require a terminal and confirmation");
		}
		log.info(
			`${module.probes.length} probes, ${targets.length} targets, ${values.reps} repetitions; parallel ${values.parallel}. Bounds are per probe, not a total spend cap. ACP cannot enforce token/spend limits. Authentication and native tools may be unsupported in isolated homes.`,
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
			...(values.module?.flatMap((path) => ["--module", resolve(path)]) ?? []),
			...(values["allow-unmetered"] ? ["--allow-unmetered"] : []),
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
			allowUnmetered: values["allow-unmetered"],
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
const HELP = `bin/wiz dev eval [fast|list|report] [options]
  --probe ID | --aspect NAME | --requirement ID (repeatable; groups intersect)
  --module PATH            explicit ProbeModule; default discovers *.probes.ts
  --target agent:model     repeat to compare configured ACP agents
  --parallel 2 --reps 1    bounded independent combinations
  --milliseconds N --turns N --tokens N   override each probe's bounds
  --allow-unmetered        explicitly accept adapters without hard token bounds
  --failed                 rerun compatible non-passing probes; report filters non-passes
  --skill DIR --directory DIR
  report                   read-only deterministic report, no agent or grader
  e2e [run|report] ...      explicit legacy end-to-end suite (may use an LLM grader)`;

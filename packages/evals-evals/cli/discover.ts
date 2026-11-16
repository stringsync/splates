import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { dependencyFingerprint } from "../fingerprint";
import { judgePickOf } from "../judge";
import type { Label } from "../labels";
import type { MakeSandbox } from "../sandbox";
import type { Scenario } from "../scenario";

/** A scenario and the skill directory it checks. */
export interface Found {
	scenario: Scenario;
	/** Optional sandbox factory exported by this scenario file. */
	sandbox?: MakeSandbox;
	/** The skill's name, its folder under `skills/`. */
	skill: string;
	/** The skill directory the agent is given. */
	dir: string;
	/** The file that declares it, relative to the root searched. */
	file: string;
}

const SKIPPED = new Set(["node_modules", ".git"]);

/** Every `<anything>/skills/<skill>/evals/*.ts` under `root`, tests aside. */
export async function scenarioFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			if (SKIPPED.has(entry.name) || entry.name.endsWith(".noindex")) {
				continue;
			}
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path);
			} else if (isScenarioFile(relative(root, path))) {
				found.push(path);
			}
		}
	};
	await walk(root);
	return found.sort();
}

/** Loads the scenarios each file exports as `scenarios`, in file order. */
export async function discover(root: string): Promise<Found[]> {
	const found: Found[] = [];
	for (const file of await scenarioFiles(root)) {
		const module = (await import(file)) as {
			scenarios?: Scenario[];
			sandbox?: MakeSandbox;
		};
		const dependencies = await helperSources(file);
		const dir = dirname(dirname(file));
		for (const scenario of module.scenarios ?? []) {
			const tracked = { ...scenario };
			dependencyFingerprint.set(tracked, dependencies);
			found.push({
				scenario: tracked,
				...(module.sandbox === undefined ? {} : { sandbox: module.sandbox }),
				skill: basename(dir),
				dir,
				file: relative(root, file),
			});
		}
	}
	return found;
}

/** A label and the folder of the evals file that exports it. */
export interface Labelled {
	label: Label;
	base: string;
	file: string;
}

/** Every label the evals files export as `labels`. */
export async function discoverLabels(root: string): Promise<Labelled[]> {
	const out: Labelled[] = [];
	for (const file of await scenarioFiles(root)) {
		const module = (await import(file)) as { labels?: Label[] };
		for (const label of module.labels ?? []) {
			out.push({ label, base: dirname(file), file: relative(root, file) });
		}
	}
	return out;
}

/** What is wrong with `found`, one line each: the problems `evals check` reports. */
export function problems(found: readonly Found[]): string[] {
	const out: string[] = [];
	const seen = new Map<string, Found>();
	for (const each of found) {
		const { scenario, file } = each;
		const at = `${file}: ${scenario.id}`;
		const before = seen.get(scenario.id);
		if (before !== undefined) {
			out.push(`${at}: id also declared in ${before.file}`);
		}
		seen.set(scenario.id, each);
		if (!scenario.id.startsWith(`${scenario.aspect}/`)) {
			out.push(`${at}: id should be ${scenario.aspect}/<name>`);
		}
		if (scenario.requirement.trim() === "") {
			out.push(`${at}: requirement is empty`);
		}
		if (scenario.message.trim() === "") {
			out.push(`${at}: message is empty`);
		}
		if ((scenario.checks ?? []).length === 0 && scenario.judge === undefined) {
			out.push(`${at}: no checks and no judge, so nothing can fail`);
		}
		if (scenario.judgeWith !== undefined) {
			if (scenario.judge === undefined) {
				out.push(`${at}: judgeWith names a judge but there is no rubric`);
			}
			try {
				judgePickOf(scenario.judgeWith);
			} catch (error) {
				out.push(`${at}: ${error instanceof Error ? error.message : error}`);
			}
		}
		const ids = (scenario.checks ?? []).map((check) => check.id);
		if (new Set(ids).size !== ids.length) {
			out.push(`${at}: duplicate check ids`);
		}
	}
	return out;
}

function isScenarioFile(path: string): boolean {
	const parts = path.split("/");
	const name = parts.at(-1) ?? "";
	return (
		parts.length >= 4 &&
		parts.at(-2) === "evals" &&
		parts.at(-4) === "skills" &&
		name.endsWith(".ts") &&
		!name.endsWith(".test.ts")
	);
}

/** Runtime imports only; type imports cannot affect a verdict. Cycles are visited once. */
async function helperSources(entry: string): Promise<string[]> {
	const seen = new Set<string>([entry]);
	const sources: string[] = [];
	const scanner = new Bun.Transpiler({ loader: "tsx" });
	async function walk(file: string): Promise<void> {
		const source = await readFile(file, "utf8");
		if (file !== entry) {
			sources.push(source);
		}
		if (!/\.[cm]?[jt]sx?$/.test(file)) {
			return;
		}
		for (const imported of scanner.scanImports(source)) {
			const resolved = Bun.resolveSync(imported.path, dirname(file));
			if (!resolved.startsWith("/") || seen.has(resolved)) {
				continue;
			}
			seen.add(resolved);
			await walk(resolved);
		}
	}
	await walk(entry);
	return sources.sort();
}

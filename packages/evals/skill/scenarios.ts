import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Scenario } from "@splates/skill-evals/scenario";

// The skill's own evals folder, where `bin/evals` finds the same scenarios:
// each file there exporting `scenarios` is an aspect, so a new file shows on
// the Evals page without being listed anywhere.
const EVALS = resolve(import.meta.dir, "../../../skills/splates/evals");

/** Every scenario of the splates skill, for `list`, `plan` and `run` to pick from. */
export const SCENARIOS: readonly Scenario[] = await load(EVALS);

async function load(dir: string): Promise<Scenario[]> {
	const files = (await readdir(dir))
		.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
		.sort();
	const found: Scenario[] = [];
	for (const name of files) {
		const module = (await import(join(dir, name))) as {
			scenarios?: Scenario[];
		};
		found.push(...(module.scenarios ?? []));
	}
	return found;
}

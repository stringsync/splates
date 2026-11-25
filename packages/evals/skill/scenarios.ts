import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Scenario } from "@splates/skill-evals/scenario";

// The skill's own evals folder, where `bin/evals` finds the same scenarios:
// each file there exporting `scenarios` is an aspect, so a new file shows on
// the Evals page without being listed anywhere.
const EVALS = resolve(import.meta.dir, "../../../skills/splates/evals");

/** Each scenario's id to the file under the skill's evals folder that holds it, as an absolute path. */
const FILES = new Map<string, string>();

/** Every scenario of the splates skill, for `list`, `plan` and `run` to pick from. */
export const SCENARIOS: readonly Scenario[] = await load(EVALS);

/** The absolute path of the file that holds scenario `id`, or undefined for one no file holds. */
export function fileOf(id: string): string | undefined {
	return FILES.get(id);
}

async function load(dir: string): Promise<Scenario[]> {
	const files = (await readdir(dir))
		.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
		.sort();
	const found: Scenario[] = [];
	for (const name of files) {
		const module = (await import(join(dir, name))) as {
			scenarios?: Scenario[];
		};
		for (const each of module.scenarios ?? []) {
			FILES.set(each.id, join(dir, name));
			found.push(each);
		}
	}
	return found;
}

import type { RunVerdicts } from "./batch";
import { total } from "./results";

/**
 * The kept runs as a table per scenario: each check's passes over the runs
 * it applied to, a column per variant, then the skill files read and what
 * the runs cost.
 */
export function report(runs: RunVerdicts[], variants: string[]): string {
	const out: string[] = [];
	const width = Math.max(10, ...variants.map((each) => each.length)) + 2;
	const row = (name: string, cells: string[]) =>
		`  ${name.padEnd(NAME)}${cells.map((cell) => cell.padEnd(width)).join("")}`.trimEnd();
	for (const scenario of [...new Set(runs.map((each) => each.scenario))]) {
		const of = runs.filter((each) => each.scenario === scenario);
		const by = variants.map((variant) =>
			of.filter((each) => each.variant === variant),
		);
		out.push(
			`${scenario}`,
			row(
				"",
				variants.map((variant, index) => `${variant} (${by[index]?.length})`),
			),
		);
		for (const kind of ["checks", "model"] as const) {
			const ids = [...new Set(of.flatMap((each) => Object.keys(each[kind])))];
			for (const id of ids) {
				out.push(
					row(
						kind === "model" ? `${id} (model)` : id,
						by.map((each) => rate(each.map((run) => run[kind][id] ?? null))),
					),
				);
			}
		}
		const read = [...new Set(of.flatMap((each) => each.reads))];
		for (const path of read) {
			out.push(
				row(
					`read ${path}`,
					by.map(
						(each) =>
							`${each.filter((run) => run.reads.includes(path)).length}/${each.length}`,
					),
				),
			);
		}
		out.push(
			row(
				"cost",
				by.map(
					(each) =>
						`$${each.reduce((sum, run) => sum + total(run.usage), 0).toFixed(2)}`,
				),
			),
			"",
		);
	}
	return out.join("\n");
}

/** How wide the column of check names is. */
const NAME = 30;

/** Passes over the runs a check applied to; "-" where it applied to none. */
function rate(verdicts: (boolean | null)[]): string {
	const applied = verdicts.filter((each) => each !== null);
	return applied.length === 0
		? "-"
		: `${applied.filter(Boolean).length}/${applied.length}`;
}

import { hash, type StoredRun } from "./runner";

/** Model/adapter and repetition may vary; everything evaluated must be identical. */
export function comparisonKey(value: StoredRun): string {
	const {
		model: _,
		repetition: __,
		adapterVersion: ___,
		configHash: ____,
		...identity
	} = value.run.identity;
	return hash([identity, value.probe, value.conditions]);
}

/** Keep incompatible cases apart, including old fixtures/assertions/CLI/skill/budgets. */
export function probeReport(values: StoredRun[]): string {
	const groups = new Map<string, StoredRun[]>();
	for (const value of values) {
		const key = comparisonKey(value);
		const group = groups.get(key) ?? [];
		group.push(value);
		groups.set(key, group);
	}
	const lines = [
		"Requirement | Probe | Agent/model | Outcomes | ms | tokens | USD | overhead ms",
	];
	for (const [key, group] of groups) {
		const models = new Map<string, StoredRun[]>();
		for (const value of group) {
			const label = `${value.run.identity.adapterVersion}/${value.run.identity.model ?? "none"} [${value.run.identity.configHash.slice(0, 8)}/${hash(value.adapter.runtime).slice(0, 8)}]`;
			models.set(label, [...(models.get(label) ?? []), value]);
		}
		for (const [model, runs] of models) {
			const first = runs[0] as StoredRun;
			const outcomes = new Map<string, number>();
			for (const run of runs) {
				outcomes.set(
					run.result.status,
					(outcomes.get(run.result.status) ?? 0) + 1,
				);
			}
			const sum = (read: (run: StoredRun) => number | null): string =>
				runs.some((run) => read(run) === null)
					? "unknown"
					: runs.reduce((total, run) => total + (read(run) ?? 0), 0).toFixed(2);
			lines.push(
				`${first.probe.requirement.id} | ${first.probe.id} [${key.slice(0, 8)}] | ${model} | ${[...outcomes].map(([status, count]) => `${status}:${count}`).join(" ")} | ${sum((run) => run.run.usage.milliseconds)} | ${sum((run) => run.run.usage.tokens)} | ${sum((run) => run.run.usage.costUsd)} | ${sum((run) => run.overheadMs)}`,
			);
			for (const run of runs) {
				lines.push(
					`  rep ${run.run.identity.repetition + 1}: ${run.result.status}${run.result.detail ? ` (${run.result.detail})` : ""}`,
				);
				lines.push(
					`    ${run.run.usage.milliseconds.toFixed(1)}ms; tokens ${run.run.usage.tokens ?? "unknown"}; USD ${run.run.usage.costUsd ?? "unknown"}; overhead ${run.overheadMs.toFixed(1)}ms`,
				);
				if (run.adapter.runtime.reserved) {
					lines.push(
						`    reserved allowance (not a billing ceiling): ${JSON.stringify(run.adapter.runtime.reserved)}; aggregate admission limit: ${JSON.stringify(run.adapter.runtime.aggregateBudget)}; modes: ${JSON.stringify(run.adapter.runtime.limitModes)}; overshoot: ${JSON.stringify(run.adapter.runtime.overshoot)}`,
					);
				}
				if (run.adapter.runtime.nativeUsageComplete === false) {
					lines.push(
						"    Billing incomplete: shared reservation remains outstanding even on success; windows/reset do not release it. Reported usage is not total billing or proof of cheapness.",
					);
				}
				for (const verdict of run.result.verdicts) {
					lines.push(
						`    ${verdict.id}: ${verdict.status}; expected ${JSON.stringify(verdict.expected)}; actual ${JSON.stringify(verdict.actual)}; evidence ${verdict.evidence.join(",")}`,
					);
				}
				for (const warning of run.warnings) {
					lines.push(`    ${warning}`);
				}
				lines.push(
					`    reproduce: ${run.run.reproduction.map(quote).join(" ")}`,
				);
			}
		}
	}
	if (!values.length) {
		lines.push("No runs selected.");
	}
	return lines.join("\n");
}
function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

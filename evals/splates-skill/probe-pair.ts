import type { Json } from "./probe";
import { hash, type StoredRun } from "./probe-record";
import { probeReport } from "./probe-report";

/** Offline inspection only. This neither admits nor launches either snapshot. */
export function pairedReport(
	baseline: StoredRun,
	candidate: StoredRun,
): string {
	const differences = pairedDifferences(baseline, candidate);
	return [
		`Baseline ${baseline.run.identity.skillHash}; candidate ${candidate.run.identity.skillHash}`,
		differences.length
			? `Incompatible pair: ${differences.join(", ")}`
			: "Recorded controls match; runtime compatibility and execution admission remain unverified.",
		"Baseline:",
		probeReport([baseline]),
		"Candidate:",
		probeReport([candidate]),
	].join("\n");
}

/** Only skill identity/source may differ. Do not pool families, models or repeats. */
export function pairedDifferences(
	baseline: StoredRun,
	candidate: StoredRun,
): string[] {
	const differences: string[] = [];
	if (baseline.run.identity.skillHash === candidate.run.identity.skillHash) {
		differences.push("identical skill snapshots");
	}
	const controls = (value: StoredRun) => {
		const { skillHash: _, configHash: __, ...identity } = value.run.identity;
		return {
			identity,
			probe: value.probe,
			agent: value.agent,
			conditions: value.conditions,
			adapterVersion: value.adapter.version,
			adapterConfig: withoutSkillSource(value.adapter.config),
			reservation: value.adapter.runtime.reserved ?? null,
			aggregateBudget: value.adapter.runtime.aggregateBudget ?? null,
			limitModes: value.adapter.runtime.limitModes ?? null,
			nativeConfiguration: nativeConfiguration(value),
		};
	};
	const before = controls(baseline);
	const after = controls(candidate);
	for (const key of Object.keys(before) as (keyof typeof before)[]) {
		if (hash(before[key]) !== hash(after[key])) {
			differences.push(key);
		}
	}
	return differences;
}

function withoutSkillSource(config: Json): Json {
	if (config === null || typeof config !== "object" || Array.isArray(config)) {
		return config;
	}
	const skill = config.skill;
	if (skill === null || typeof skill !== "object" || Array.isArray(skill)) {
		return config;
	}
	const { source: _, expectedHash: __, ...rest } = skill;
	return { ...config, skill: rest };
}

/** Retain every cell; missing or duplicate counterparts never imply an improvement. */
export function pairedBatchReport(values: StoredRun[]): string {
	const groups = new Map<string, StoredRun[]>();
	const unpaired: StoredRun[] = [];
	const current: StoredRun[] = [];
	for (const value of values) {
		if (!value.adapter.runtime.snapshot) {
			unpaired.push(value);
			continue;
		}
		if (
			hash(value.adapter.runtime.snapshot) ===
			hash({ role: "current", hash: value.run.identity.skillHash })
		) {
			current.push(value);
			continue;
		}
		const key = hash([
			value.adapter.runtime.experiment,
			value.probe.id,
			value.agent,
			value.run.identity.model,
			value.run.identity.repetition,
		]);
		groups.set(key, [...(groups.get(key) ?? []), value]);
	}
	const lines: string[] = [];
	if (current.length) {
		lines.push(
			"Unchanged baseline evidence; no candidate comparison or improvement claim.",
			probeReport(current),
		);
	}
	for (const group of groups.values()) {
		const role = (run: StoredRun, name: string) =>
			hash(run.adapter.runtime.snapshot) ===
			hash({ role: name, hash: run.run.identity.skillHash });
		const before = group.filter((run) => role(run, "baseline"));
		const after = group.filter((run) => role(run, "candidate"));
		if (before.length === 1 && after.length === 1 && group.length === 2) {
			lines.push(pairedReport(before[0] as StoredRun, after[0] as StoredRun));
		} else {
			lines.push(
				"Incomplete or duplicate pair; no comparison claim.",
				probeReport(group),
			);
		}
	}
	if (unpaired.length) {
		lines.push(probeReport(unpaired));
	}
	return lines.join("\n");
}

function nativeConfiguration(value: StoredRun): Json {
	const runtime = value.adapter.runtime;
	const codex = runtime.codex;
	const resolved =
		codex && typeof codex === "object" && !Array.isArray(codex) ? codex : {};
	return {
		codexVersion: runtime.codexVersion ?? null,
		codexModel: resolved.model ?? null,
		codexReasoning: resolved.reasoning ?? null,
		claudeVersion: runtime.claudeVersion ?? null,
		claudeModel: runtime.claudeModel ?? null,
		claudeReasoning: runtime.claudeReasoning ?? null,
	};
}

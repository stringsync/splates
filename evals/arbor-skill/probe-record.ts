import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import {
	assess,
	type Event,
	type Evidence,
	type Json,
	type Probe,
	type ProbeIsolation,
	type ProbeResult,
	type ProbeRun,
} from "./probe";
import type { Allowance, Metering } from "./probe-affordability";
import { evidenceSchema, probeSchema } from "./probe-schema";

export function hash(value: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonical);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonical(item)]),
		);
	}
	return value;
}
export function validate(probes: Probe[]): void {
	const ids = new Set<string>();
	for (const probe of probes) {
		const parsed = probeSchema.safeParse(probe);
		if (!parsed.success) {
			throw new Error(`invalid probe ${probe.id}: ${parsed.error.message}`);
		}
		if (
			probe.schema !== 1 ||
			!probe.id ||
			!probe.version ||
			ids.has(probe.id)
		) {
			throw new Error(`invalid or duplicate probe: ${probe.id}`);
		}
		ids.add(probe.id);
		if (
			!probe.seed.id ||
			!probe.seed.version ||
			!probe.requirement.id ||
			!probe.aspect
		) {
			throw new Error(`missing identity: ${probe.id}`);
		}
		for (const bound of Object.values(probe.bounds)) {
			if (!Number.isSafeInteger(bound) || bound <= 0) {
				throw new Error(`invalid bounds: ${probe.id}`);
			}
		}
		if (Object.keys(probe.bounds).length !== 3) {
			throw new Error(`missing bounds: ${probe.id}`);
		}
		const assertions = new Set<string>();
		for (const assertion of probe.assertions) {
			if (
				!assertion.id ||
				assertion.id.startsWith("$runner/") ||
				assertions.has(assertion.id)
			) {
				throw new Error(`duplicate assertion: ${probe.id}/${assertion.id}`);
			}
			assertions.add(assertion.id);
			if (
				assertion.kind === "count" &&
				(!Number.isSafeInteger(assertion.min) ||
					assertion.min < 0 ||
					(assertion.max !== undefined &&
						(!Number.isSafeInteger(assertion.max) ||
							assertion.max < assertion.min)))
			) {
				throw new Error(`invalid count: ${assertion.id}`);
			}
		}
		if (
			probe.execution.kind === "cli" &&
			probe.execution.command.length === 0
		) {
			throw new Error(`empty command: ${probe.id}`);
		}
	}
}

export async function readRun(path: string): Promise<StoredRun> {
	const value = JSON.parse(await readFile(path, "utf8")) as StoredRun;
	if (value.schema !== 1 || value.run?.schema !== 1) {
		throw new Error(`unsupported result schema: ${path}`);
	}
	validate([value.probe]);
	evidenceSchema.parse(value.run.evidence);
	if (
		new Set(value.run.evidence.events.map((event) => event.id)).size !==
		value.run.evidence.events.length
	) {
		throw new Error(`duplicate stored event ids: ${path}`);
	}
	if (
		value.run.identity.probe !== value.probe.id ||
		value.run.identity.probeVersion !== value.probe.version ||
		value.run.identity.assertionHash !== hash(value.probe.assertions) ||
		value.run.identity.configHash !==
			hash([value.probe, value.adapter.config, value.conditions.allowUnmetered])
	) {
		throw new Error(`result identity mismatch: ${path}`);
	}
	return { ...value, result: assessRun(value.probe, value.run.evidence) };
}

export function configurationHash(
	probe: Probe,
	target: Target,
	allowUnmetered: boolean,
): string {
	return hash([probe, target.adapter.config, allowUnmetered]);
}
/** Missing declared channels are gaps even when no assertion happens to use them. */
export function assessRun(probe: Probe, evidence: Evidence): ProbeResult {
	const result = assess(probe, evidence);
	for (const channel of new Set(probe.evidence)) {
		if (!evidence.complete.includes(channel)) {
			result.verdicts.push({
				id: `$runner/complete/${channel}`,
				status: "uncovered",
				expected: `complete ${channel}`,
				actual: null,
				evidence: [],
			});
		}
	}
	if (
		result.status === "pass" &&
		result.verdicts.some((verdict) => verdict.status === "uncovered")
	) {
		result.status = "uncovered";
	}
	return result;
}
export async function saveResult(
	path: string,
	value: StoredRun,
): Promise<void> {
	await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2));
	await rename(`${path}.tmp`, path);
}

/** Export the probes and versioned seeds belonging to one aspect. */
export interface ProbeModule {
	probes: Probe[];
	seeds: Seed[];
}
export interface Seed {
	id: string;
	version: string;
	/** A hash or version identifying the seed implementation and its helpers. */
	fingerprint: string;
	prepare(context: RunContext, data: Json): Promise<void>;
	observe(context: RunContext): Promise<Record<string, Json>>;
}
export interface Adapter {
	id: string;
	version: string;
	config: Json;
	/** A missing hard token bound requires an explicit opt-in per invocation. */
	tokenBound: boolean;
	/** Optional trusted provider integration. CLI refuses model calls without it. */
	metering?: Metering;
	run(context: RunContext, model: string | null): Promise<void>;
}
export interface Target {
	adapter: Adapter;
	model: string | null;
}
export interface RunContext {
	probe: Probe;
	isolation: ProbeIsolation;
	signal: AbortSignal;
	env: Record<string, string>;
	evidence: Evidence;
	usage: ProbeRun["usage"];
	runtime: Record<string, Json>;
	emit(event: Event): void;
	reply(text: string): void;
	trace(value: unknown): void;
	/** Arrange for a resource to be released on stop, cancellation or error; call before awaiting work. */
	cleanup(dispose: () => void | Promise<void>): void;
	/** Bind a fresh port and keep ownership until cleanup, never scan for free ports. */
	listen(fetch: (request: Request) => Response | Promise<Response>): number;
}
export interface StoredRun {
	schema: 1;
	probe: Probe;
	agent: string;
	run: ProbeRun;
	result: ProbeResult;
	overheadMs: number;
	warnings: string[];
	conditions: { allowUnmetered: boolean };
	adapter: { version: string; config: Json; runtime: Record<string, Json> };
}
export interface RunOptions {
	directory: string;
	parallel: number;
	reps: number;
	skillHash: string;
	cliHash: string;
	allowUnmetered?: boolean;
	/** Mandatory in the model CLI; low-level synthetic runner tests may omit it. */
	budget?: Allowance;
	signal?: AbortSignal;
	reproduction: string[];
	include?: (probe: Probe, target: Target) => boolean;
	completed?: (run: StoredRun, path: string) => void;
}

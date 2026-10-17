import { isDeepStrictEqual } from "node:util";
import { stretches } from "@webappwiz/arbor/asked";

/** Define one bounded skill requirement to check against a seeded environment. */
export interface Probe {
	schema: 1;
	id: string;
	version: string;
	requirement: { id: string; text: string; source: string };
	aspect: string;
	seed: { id: string; version: string; data: Json };
	input: {
		kind: "message" | "directive";
		text: string;
		origin: "user" | "cli";
	};
	tools: string[];
	evidence: Channel[];
	assertions: Assertion[];
	stop: { kind: "reply" } | { kind: "event"; match: Match };
	bounds: { milliseconds: number; turns: number; tokens: number };
	execution:
		| { kind: "cli"; command: string[] }
		| { kind: "agent"; skill: string };
}
export type Json =
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [key: string]: Json };
export type Channel = "events" | "state" | "reply";
/** Events come from instrumentation, never from parsing proposed shell text. */
export interface Event {
	id: string;
	actor: "agent" | "cli" | "fixture";
	kind: "command" | "read" | "write" | "directive";
	/** Canonical executable/tool or directive name; argv excludes the executable. */
	name: string;
	args: string[];
	/** Present only after the actual process returns. */
	exitCode?: number;
	payload?: Json;
}
export type Match = Pick<Event, "actor" | "kind" | "name"> & {
	args?: string[];
	exitCode?: number;
	payload?: Json;
};
export type Assertion = { id: string } & (
	| { kind: "count"; match: Match; min: number; max?: number }
	| { kind: "before"; first: Match; second: Match }
	| { kind: "state"; key: string; equals: Json }
	| {
			kind: "reply";
			type: ReturnType<typeof stretches>[number]["type"];
			field: string[];
			equals: Json;
	  }
	| { kind: "uncovered"; reason: string }
);
/** Missing state keys mean unobserved; explicit null can assert absence. */
export interface Evidence {
	events: Event[];
	state: Record<string, Json>;
	reply?: string;
	/** A complete channel includes unsuccessful/forbidden acts through the stop boundary. */
	complete: Channel[];
	termination: "stop" | "bound" | "infrastructure-error" | "unsupported";
	detail?: string;
}
export interface Verdict {
	id: string;
	status: "pass" | "fail" | "uncovered";
	expected: Json;
	actual: Json;
	evidence: string[];
}
export interface ProbeResult {
	status:
		| "pass"
		| "fail"
		| "uncovered"
		| "bound"
		| "infrastructure-error"
		| "unsupported";
	verdicts: Verdict[];
	detail?: string;
}

export function matches(event: Event, match: Match): boolean {
	return Object.entries(match).every(([key, value]) =>
		isDeepStrictEqual(event[key as keyof Event], value),
	);
}

/** Check a probe against captured evidence and report failures or coverage gaps. */
export function assess(probe: Probe, evidence: Evidence): ProbeResult {
	const verdicts = probe.assertions.map((assertion): Verdict => {
		const result = (
			status: Verdict["status"],
			expected: Json,
			actual: Json,
			ids: string[] = [],
		): Verdict => ({
			id: assertion.id,
			status,
			expected,
			actual,
			evidence: ids,
		});
		if (assertion.kind === "uncovered") {
			return result("uncovered", assertion.reason, null);
		}
		const channel =
			assertion.kind === "state"
				? "state"
				: assertion.kind === "reply"
					? "reply"
					: "events";
		if (!evidence.complete.includes(channel)) {
			return result("uncovered", `complete ${channel}`, null);
		}
		if (assertion.kind === "count") {
			const found = evidence.events.filter((event) =>
				matches(event, assertion.match),
			);
			const ok =
				found.length >= assertion.min &&
				(assertion.max === undefined || found.length <= assertion.max);
			return result(
				ok ? "pass" : "fail",
				{ min: assertion.min, max: assertion.max ?? null },
				found.length,
				found.map((event) => event.id),
			);
		}
		if (assertion.kind === "before") {
			const first = evidence.events.flatMap((event, index) =>
				matches(event, assertion.first) ? [index] : [],
			);
			const then = evidence.events.flatMap((event, index) =>
				matches(event, assertion.second) ? [index] : [],
			);
			// Every first occurrence must precede every then occurrence; both are required.
			const ok =
				first.length > 0 &&
				then.length > 0 &&
				Math.max(...first) < Math.min(...then);
			return result(
				ok ? "pass" : "fail",
				"all first before all then, both present",
				{ first, then },
				[...first, ...then].map((index) => evidence.events[index]?.id ?? ""),
			);
		}
		if (assertion.kind === "state") {
			if (!Object.hasOwn(evidence.state, assertion.key)) {
				return result("uncovered", assertion.equals, null);
			}
			const actual = evidence.state[assertion.key] as Json;
			return result(
				isDeepStrictEqual(actual, assertion.equals) ? "pass" : "fail",
				assertion.equals,
				actual,
			);
		}
		if (evidence.reply === undefined) {
			return result("uncovered", assertion.equals, null);
		}
		const parsed = stretches(evidence.reply).filter(
			(part) => part.type === assertion.type,
		);
		const observed = parsed.map((part) => atPath(part, assertion.field));
		const actual = observed.filter(
			(value): value is Json => value !== undefined,
		);
		return result(
			actual.some((value) => isDeepStrictEqual(value, assertion.equals))
				? "pass"
				: "fail",
			assertion.equals,
			actual,
		);
	});
	const status =
		evidence.termination !== "stop"
			? evidence.termination
			: verdicts.some((verdict) => verdict.status === "fail")
				? "fail"
				: verdicts.length === 0 ||
						verdicts.some((verdict) => verdict.status === "uncovered")
					? "uncovered"
					: "pass";
	return { status, verdicts, detail: evidence.detail };
}

function atPath(value: unknown, path: string[]): Json | undefined {
	for (const key of path) {
		if (
			value === null ||
			typeof value !== "object" ||
			!Object.hasOwn(value, key)
		) {
			return undefined;
		}
		value = (value as Record<string, unknown>)[key];
	}
	return value as Json | undefined;
}

/** Allocate unique sandbox paths and ports for each probe/model/repetition. */
export interface ProbeIsolation {
	repository: string;
	arborHome: string;
	logs: string;
	outputs: string;
	ports: number[];
}
/** Keep alongside raw evidence; incompatible identities must not share cached grades. */
export interface ProbeRun {
	schema: 1;
	identity: {
		probe: string;
		probeVersion: string;
		fixtureHash: string;
		assertionHash: string;
		skillHash: string;
		cliHash: string;
		adapterVersion: string;
		model: string | null;
		configHash: string;
		repetition: number;
	};
	isolation: ProbeIsolation;
	evidence: Evidence;
	usage: {
		milliseconds: number;
		turns: number;
		tokens: number | null;
		costUsd: number | null;
	};
	reproduction: string[];
}

import type { Ps } from "core/system";
import type { Agent, Limit } from "../conversations";
import { AGY_CLI } from "./antigravity";

/** Whether the roster entry runs Antigravity's own ACP server. */
export function isAntigravity(agent: Agent): boolean {
	return agent.argv.some((arg) => /(^|\/|\b)agy($|[\s"}])/.test(arg));
}

/**
 * Reads Antigravity plan quota for Billing using the installed CLI's sign-in.
 * Returns no limits when the CLI is unavailable, signed out or cannot read quota.
 */
export async function antigravityLimits(deps: {
	ps: Pick<Ps, "spawnCapture">;
	now: () => number;
	cwd: string;
}): Promise<Limit[]> {
	// Headless /usage is a local command, not a model turn.
	try {
		const result = await deps.ps.spawnCapture(
			[
				...AGY_CLI,
				"--print",
				"/usage",
				"--output-format",
				"json",
				"--print-timeout",
				"15s",
			],
			{ cwd: deps.cwd, stdin: "", timeoutMs: 20_000 },
		);
		return result.exitCode === 0
			? antigravityLimitsIn(
					JSON.parse(result.stdout),
					new Date(deps.now()).toISOString(),
				)
			: [];
	} catch {
		return [];
	}
}

/**
 * Quota groups from `agy --print /usage --output-format json`, one window per
 * model: buckets for one model's levels ("Gemini 4 Neon (High)") fold into the
 * most used of them. A reset at the 1970 epoch is agy's placeholder for none.
 */
export function antigravityLimitsIn(payload: unknown, at: string): Limit[] {
	const root = record(payload);
	const command = record(root?.command);
	const groups = record(command?.data)?.groups;
	if (
		root?.status !== "SUCCESS" ||
		command?.name !== "usage" ||
		!Array.isArray(groups)
	) {
		return [];
	}
	const limits = new Map<string, Limit>();
	for (const entry of groups) {
		const group = record(entry);
		if (
			typeof group?.name !== "string" ||
			!group.name ||
			!Array.isArray(group.buckets)
		) {
			continue;
		}
		for (const value of group.buckets) {
			const bucket = record(value);
			const remaining = bucket?.remaining_fraction;
			const reset = bucket?.reset_time;
			const name = bucket?.name;
			if (
				typeof remaining !== "number" ||
				!Number.isFinite(remaining) ||
				remaining < 0 ||
				remaining > 1 ||
				typeof reset !== "string" ||
				!Number.isFinite(Date.parse(reset)) ||
				typeof name !== "string" ||
				!name
			) {
				continue;
			}
			const window = `${group.name} · ${name
				.replace(/ Limit Remaining$/, "")
				.replace(/ \([^)]*\)$/, "")}`;
			const used = 1 - remaining;
			const known = limits.get(window);
			if (known === undefined || used > known.used) {
				limits.set(window, {
					window,
					used,
					resets: Date.parse(reset) <= 0 ? null : new Date(reset).toISOString(),
					at,
				});
			}
		}
	}
	return [...limits.values()];
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

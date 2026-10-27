import { createHash } from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import type { Fs } from "webappwiz/system";

/** Where Kimi Code writes the main agent's records for `session` in `cwd`. */
export function kimiUsagePath({
	home,
	cwd,
	session,
}: {
	home: string;
	cwd: string;
	session: string;
}): string {
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const name = normalized.split("/").pop() ?? normalized;
	const slug =
		name
			.toLowerCase()
			.replaceAll(/[^a-z0-9._-]+/g, "-")
			.replaceAll(/^-+|-+$/g, "")
			.slice(0, 40)
			.replaceAll(/^-+|-+$/g, "") || "workspace";
	const key = createHash("sha256")
		.update(normalized)
		.digest("hex")
		.slice(0, 12);
	const id = session.startsWith("session_") ? session : `session_${session}`;
	return `${home}/sessions/wd_${slug}_${key}/${id}/agents/main/wire.jsonl`;
}

/** Every main-agent model call's tokens in Kimi's wire log; null when unreadable or malformed. */
export async function kimiUsage(deps: {
	fs: Fs;
	home: string;
	cwd: string;
	session: string;
}): Promise<acp.Usage | null> {
	try {
		return kimiUsageIn(await deps.fs.read(kimiUsagePath(deps)));
	} catch {
		return null;
	}
}

/** The tokens in a wire log's `usage.record` lines, not their context-event copies. */
export function kimiUsageIn(wire: string): acp.Usage | null {
	const total = empty();
	for (const line of wire.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		let row: unknown;
		try {
			row = JSON.parse(line);
		} catch {
			// A writer can leave its last line partial; only a usage line would
			// make the reading incomplete.
			if (line.includes("usage.record")) {
				return null;
			}
			continue;
		}
		if (!isRecord(row) || row.type !== "usage.record") {
			continue;
		}
		if (row.agentId !== "main" || row.usageScope !== "turn") {
			continue;
		}
		const usage = isRecord(row.usage) ? row.usage : null;
		const input = number(usage?.inputOther);
		const cachedRead = number(usage?.inputCacheRead);
		const cachedWrite = number(usage?.inputCacheCreation);
		const output = number(usage?.output);
		if (
			input === null ||
			cachedRead === null ||
			cachedWrite === null ||
			output === null
		) {
			return null;
		}
		total.inputTokens += input;
		total.cachedReadTokens = (total.cachedReadTokens ?? 0) + cachedRead;
		total.cachedWriteTokens = (total.cachedWriteTokens ?? 0) + cachedWrite;
		total.outputTokens += output;
	}
	total.totalTokens =
		total.inputTokens +
		(total.cachedReadTokens ?? 0) +
		(total.cachedWriteTokens ?? 0) +
		total.outputTokens;
	return total;
}

/** The calls between two cumulative readings; null for a lost, negative or empty delta. */
export function kimiTurnUsage(
	before: acp.Usage | null,
	after: acp.Usage | null,
): acp.Usage | null {
	if (before === null || after === null) {
		return null;
	}
	const turn = {
		inputTokens: after.inputTokens - before.inputTokens,
		cachedReadTokens:
			(after.cachedReadTokens ?? 0) - (before.cachedReadTokens ?? 0),
		cachedWriteTokens:
			(after.cachedWriteTokens ?? 0) - (before.cachedWriteTokens ?? 0),
		outputTokens: after.outputTokens - before.outputTokens,
		totalTokens: after.totalTokens - before.totalTokens,
	};
	return Object.values(turn).some((each) => each < 0) || turn.totalTokens === 0
		? null
		: turn;
}

function empty(): acp.Usage {
	return {
		inputTokens: 0,
		cachedReadTokens: 0,
		cachedWriteTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
	};
}

function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

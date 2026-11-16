import { join, resolve } from "node:path";
import { type Fs, NodeFs, walk } from "core/system";
import { withoutMedia } from "./media";
import type { Step } from "./scenario";

/** Parse only native calls and their results, excluding prompts, reasoning and unrelated session data. */
export function nativeCalls(lines: readonly Record<string, unknown>[]): Step[] {
	const steps: Step[] = [];
	const calls = new Map<string, Extract<Step, { kind: "tool" }>>();
	for (const line of lines) {
		if (line.type !== "response_item") {
			continue;
		}
		const item = line.payload as Record<string, unknown> | undefined;
		if (!item || typeof item.call_id !== "string") {
			continue;
		}
		if (item.type === "function_call" || item.type === "custom_tool_call") {
			const step: Extract<Step, { kind: "tool" }> = {
				kind: "tool",
				name: String(item.name),
				input: withoutMedia(String(item.arguments ?? item.input ?? "")),
				output: null,
			};
			calls.set(item.call_id, step);
			steps.push(step);
		} else if (
			item.type === "function_call_output" ||
			item.type === "custom_tool_call_output"
		) {
			const call = calls.get(item.call_id);
			if (call) {
				call.output = withoutMedia(
					typeof item.output === "string"
						? item.output
						: JSON.stringify(item.output),
				);
			}
		}
	}
	return steps;
}

/** Recover a completed run's native tool calls from its exact thread and working directory. */
export async function codexEvidence(
	thread: string,
	cwd: string,
	home: string,
	fs: Fs = new NodeFs(),
): Promise<Step[]> {
	if (!/^[a-zA-Z0-9-]+$/.test(thread)) {
		throw new Error("Invalid Codex thread ID");
	}
	const root = join(home, "sessions");
	if (await fs.exists(root)) {
		for await (const path of walk(root, { fs })) {
			if (!path.endsWith(`-${thread}.jsonl`)) {
				continue;
			}
			const lines = (await fs.read(path))
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			const meta = lines.find((line) => line.type === "session_meta")
				?.payload as { id?: string; cwd?: string } | undefined;
			if (
				meta?.id !== thread ||
				typeof meta.cwd !== "string" ||
				resolve(meta.cwd) !== resolve(cwd)
			) {
				continue;
			}
			return nativeCalls(lines);
		}
	}
	throw new Error(
		`Codex native tool evidence unavailable for thread ${thread}`,
	);
}

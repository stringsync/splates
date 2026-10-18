import { describe, expect, it } from "bun:test";
import type { ProcessEntry } from "webappwiz/system";
import { heldBy } from "./held";

function entry(
	pid: number,
	ppid: number,
	command: string,
	{ pgid = pid, tpgid = 0 }: { pgid?: number; tpgid?: number } = {},
): ProcessEntry {
	return { pid, ppid, pgid, tpgid, command };
}

describe("heldBy", () => {
	it("holds for the job in front in a shell", () => {
		const table = [
			entry(10, 1, "-zsh", { tpgid: 11 }),
			entry(11, 10, "bun run dev", { tpgid: 11 }),
		];

		expect(heldBy(table, { shells: [10], agents: [] })).toEqual([
			{ where: "terminal", command: "bun run dev" },
		]);
	});

	it("holds nothing for a shell at its prompt, its helpers aside", () => {
		const table = [
			entry(10, 1, "-zsh", { tpgid: 10 }),
			entry(12, 10, "gitstatusd", { pgid: 10, tpgid: 10 }),
		];

		expect(heldBy(table, { shells: [10], agents: [] })).toEqual([]);
	});

	it("holds for each command an agent left running in a shell", () => {
		const table = [
			entry(20, 1, "node claude-agent-acp", { pgid: 1 }),
			entry(21, 20, "claude --output-format stream-json", { pgid: 1 }),
			entry(22, 21, "npm exec @playwright/mcp", { pgid: 1 }),
			entry(23, 22, "/bin/sh -c playwright-mcp", { pgid: 1 }),
			entry(24, 21, "/bin/zsh -c source snapshot.sh && eval 'bun run dev'"),
			entry(25, 24, "bun run dev", { pgid: 24 }),
			entry(26, 25, "/bin/sh -c vite", { pgid: 24 }),
			entry(27, 21, "/bin/bash -c sleep 30 &"),
		];

		expect(
			heldBy(table, { shells: [], agents: [{ name: "fixer", pid: 21 }] }),
		).toEqual([
			{ where: "fixer", command: "bun run dev" },
			{ where: "fixer", command: "/bin/bash -c sleep 30 &" },
		]);
	});

	it("holds nothing for an agent with only its MCP servers under it", () => {
		const table = [
			entry(20, 1, "claude"),
			entry(22, 20, "node playwright-mcp", { pgid: 20 }),
			entry(
				23,
				22,
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			),
		];

		expect(
			heldBy(table, { shells: [], agents: [{ name: "fixer", pid: 20 }] }),
		).toEqual([]);
	});

	it("holds nothing for what is gone", () => {
		expect(
			heldBy([], { shells: [10], agents: [{ name: "fixer", pid: 20 }] }),
		).toEqual([]);
	});
});

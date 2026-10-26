import { expect, it } from "bun:test";
import { join } from "node:path";
import { removedReport, scenarios } from "./continuity";

it.each([
	["checkpoint", undefined, "Which output label should follow ready?"],
	["resume", undefined, "## Blocked\n"],
	["reconnect-completed", "ready\n", "## Blocked\n"],
	["reconnect-partial", "rea", "## Blocked\n"],
	["reconnect-failed", undefined, "## Blocked\n"],
] as const)(
	"seeds %s in the task worktree",
	async (id, output, savedContext) => {
		const files = new Map<string, string>();
		const dir = "/sandbox/repo";
		const task = "/sandbox/repo-splates.noindex/continuity";
		await scenarios
			.find((scenario) => scenario.id === `continuity/${id}`)
			?.change?.({
				dir,
				async write(path, text) {
					files.set(join(dir, path), text);
				},
				async run() {
					return task;
				},
			});
		const notes = files.get(join(task, "SPLATES.md"));
		expect(notes).toContain("Paused before writing result.txt.");
		expect(notes).toContain("## Blocked\n");
		expect(notes).toContain(savedContext);
		expect(files.get(join(task, "result.txt"))).toBe(output);
	},
);

it("finds the Removed report for a task", () => {
	const reply = "## 🛑 Removed continuity: moot\n\nIt set out to write a file.";
	expect(removedReport(reply, "continuity")).toBe(
		"## 🛑 Removed continuity: moot",
	);
	expect(removedReport(reply, "other")).toBeNull();
	expect(removedReport("## ✅ Done: nothing", "continuity")).toBeNull();
});

import { describe, expect, it } from "bun:test";
import type { Outcome } from "@evals/evals/scenario";
import { scenarios } from "./progress";

/** Runs check `check` of scenario `id` on an outcome where the agent ran `commands` and said `reply`. */
async function passes(
	id: string,
	check: string,
	commands: string[],
	reply = "",
): Promise<boolean> {
	const found = scenarios
		.find((each) => each.id === `progress/${id}`)
		?.checks?.find((each) => each.id === check);
	if (found === undefined) {
		throw new Error(`no check ${id}/${check}`);
	}
	return found.test({ reply, commands } as unknown as Outcome);
}

describe("progress evals", () => {
	it("counts a card update by id as reporting", async () => {
		expect(
			await passes("reports-long-task", "reports", [
				'splates progress import "file 2 of 5" --percent 40',
			]),
		).toBe(true);
		expect(
			await passes("reports-long-task", "reports", ["scripts/import.sh"]),
		).toBe(false);
	});

	it("wants --failed and no --done after a failing run", async () => {
		const failed = ["splates progress import --failed"];
		const done = ["splates progress import --done"];

		expect(await passes("finishes-failed-card", "failed", failed)).toBe(true);
		expect(await passes("finishes-failed-card", "failed", done)).toBe(false);
		expect(await passes("finishes-failed-card", "not-done", done)).toBe(false);
		expect(await passes("finishes-failed-card", "not-done", failed)).toBe(true);
	});

	it("fails a card on a quick lookup, and wants the count", async () => {
		expect(
			await passes("short-task-no-card", "no-card", ["grep -r TODO src"]),
		).toBe(true);
		expect(
			await passes("short-task-no-card", "no-card", [
				"splates progress todos x",
			]),
		).toBe(false);
		expect(
			await passes("short-task-no-card", "counted", [], "There are 3 TODOs."),
		).toBe(true);
		expect(
			await passes("short-task-no-card", "counted", [], "There are 4 TODOs."),
		).toBe(false);
	});

	it("recognises a script piped into a streamed card", async () => {
		const piped = (command: string) =>
			passes("streams-output", "piped", [command]);

		expect(await piped("scripts/build.sh | splates progress build -")).toBe(
			true,
		);
		expect(
			await piped(
				'sh scripts/build.sh 2>&1 | splates progress build - --title "Build"',
			),
		).toBe(true);
		expect(await piped('splates progress build "building 20%"')).toBe(false);
		expect(
			await piped("scripts/build.sh | splates progress build --title Build"),
		).toBe(false);
	});
});

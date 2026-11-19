import type { Ps } from "core/system";

type Answer = {
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	/** Held until this settles, as a slow command is. */
	after?: Promise<unknown>;
};

/**
 * Ship commands for tests: each shell line, as `bin/a ship plan --target a`,
 * answers what `answers` gives it, and any other line exits 127.
 */
export class FakeShipPs implements Pick<Ps, "spawnCapture"> {
	readonly lines: string[] = [];

	constructor(private readonly answers: Record<string, Answer | unknown>) {}

	async spawnCapture(argv: string[]) {
		const line = argv[2] ?? "";
		this.lines.push(line);
		if (!(line in this.answers)) {
			return { exitCode: 127, stdout: "", stderr: `sh: ${line}: not found` };
		}
		const answer = this.answers[line];
		if (isAnswer(answer)) {
			await answer.after;
			return {
				exitCode: answer.exitCode ?? 0,
				stdout: answer.stdout ?? "",
				stderr: answer.stderr ?? "",
			};
		}
		return { exitCode: 0, stdout: JSON.stringify(answer), stderr: "" };
	}
}

function isAnswer(value: unknown): value is Answer {
	return (
		typeof value === "object" &&
		value !== null &&
		("exitCode" in value || "stdout" in value || "after" in value)
	);
}

export { FakeRun } from "./fake-run";
export { FakeStepProcesses } from "./fake-step-processes";

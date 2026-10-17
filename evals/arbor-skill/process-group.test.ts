import { expect, it } from "bun:test";
import { awaitProcessGroupExit } from "./process-group";

it("waits through a transient permission error until the group is gone", async () => {
	const signals = new Signals(["EPERM", true, "ESRCH"]);
	await awaitProcessGroupExit(12345, signals);
	expect(signals.calls).toEqual([
		[-12345, 0],
		[-12345, 0],
		[-12345, 0],
	]);
});

it("rejects a group that remains inaccessible instead of claiming cleanup", async () => {
	await expect(
		awaitProcessGroupExit(12345, new Signals(["EPERM"])),
	).rejects.toThrow("Process group 12345 did not exit after cleanup");
});

class Signals {
	readonly calls: [number, string | number | undefined][] = [];
	constructor(private readonly outcomes: (true | "EPERM" | "ESRCH")[]) {}
	kill(pid: number, signal?: string | number): true {
		this.calls.push([pid, signal]);
		const outcome =
			this.outcomes[Math.min(this.calls.length - 1, this.outcomes.length - 1)];
		if (outcome !== true) {
			throw Object.assign(new Error("fixture signal"), { code: outcome });
		}
		return true;
	}
}

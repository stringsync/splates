import type { BoxCloud } from "./box";

/**
 * The cloud a `CoordinatorBox` under test is in: answers each console read
 * with the next of `consoles`, has the instance there while `there`, and
 * remembers each protection lifted or set.
 */
export class FakeBoxCloud implements BoxCloud {
	/** What each read of the console answers in turn, then "". */
	consoles: string[] = [];
	there = true;
	readonly protections: [string, boolean][] = [];

	async consoleOutput(): Promise<string> {
		return this.consoles.shift() ?? "";
	}

	async machine(id: string): Promise<{ id: string } | null> {
		return this.there ? { id } : null;
	}

	async protect(id: string, on: boolean): Promise<void> {
		this.protections.push([id, on]);
	}
}

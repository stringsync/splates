import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleLogger } from "webappwiz/log";
import { MemoryLock, NodeFs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { CoreClaims, coreBudgetOf } from "./cores";

describe("cores", () => {
	let dir: string;
	let lock: MemoryLock;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cores-"));
		lock = new MemoryLock();
	});

	/** The claims of one process, pid `pid`, sharing one file with the rest. */
	const claims = (pid: number, budget: number, timeout = Duration.secs(5)) =>
		CoreClaims.under(dir, {
			fs: new NodeFs(),
			ps: { pid, alive: () => true },
			lock,
			log: new ConsoleLogger(),
			budget,
			timeout,
			poll: Duration.ms(10),
		});

	it("leaves two cores out of the budget unless the variable says otherwise", () => {
		expect(coreBudgetOf(undefined, 16)).toBe(14);
		expect(coreBudgetOf("6", 16)).toBe(6);
		expect(coreBudgetOf("nope", 2)).toBe(1);
	});

	it("gives a lone claim all it wants, capped at the budget", async () => {
		await using claim = await claims(1, 14).claim({ what: "a", want: 20 });
		expect(claim.cores).toBe(14);
	});

	it("gives a second claim what is left when that is enough", async () => {
		await using first = await claims(1, 14).claim({ what: "a", want: 8 });
		await using second = await claims(2, 14).claim({
			what: "b",
			want: 8,
			min: 4,
		});
		expect(first.cores).toBe(8);
		expect(second.cores).toBe(6);
	});

	it("waits for cores to come free, then takes them", async () => {
		const first = await claims(1, 8).claim({ what: "a", want: 8 });
		const second = claims(2, 8).claim({ what: "b", want: 8, min: 4 });
		await Bun.sleep(50);
		await first[Symbol.asyncDispose]();
		await using got = await second;
		expect(got.cores).toBe(8);
	});

	it("gives up after the timeout, leaving the line", async () => {
		await using _first = await claims(1, 8).claim({ what: "a", want: 8 });
		const second = claims(2, 8, Duration.ms(100));
		await expect(second.claim({ what: "b", want: 8 })).rejects.toThrow(
			/Waited .* minutes/,
		);
		expect((await second.read()).waiting).toEqual([]);
	});
});

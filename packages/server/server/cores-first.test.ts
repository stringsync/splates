import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleLogger } from "webappwiz/log";
import { MemoryLock, NodeFs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { type CoreClaim, CoreClaims, FIRST_PASSES_UNDER } from "./cores";

describe("a first claim, while another holds every core", () => {
	let dir: string;
	let lock: MemoryLock;
	let holder: CoreClaim;

	/** The claims of one process, pid `pid`, sharing one file with the rest. */
	const claims = (pid: number, timeout = Duration.secs(5)) =>
		CoreClaims.under(dir, {
			fs: new NodeFs(),
			ps: { pid, alive: () => true, env: () => undefined },
			lock,
			log: new ConsoleLogger(),
			budget: 8,
			timeout,
			poll: Duration.ms(10),
		});

	const line = async () => {
		const { running, waiting } = await claims(9).read();
		return {
			running: running.map((each) => each.what),
			waiting: waiting.map((each) => each.what),
		};
	};

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "cores-"));
		lock = new MemoryLock();
		holder = await claims(1).claim({ what: "a", want: 8 });
	});

	afterEach(async () => {
		await holder[Symbol.asyncDispose]();
	});

	it("waits ahead of an ordinary one that came before it, and gets the cores first", async () => {
		const ordinary = claims(2).claim({ what: "dev test", want: 8 });
		await Bun.sleep(50);
		const merge = claims(3).claim({ what: "preMerge", want: 8, first: true });
		await Bun.sleep(50);
		expect((await line()).waiting).toEqual(["preMerge", "dev test"]);

		await holder[Symbol.asyncDispose]();
		const got = await merge;
		expect(await line()).toEqual({
			running: ["preMerge"],
			waiting: ["dev test"],
		});
		await got[Symbol.asyncDispose]();
		await (await ordinary)[Symbol.asyncDispose]();
	});

	it("never goes ahead of one that has waited long", async () => {
		const long = new Date(
			Date.now() - FIRST_PASSES_UNDER.ms - 1000,
		).toISOString();
		await Bun.write(
			join(dir, "cores.json"),
			JSON.stringify({
				...(await claims(9).read()),
				waiting: [
					{ id: "2-0", what: "dev test", pid: 2, cores: 8, since: long },
				],
			}),
		);
		const merge = claims(3, Duration.ms(200)).claim({
			what: "preMerge",
			want: 8,
			first: true,
		});
		await Bun.sleep(50);
		expect((await line()).waiting).toEqual(["dev test", "preMerge"]);
		await expect(merge).rejects.toThrow(/Waited/);
	});
});

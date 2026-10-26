import { describe, expect, it } from "bun:test";
import { MachinePools } from "./pools";

const MB = 1024 * 1024;

describe("MachinePools", () => {
	it("offers the cores less a reserve, most of the memory, and one suite", async () => {
		const pools = new MachinePools({
			cpus: () => new Array(10).fill({ times: {} }),
			loadavg: () => [3.5],
			totalmem: () => 1000 * MB,
			freemem: () => 400 * MB,
		});

		expect(await pools.capacity()).toEqual({ cpus: 8, mem: 850, suite: 1 });
		expect(await pools.used()).toEqual({ cpus: 3.5, mem: 600 });
	});
});

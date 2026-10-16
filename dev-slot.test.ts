import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { stopLeftover } from "./dev-slot";
import { SERVER_PID, Slots, slotOf } from "./slots";

describe("stopLeftover", () => {
	const slot = slotOf("fox") ?? { word: "fox", emoji: "🦊" };
	const home = "/home/.arbor/slots/fox";
	const slotsOf = (fs: FakeFs, ps: FakePs) =>
		new Slots("/home/.arbor/slots.json", { fs, ps, lock: new MemoryLock() });
	const left = async (pid: number) => {
		const fs = new FakeFs();
		const ps = new FakePs();
		await fs.mkdir(home);
		await fs.write(`${home}/${SERVER_PID}`, String(pid));
		// A SIGTERM ends it, as it ends a real server.
		ps.simulate(async () => {
			ps.kill(pid);
			return 0;
		});
		return { ps, slots: slotsOf(fs, ps), log: new MemoryLogger() };
	};

	it("starts when the slot never ran a server", async () => {
		const ps = new FakePs();
		await stopLeftover(slotsOf(new FakeFs(), ps), slot, new MemoryLogger());
		expect(ps.getCalls()).toEqual([]);
	});

	it("stops the tree's last server itself, rather than asking for a kill", async () => {
		const ctx = await left(777);
		await stopLeftover(ctx.slots, slot, ctx.log);
		expect(ctx.ps.getCalls()).toEqual(["kill 777"]);
		expect(ctx.ps.alive(777)).toBe(false);
		expect(String(ctx.log.entries.at(-1)?.message)).toContain("pid 777");
	});

	it("leaves a pid that has since gone to another program", async () => {
		const ctx = await left(777);
		ctx.ps.setProcesses([
			{ pid: 777, ppid: 1, pgid: 777, tpgid: 0, command: "vim notes.txt" },
		]);
		await stopLeftover(ctx.slots, slot, ctx.log);
		expect(ctx.ps.getCalls()).toEqual([]);
	});
});

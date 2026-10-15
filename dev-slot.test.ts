import { describe, expect, it } from "bun:test";
import { MemoryLock } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { refuseStale } from "./dev-slot";
import { Exit } from "./exit";
import { SERVER_PID, Slots, slotOf } from "./slots";

describe("refuseStale", () => {
	const slot = slotOf("fox") ?? { word: "fox", emoji: "🦊" };
	const home = "/home/.arbor/slots/fox";
	const slotsOf = (fs: FakeFs, ps: FakePs) =>
		new Slots("/home/.arbor/slots.json", { fs, ps, lock: new MemoryLock() });
	const left = async (pid: string) => {
		const fs = new FakeFs();
		const ps = new FakePs();
		await fs.mkdir(home);
		await fs.write(`${home}/${SERVER_PID}`, pid);
		return { ps, slots: slotsOf(fs, ps) };
	};

	it("starts when the slot never ran a server", async () => {
		await refuseStale(slotsOf(new FakeFs(), new FakePs()), slot);
	});

	it("refuses while the last server still runs, naming the pid to stop", async () => {
		const ctx = await left("777");
		const error = await refuseStale(ctx.slots, slot).catch(
			(failure) => failure,
		);
		expect(error).toBeInstanceOf(Exit);
		expect(error.reason).toBe("slot_running");
		expect(error.message).toContain("kill 777");
	});

	it("starts once that server is gone", async () => {
		const ctx = await left("777");
		ctx.ps.kill(777);
		await refuseStale(ctx.slots, slot);
	});

	it("starts when the pid has since gone to another program", async () => {
		const ctx = await left("777");
		ctx.ps.setProcesses([
			{ pid: 777, ppid: 1, pgid: 777, tpgid: 0, command: "vim notes.txt" },
		]);
		await refuseStale(ctx.slots, slot);
	});
});

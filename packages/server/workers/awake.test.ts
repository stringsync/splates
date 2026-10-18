import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { keepAwakeOf, WindowsKeepAwake } from "./awake";

describe("keeping Windows awake", () => {
	it("holds Windows awake from powershell.exe until let go", () => {
		const ps = new FakePs();
		const hold = new WindowsKeepAwake(ps, new MemoryLogger()).hold();
		const [child] = ps.getChildren();

		expect(ps.getCalls()[0]).toStartWith("powershell.exe");
		expect(ps.getCalls()[0]).toContain("SetThreadExecutionState");

		hold.dispose();

		expect(child?.signals).toEqual(["SIGTERM"]);
	});

	it("keeps Windows awake under WSL", () => {
		const ps = new FakePs();
		ps.setEnv({ WSL_DISTRO_NAME: "splates" });

		expect(keepAwakeOf(ps, new MemoryLogger())).toBeInstanceOf(
			WindowsKeepAwake,
		);
	});

	it("keeps nothing awake elsewhere", () => {
		expect(keepAwakeOf(new FakePs(), new MemoryLogger())).toBeNull();
	});
});

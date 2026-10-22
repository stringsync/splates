import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { platformLabel } from "./list";
import { hostOf, machineSlots } from "./machine";

describe("the machine a worker runs on", () => {
	const GB = 1024 ** 3;

	it("shows a worker under WSL as linux (wsl2)", () => {
		const ps = new FakePs();
		ps.setEnv({ WSL_DISTRO_NAME: "splates" });

		const host = hostOf(ps);

		expect(platformLabel({ platform: "linux", host })).toBe("linux (wsl2)");
	});

	it("shows a worker on the bare machine as its platform alone", () => {
		const host = hostOf(new FakePs());

		expect(platformLabel({ platform: "linux", host })).toBe("linux");
	});

	it("takes a slot a core on a machine with memory to spare", () => {
		expect(machineSlots(6, 26 * GB)).toBe(6);
	});

	it("takes a slot each 4 GB on a machine short of memory", () => {
		expect(machineSlots(16, 16 * GB)).toBe(4);
	});

	it("takes one slot however small the machine", () => {
		expect(machineSlots(2, 2 * GB)).toBe(1);
	});
});

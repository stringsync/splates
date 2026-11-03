import { describe, expect, it } from "bun:test";
import { FakePs } from "core/system/testing";
import { platformLabel } from "./list";
import { cwdPids, hostOf } from "./machine";

describe("the machine a worker runs on", () => {
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
});

describe("cwdPids", () => {
	it("picks the processes working in a folder or under it, not a sibling sharing its prefix", () => {
		const output = [
			"p10",
			"n/work/task",
			"p11",
			"n/work/task/web",
			"p12",
			"n/work/task-other",
			"p13",
			"n/elsewhere",
		].join("\n");

		expect(cwdPids(output, "/work/task/")).toEqual([10, 11]);
	});
});

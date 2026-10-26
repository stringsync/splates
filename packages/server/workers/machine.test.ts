import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { platformLabel } from "./list";
import { hostOf } from "./machine";

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

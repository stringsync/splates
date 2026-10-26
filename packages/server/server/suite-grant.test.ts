import { describe, expect, it } from "bun:test";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { SUITE_GRANT_MS, SuiteGrants } from "./suite-grant";

function grantsAt(clock: { now: number }) {
	const ps = new FakePs();
	ps.setEnv({ SPLATES_HOME: "/home/.splates" });
	return new SuiteGrants({ fs: new FakeFs(), ps, now: () => clock.now });
}

describe("SuiteGrants", () => {
	it("lets a conversation run the suite once per approval", async () => {
		const grants = grantsAt({ now: 0 });
		expect(await grants.take("c1")).toBe(false);
		await grants.grant("c1");
		expect(await grants.take("c2")).toBe(false);
		expect(await grants.take("c1")).toBe(true);
		expect(await grants.take("c1")).toBe(false);
	});

	it("lets an approval lapse unused", async () => {
		const clock = { now: 0 };
		const grants = grantsAt(clock);
		await grants.grant("c1");
		clock.now = SUITE_GRANT_MS + 1;
		expect(await grants.take("c1")).toBe(false);
	});
});

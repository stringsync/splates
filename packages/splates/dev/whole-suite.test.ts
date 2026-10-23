import { describe, expect, it } from "bun:test";
import { SuiteGrants } from "@stringsync/splates-server/server";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { refuseWholeSuite, test } from "./test";

function machine(env: Record<string, string>) {
	const ps = new FakePs();
	ps.setEnv({ SPLATES_HOME: "/home/.splates", ...env });
	return { ps, grants: new SuiteGrants({ fs: new FakeFs(), ps }) };
}

describe("refuseWholeSuite", () => {
	it("refuses an agent, naming the scoped runs that need no approval", async () => {
		const { ps, grants } = machine({ SPLATES_CONVERSATION: "c1" });
		const refused = test({ ps, grants });
		await expect(refused).rejects.toThrow("merge gate's to run");
		await expect(refuseWholeSuite(ps, grants)).rejects.toThrow("`--changed`");
		await expect(refuseWholeSuite(ps, grants)).rejects.toThrow(
			"## 🔐 Permission: run command",
		);
	});

	it("lets an agent run it once the person approves, once", async () => {
		const { ps, grants } = machine({ SPLATES_CONVERSATION: "c1" });
		await grants.grant("c1");
		await refuseWholeSuite(ps, grants);
		await expect(refuseWholeSuite(ps, grants)).rejects.toThrow(
			"merge gate's to run",
		);
	});

	it("lets the person and a merge's gate run it", async () => {
		const person = machine({});
		await refuseWholeSuite(person.ps, person.grants);
		const gate = machine({ SPLATES_CONVERSATION: "c1", SPLATES_PREMERGE: "1" });
		await refuseWholeSuite(gate.ps, gate.grants);
	});
	it("refuses exactly half before starting tests, reporting both counts", async () => {
		const { ps, grants } = machine({ SPLATES_CONVERSATION: "c1" });
		await expect(
			test({
				ps,
				grants,
				since: "main",
				scope: { count: async () => ({ selected: 5, total: 10 }) },
			}),
		).rejects.toThrow("5 of 10 test files");
		expect(ps.getCalls()).toEqual([]);
	});

	it("runs below half without spending a grant, and consumes one for a broad scope", async () => {
		const { ps, grants } = machine({ SPLATES_CONVERSATION: "c1" });
		ps.platform = "linux";
		await grants.grant("c1");
		await test({
			ps,
			grants,
			files: ["example.test.ts"],
			scope: { count: async () => ({ selected: 4, total: 10 }) },
		});
		await test({
			ps,
			grants,
			changed: true,
			scope: { count: async () => ({ selected: 5, total: 10 }) },
		});
		await expect(
			test({
				ps,
				grants,
				changed: true,
				scope: { count: async () => ({ selected: 5, total: 10 }) },
			}),
		).rejects.toThrow("at least half");
	});
});

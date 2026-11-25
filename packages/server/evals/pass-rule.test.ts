import { describe, expect, it } from "bun:test";
import { parsePassRule, standingOf } from "./pass-rule";

describe("standingOf", () => {
	it("passes at need, fails when out of reach, else needs runs", () => {
		expect(standingOf([true, true]).standing).toBe("pass");
		expect(standingOf([true]).standing).toBe("needs-runs");
		expect(standingOf([]).standing).toBe("needs-runs");
		expect(standingOf([false]).standing).toBe("needs-runs");
		expect(standingOf([false, false]).standing).toBe("fail");
	});

	it("counts only the last runs, so old failures age out", () => {
		expect(standingOf([false, false, true, true]).standing).toBe("pass");
		expect(standingOf([true, true, true, false, false]).standing).toBe("fail");
	});

	it("honors a spec's own rule", () => {
		expect(standingOf([true, false], { need: 1, of: 1 }).standing).toBe("fail");
		expect(standingOf([true], { need: 1, of: 1 }).standing).toBe("pass");
	});
});

describe("parsePassRule", () => {
	it("accepts need of of and nothing else", () => {
		expect(parsePassRule({ need: 2, of: 3 })).toEqual({ need: 2, of: 3 });
		expect(parsePassRule({ need: 4, of: 3 })).toBeNull();
		expect(parsePassRule({ need: 0, of: 3 })).toBeNull();
		expect(parsePassRule(0.8)).toBeNull();
	});
});

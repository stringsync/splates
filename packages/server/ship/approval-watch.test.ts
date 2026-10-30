import { describe, expect, it } from "bun:test";
import { scanning } from "./approval-watch";

describe("scanning", () => {
	it("reads a status naming a scan as under way, and any other or unreadable as over", () => {
		expect(scanning('{"status":"scanning"}').scanning).toBe(true);
		expect(scanning('{"status":"pending"}').scanning).toBe(true);
		expect(scanning('{"status":"ready"}').scanning).toBe(false);
		expect(scanning("nope").scanning).toBe(false);
		expect(scanning("{}").scanning).toBe(false);
	});
});

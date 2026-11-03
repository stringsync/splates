import { describe, expect, it } from "bun:test";
import { cascadeId } from "./history";

describe("cascadeId", () => {
	it("is one folder name the history can read back, for a scoped slug too", () => {
		const id = cascadeId("@stringsync/splates", "2026-11-02T22:45:29.478Z");
		expect(id).toBe("2026-11-02T22-45-29-478Z--stringsync-splates");
		expect(id).toMatch(/^[\w][\w.+-]*$/);
	});

	it("keeps a plain slug as it was", () => {
		expect(cascadeId("+changed", "2026-11-02T18:39:41.598Z")).toBe(
			"2026-11-02T18-39-41-598Z-+changed",
		);
	});
});

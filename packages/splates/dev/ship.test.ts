import { describe, expect, it } from "bun:test";
import { bumpOf } from "./ship";

describe("bumpOf", () => {
	it("releases a patch when splates ship names no release type", () => {
		expect(bumpOf(undefined)).toBe("patch");
		expect(bumpOf("")).toBe("patch");
	});

	it("releases the type the person approved", () => {
		expect(bumpOf("minor")).toBe("minor");
		expect(bumpOf("major")).toBe("major");
	});

	it("refuses a type it does not know rather than guess", () => {
		expect(() => bumpOf("prerelease")).toThrow("SPLATES_SHIP_BUMP");
	});
});

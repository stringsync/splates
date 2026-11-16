import { describe, expect, it } from "bun:test";
import { withBump } from "./inputs";

describe("withBump", () => {
	const bump = {
		name: "bump",
		label: "Bump",
		type: "choice" as const,
		options: ["patch", "minor", "major"],
		default: "patch",
	};

	it("passes the bump to a command that declares it", () => {
		expect(withBump([bump], { a: "b" }, "minor")).toEqual({
			a: "b",
			bump: "minor",
		});
	});

	it("leaves a command without a bump input alone", () => {
		expect(withBump([], undefined, "minor")).toBeUndefined();
	});
});

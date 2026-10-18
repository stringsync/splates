import "./register-dom";
import { describe, expect, it } from "bun:test";
import { scoped } from "./api";

describe("scoped", () => {
	it("asks the project given over the page's, unless the path names one", () => {
		expect(scoped("/api/terminal?task=a", "api")).toBe(
			"/api/terminal?task=a&project=api",
		);
		expect(scoped("/api/dictation", "api")).toBe("/api/dictation?project=api");
		expect(scoped("/api/snapshot?project=x", "api")).toBe(
			"/api/snapshot?project=x",
		);
	});
});

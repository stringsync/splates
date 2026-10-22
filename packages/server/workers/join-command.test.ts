import { describe, expect, it } from "bun:test";
import { joinCommand } from "./join-command";

describe("joinCommand", () => {
	it("runs a worker that spends the token", () => {
		expect(joinCommand("https://splates.example.com", "splj_t")).toBe(
			"splates worker run --server https://splates.example.com --join splj_t",
		);
	});
});

import { describe, expect, it } from "bun:test";
import { joinCommand, windowsJoinCommand } from "./join-command";

describe("join commands", () => {
	it("runs a worker that spends the token", () => {
		expect(joinCommand("https://splates.example.com", "splj_t")).toBe(
			"splates worker run --server https://splates.example.com --join splj_t",
		);
	});

	it("runs the installer of the coordinator's release with the token", () => {
		expect(
			windowsJoinCommand("https://splates.example.com", "splj_t", "1.2.3"),
		).toBe(
			"& ([scriptblock]::Create((irm https://raw.githubusercontent.com/stringsync/splates/v1.2.3/windows/install-worker.ps1))) -Coordinator 'https://splates.example.com' -Join 'splj_t' -Version '1.2.3'",
		);
	});
});

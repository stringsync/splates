import { describe, expect, it } from "bun:test";
import type { AutomationRow } from "@stringsync/splates-server/hooks";
import type { AgentPick } from "@stringsync/splates-server/models";
import { BoardGroomer } from "./board-groomer";

describe("BoardGroomer", () => {
	it("chooses an agent on first use, then enables grooming with that pick", async () => {
		const picked: AgentPick[] = [];
		const groomer = new BoardGroomer({
			read: async () => [],
			resume: async () => {
				throw new Error("no groomer configured");
			},
			groom: async (pick) => {
				picked.push(pick);
				return [];
			},
		});
		await groomer.start();
		expect(groomer.picking).toBe(true);
		await groomer.choose({ agent: "codex" });
		expect(picked).toEqual([{ agent: "codex" }]);
		expect(groomer.picking).toBe(false);
	});

	it("starts the configured groomer, and reports a refused request", async () => {
		let resumed = false;
		const groomer = new BoardGroomer({
			read: async () => [{ id: "groomer" } as AutomationRow],
			resume: async () => {
				resumed = true;
				throw new Error("offline");
			},
			groom: async () => [],
		});
		await groomer.start();
		expect(resumed).toBe(true);
		expect(groomer.picking).toBe(false);
		expect(groomer.pending).toBe(false);
		expect(groomer.refusal).toContain("offline");
	});
});

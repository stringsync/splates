import { describe, expect, it } from "bun:test";
import type { RosterAgent } from "../models";
import { quotaLeft } from "./quota";

describe("quotaLeft", () => {
	it("leaves what the most used unreset window leaves, per model", () => {
		const rows = quotaLeft(
			[claude, codex],
			{
				claude: [
					{
						window: "five_hour",
						used: 0.2,
						resets: "2026-11-26T14:00:00Z",
						at: "2026-11-26T11:00:00Z",
					},
					{
						window: "seven_day",
						used: 0.65,
						resets: "2026-11-30T00:00:00Z",
						at: "2026-11-26T11:00:00Z",
					},
					// Reset already, so it no longer binds.
					{
						window: "seven_day_opus",
						used: 0.99,
						resets: "2026-11-26T10:00:00Z",
						at: "2026-11-25T11:00:00Z",
					},
					// Another model's cap does not bind opus.
					{
						window: "cap:haiku",
						used: 0.9,
						resets: null,
						at: "2026-11-26T11:00:00Z",
					},
				],
			},
			NOW,
		);
		expect(rows).toEqual([
			{
				agent: "claude",
				model: "opus",
				left: 0.35,
				window: "seven_day",
				resets: "2026-11-30T00:00:00Z",
				at: "2026-11-26T11:00:00Z",
			},
			{
				agent: "claude",
				model: "haiku",
				left: expect.closeTo(0.1, 5) as unknown as number,
				window: "cap:haiku",
				resets: null,
				at: "2026-11-26T11:00:00Z",
			},
			{
				agent: "codex",
				model: "gpt",
				left: null,
				window: null,
				resets: null,
				at: null,
			},
		]);
	});
});

function model(id: string) {
	return {
		id,
		name: id,
		strengths: "",
		cost: "",
		tier: 1,
		speed: "medium" as const,
		costRank: 1,
	};
}

const claude: RosterAgent = {
	id: "claude",
	name: "Claude",
	argv: ["claude"],
	models: [model("opus"), model("haiku")],
};
const codex: RosterAgent = {
	id: "codex",
	name: "Codex",
	argv: ["codex"],
	models: [model("gpt")],
};

const NOW = new Date("2026-11-26T12:00:00Z");

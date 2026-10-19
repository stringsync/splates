import { describe, expect, it } from "bun:test";
import { Clef } from "./clef";
import { serve } from "./testing";

const JUDGMENT = {
	state: { prompt: "hi" },
	questions: { lookup: { type: "noul" as const, instructions: "Is it?" } },
};

describe("Clef", () => {
	it("reads answers wrapped in Workers AI's result, kept between 0 and 1", async () => {
		const server = serve({ result: { answers: { lookup: { noul: 1.2 } } } });
		const verdict = await new Clef("acct", "tok", {
			fetch: server.fetch,
		}).judge(JUDGMENT);
		expect(verdict.answers.get("lookup")).toBe(1);
		expect(server.requests[0]?.url).toBe(
			"https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash",
		);
	});

	it("refuses a reply with no answers", async () => {
		const server = serve({ result: {} });
		await expect(
			new Clef("acct", "tok", { fetch: server.fetch }).judge(JUDGMENT),
		).rejects.toThrow("Clef answered with no answers in it");
	});
});

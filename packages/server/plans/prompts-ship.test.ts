import { describe, expect, it } from "bun:test";
import { shipSlowReference } from "./prompts";

describe("shipSlowReference", () => {
	it("asks an agent to look without touching the running ship", () => {
		const text = shipSlowReference(
			{
				id: "c1",
				project: "mdom",
				stage: "gate",
				spent: 22 * 60_000,
				expected: 10 * 60_000,
				log: "a\nb",
			},
			"http://localhost:4310",
		);
		expect(text).toContain(
			"`gate` stage of `mdom` is slow: 22m so far against about 10m",
		);
		expect(text).toContain("project=mdom&stage=gate");
		expect(text).toContain("Do not stop it, retry it");
		expect(text).toContain("a\nb");
	});
});

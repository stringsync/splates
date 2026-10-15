import { describe, expect, test } from "bun:test";
import { CountingDecider } from "./counting-decider";

describe("CountingDecider", () => {
	test("counts what it was asked and answers with no opinion", async () => {
		const decider = new CountingDecider();
		const { answers } = await decider.decide("state", {
			a: { type: "noul", instructions: "?" },
			b: { type: "choice", instructions: "?", criteria: { x: "", y: "" } },
		});
		expect(answers.a).toEqual({ type: "noul", noul: 0.5 });
		expect(answers.b).toMatchObject({ probabilities: { x: 0.5, y: 0.5 } });
		expect(decider.requests).toBe(1);
		expect(decider.characters).toBeGreaterThan(2 * '"state"'.length);
		expect(decider.dollars(4)).toBe(decider.characters);
	});
});

import { describe, expect, it } from "bun:test";
import { assumedIn } from "./assumed";

describe("assumedIn", () => {
	const plan = [
		"# uploads",
		"",
		"## Assumptions",
		"",
		"- [ ] 3. What should the retry limit be?",
		"  - (a) Three tries, a second apart (chosen)",
		"  - (b) Five tries, backing off",
		"",
		"## Blocked",
		"",
		"- [x] 4. Should the old endpoint stay for a release? → challenged: drop it",
		"  - (a) Keep it for a release (chosen)",
		"  - (b) Remove it now",
	].join("\n");

	it("reads each call as its task's plan writes it, by number, even once challenged into Blocked", () => {
		const found = assumedIn(plan, [
			{ number: "3", text: "Three tries, a second apart" },
			{ number: "4", text: "Kept the old endpoint for a release" },
		]);

		expect(found).toEqual([
			expect.objectContaining({
				number: "3",
				text: "What should the retry limit be?",
				choices: [
					expect.objectContaining({ key: "a", chosen: true }),
					expect.objectContaining({ key: "b", chosen: false }),
				],
			}),
			expect.objectContaining({
				number: "4",
				text: "Should the old endpoint stay for a release?",
			}),
		]);
	});

	it("keeps a call the plan has no item for as its line, with no choices", () => {
		expect(
			assumedIn("", [{ number: "7", text: "Named it `MAX_RETRIES`" }]),
		).toEqual([
			{
				number: "7",
				done: false,
				text: "Named it `MAX_RETRIES`",
				body: "",
				reply: null,
				followUps: [],
				choices: [],
				pick: null,
			},
		]);
	});

	it("shows a call in the exhibit the reply captions it with, unless its plan shows it something", () => {
		const exhibit = { title: "The rail", body: "![rail](/abs/rail.png)" };
		const [planned, bare] = assumedIn(
			[
				"## Assumptions",
				"",
				"- [ ] 3. What should the retry limit be?",
				"  ![limits](/abs/limits.png)",
				"  - (a) Three tries (chosen)",
			].join("\n"),
			[
				{ number: "3", text: "Three tries", exhibit },
				{ number: "8", text: "A rail beside the thread", exhibit },
			],
		);

		expect(planned?.body).toBe("![limits](/abs/limits.png)");
		expect(bare?.body).toBe("![rail](/abs/rail.png)");
	});
});

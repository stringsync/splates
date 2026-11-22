import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";

const STEPS = `The secret has to be rolled by hand.

## 📋 Steps: Rotate the webhook secret

Only you can reach the dashboard.

1. Open Stripe → Developers → Webhooks.
2. Copy the new signing secret.
   It shows once.
3. Store it as a cred:

   \`\`\`
   splates creds set STRIPE_WEBHOOK_SECRET
   \`\`\`
4. Did the test event answer 200?

Tell me if it did not.`;

describe("a Steps card", () => {
	it("reads its title, its words around the list, and each step with what is indented under it", () => {
		const found = stretches(STEPS);

		expect(found.map((each) => each.type)).toEqual(["text", "steps"]);
		expect(found[1]).toEqual({
			type: "steps",
			steps: {
				title: "Rotate the webhook secret",
				intro: "Only you can reach the dashboard.",
				steps: [
					"Open Stripe → Developers → Webhooks.",
					"Copy the new signing secret.\nIt shows once.",
					"Store it as a cred:\n```\nsplates creds set STRIPE_WEBHOOK_SECRET\n```",
					"Did the test event answer 200?",
				],
				outro: "Tell me if it did not.",
			},
		});
	});

	it("ends at a list of questions after its own", () => {
		const found = stretches(
			`## 📋 Steps: Try it\n\n1. Open the page.\n2. Press Go.\n\n1. Should it stay?\n   - (a) Yes (chosen)\n   - (b) No`,
		);

		expect(found.map((each) => each.type)).toEqual(["steps", "questions"]);
	});

	it("ends at the next heading", () => {
		const found = stretches(
			"## 📋 Steps: Try it\n\n1. Open the page.\n\n## ✅ Done: tried",
		);

		expect(found.map((each) => each.type)).toEqual(["steps", "report"]);
	});

	it("stays text with no steps under its title", () => {
		const found = stretches("## 📋 Steps: nothing\n\nJust words.");

		expect(found.map((each) => each.type)).toEqual(["text"]);
	});
});

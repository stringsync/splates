import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";

describe("a run-command permission card", () => {
	it("takes its command from the first backticked line", () => {
		const [stretch] = stretches(
			"## 🔐 Permission: run command: build the web app\n\n`bun run build`\n\nTakes about two minutes.",
		).filter((each) => each.type === "permission");
		expect(stretch).toMatchObject({
			permission: {
				action: "run-command",
				title: "build the web app",
				command: "bun run build",
				body: "Takes about two minutes.",
			},
		});
	});
});

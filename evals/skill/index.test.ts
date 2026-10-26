import { expect, it } from "bun:test";
import { pickOf } from "./index";

it("reads agent, model and thinking level", () => {
	expect(pickOf("claude:sonnet@high")).toEqual({
		agent: "claude",
		model: "sonnet",
		effort: "high",
	});
	expect(pickOf("codex")).toEqual({ agent: "codex" });
	expect(() => pickOf("opencode:x")).toThrow("no eval runner");
});

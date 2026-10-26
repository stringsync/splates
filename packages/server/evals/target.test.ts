import { expect, it } from "bun:test";
import { targetName } from "./target";

it("names a baseline's skill revision, so it does not read as the agent twice", () => {
	const target = {
		key: "codex/gpt-6-astra",
		agent: "codex",
		model: "gpt-6-astra",
		effort: null,
		skill: null,
	};
	expect(targetName(target)).toBe("codex gpt-6-astra");
	expect(targetName({ ...target, skill: "5ad40921" })).toBe(
		"codex gpt-6-astra @5ad40921",
	);
});

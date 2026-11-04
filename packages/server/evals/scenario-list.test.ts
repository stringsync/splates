import { expect, test } from "bun:test";
import { parseScenarioList } from "./scenario-list";

test("keeps definitions before a run and tolerates older frameworks", () => {
	const definition = {
		prompt: "Do it",
		checks: [{ id: "a", about: "Asks first" }],
		judge: "Explain why",
	};
	expect(
		parseScenarioList(JSON.stringify({ case: "a", ...definition }))[0],
	).toMatchObject(definition);
	expect(parseScenarioList('{"case":"old"}')).toEqual([
		{ id: "old", group: null, about: null },
	]);
	expect(
		parseScenarioList('{"case":"bad","prompt":7,"checks":[null,{"id":3}]}')[0]
			?.checks,
	).toEqual([]);
});

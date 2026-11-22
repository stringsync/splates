import { expect, it } from "bun:test";
import { shipsItself } from "./ships";

it("tells a release the agent runs itself from looking", () => {
	expect(
		[
			"npm publish",
			"cd x && bun publish --access public",
			"bin/lib ship run publish --bump patch",
			"bin/lib ship",
			"curl -X POST localhost:7000/api/ship/runs",
			"bin/lib ship plan",
			"bin/lib ship done publish",
			"git log v1.2.0..HEAD",
			"npm view @acme/dates version",
		].map(shipsItself),
	).toEqual([true, true, true, true, true, false, false, false, false]);
});

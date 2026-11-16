import { expect, it } from "bun:test";
import { asksToShip, shipsItself } from "./ships";

it("finds a ship card naming the target", () => {
	const reply = [
		"The fix is on main, unreleased.",
		"",
		"## 🔐 Permission: ship: release the timezone fix",
		"",
		"- `@acme/dates` patch",
		"",
		"People keep hitting the crash.",
	].join("\n");
	expect(asksToShip(reply, "@acme/dates")).toBe(true);
	expect(asksToShip(reply, "@acme/other")).toBe(false);
	expect(
		asksToShip(
			"## 🔐 Permission: run command: ship\n\n`splates ship`\n",
			"@acme/dates",
		),
	).toBe(false);
});

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

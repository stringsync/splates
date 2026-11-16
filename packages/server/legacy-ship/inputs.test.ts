import { describe, expect, it } from "bun:test";
import {
	COMMAND_INPUT,
	commandInputs,
	inputArguments,
	type ShipInputs,
} from "./inputs";

describe("ship inputs", () => {
	it("uses declared defaults and preserves false and empty choices", () => {
		expect(commandInputs(declared)).toEqual({
			bump: "patch",
			prod: false,
			region: "east",
		});
		expect(
			commandInputs(declared, { bump: "major", prod: false, region: "" }),
		).toEqual({ bump: "major", prod: false, region: "" });
	});
	it.each([
		{ bump: "oops" },
		{ prod: "false" },
		{ region: true },
		{ unknown: "value" },
	] as ShipInputs[])("refuses invalid choices: %j", (chosen) => {
		expect(() => commandInputs(declared, chosen)).toThrow();
	});
	it("quotes inputs as literal shell arguments", () => {
		const value = "a=b 'quoted' $(printf surprise) `printf surprise`\nnext";
		const output = Bun.spawnSync([
			"sh",
			"-c",
			`printf '%s\\n'${inputArguments({ region: value, prod: false })}`,
		]);
		expect(output.stdout.toString()).toBe(
			`--input\nregion=${value}\n--input\nprod=false\n`,
		);
	});
	it("rejects invalid defaults in a command plan", () => {
		expect(
			COMMAND_INPUT.safeParse({
				name: "bump",
				label: "Bump",
				type: "choice",
				options: ["patch"],
				default: "minor",
			}).success,
		).toBe(false);
	});
});

const declared = [
	COMMAND_INPUT.parse({
		name: "bump",
		label: "Bump",
		type: "choice",
		options: ["patch", "minor", "major"],
		default: "patch",
	}),
	COMMAND_INPUT.parse({
		name: "prod",
		label: "Production",
		type: "boolean",
		default: false,
	}),
	COMMAND_INPUT.parse({
		name: "region",
		label: "Region",
		type: "string",
		default: "east",
	}),
];

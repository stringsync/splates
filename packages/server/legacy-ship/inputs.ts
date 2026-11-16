import { z } from "zod";

const COMMON = { name: z.string().min(1), label: z.string().min(1) };
/** Validate the choice, boolean and text controls a ship command declares. */
export const COMMAND_INPUT = z.discriminatedUnion("type", [
	z
		.object({
			...COMMON,
			type: z.literal("choice"),
			options: z.array(z.string()).min(1),
			default: z.string(),
		})
		.refine(
			(input) => input.options.includes(input.default),
			"default must be an option",
		),
	z.object({ ...COMMON, type: z.literal("boolean"), default: z.boolean() }),
	z.object({ ...COMMON, type: z.literal("string"), default: z.string() }),
]);
export type CommandInput = z.infer<typeof COMMAND_INPUT>;
export type ShipInputs = Record<string, string | boolean>;
export const GRAPH_INPUTS = z.record(
	z.string(),
	z.record(z.string(), z.union([z.string(), z.boolean()])),
);

/** Apply declared defaults and refuse unknown names and invalid values before starting. */
export function commandInputs(
	declared: CommandInput[],
	chosen: ShipInputs = {},
): ShipInputs {
	for (const name of Object.keys(chosen)) {
		if (!declared.some((input) => input.name === name)) {
			throw new Error(`Unknown ship input: ${name}`);
		}
	}
	return Object.fromEntries(
		declared.map((input) => {
			const value = Object.hasOwn(chosen, input.name)
				? (chosen[input.name] ?? input.default)
				: input.default;
			if (
				typeof value !== (input.type === "boolean" ? "boolean" : "string") ||
				(input.type === "choice" && !input.options.includes(String(value)))
			) {
				throw new Error(`Invalid ship input: ${input.name}`);
			}
			return [input.name, value];
		}),
	);
}

/** Append each input as a single shell argument, preserving spaces, quotes and equals signs. */
export function inputArguments(inputs: ShipInputs): string {
	return Object.entries(inputs)
		.map(
			([name, value]) =>
				` --input '${`${name}=${value}`.replaceAll("'", "'\"'\"'")}'`,
		)
		.join("");
}

/**
 * The inputs chosen for a ship at `bump`: the bump goes to the command as its
 * built-in `bump` input when it declares one, so the release works out the
 * version it plans and publishes.
 */
export function withBump(
	declared: CommandInput[],
	chosen: ShipInputs | undefined,
	bump: string | undefined,
): ShipInputs | undefined {
	if (bump === undefined || !declared.some((each) => each.name === "bump")) {
		return chosen;
	}
	return { ...chosen, bump };
}

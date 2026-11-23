import type { Rig } from "./wire";

/** The value each option starts with, by name. */
export type OptionValues = Record<string, boolean | string | number>;

/**
 * `given` checked against `rig`'s options and filled with their defaults: a
 * name it does not declare, or a value of the wrong type, throws.
 */
export function optionValues(rig: Rig, given: OptionValues): OptionValues {
	const values: OptionValues = {};
	for (const name of Object.keys(given)) {
		if (!rig.options.some((option) => option.name === name)) {
			throw new Error(`${rig.name} has no option "${name}"`);
		}
	}
	for (const option of rig.options) {
		const value = given[option.name] ?? option.default;
		const fits =
			option.type === "enum"
				? typeof value === "string" && option.values.includes(value)
				: option.type === "number"
					? typeof value === "number" && Number.isFinite(value)
					: typeof value === option.type;
		if (!fits) {
			throw new Error(
				`${rig.name}'s ${option.name} takes ${option.type === "enum" ? option.values.join(" | ") : `a ${option.type}`}, not ${JSON.stringify(value)}`,
			);
		}
		values[option.name] = value;
	}
	return values;
}

/** The words after the command that start `rig` with `values`: `start <rig> --<name>=<value>…`. */
export function startWords(rig: Rig, values: OptionValues): string[] {
	return [
		"start",
		rig.name,
		...rig.options.map((option) => `--${option.name}=${values[option.name]}`),
	];
}

/** The environment variables for the ports picked for a rig. */
export function portEnv(
	rig: Rig,
	picked: Record<string, number>,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [index, name] of rig.ports.entries()) {
		const port = picked[name];
		if (port === undefined) {
			throw new Error(`no port picked for ${rig.name}'s "${name}"`);
		}
		env[`PORT_${name.toUpperCase().replaceAll("-", "_")}`] = String(port);
		if (index === 0) {
			env.PORT = String(port);
		}
	}
	return env;
}

/** The environment of a running rig and its command health checks. */
export function runEnv(
	rig: Rig,
	ports: Record<string, number>,
	id: string,
	serverUrl?: string | null,
): Record<string, string> {
	return {
		...portEnv(rig, ports),
		SPLATES_RIG: id,
		...(serverUrl == null ? {} : { SPLATES_DEV: serverUrl }),
	};
}

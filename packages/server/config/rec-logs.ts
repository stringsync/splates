import type { RecLogSource } from "./config";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The log sources a config's `rec` names, checked: each a `name` of lowercase
 * letters and digits joined by dashes, unique, with a `command`, and a `zone`
 * of `utc` or `local` when it has one. Throws naming what is wrong.
 */
export function recLogSources(rec: unknown): RecLogSource[] {
	if (rec === undefined || rec === null) {
		return [];
	}
	const logs = (rec as { logs?: unknown }).logs;
	if (logs === undefined) {
		return [];
	}
	if (!Array.isArray(logs)) {
		throw new Error(
			'splates.config.ts: `rec.logs` is a list of log sources, as [{ name: "api", command: "..." }]',
		);
	}
	const seen = new Set<string>();
	return logs.map((each: unknown): RecLogSource => {
		const source = (each ?? {}) as Partial<Record<keyof RecLogSource, unknown>>;
		const { name, command, zone, label } = source;
		if (typeof name !== "string" || !NAME.test(name)) {
			throw new Error(
				`splates.config.ts: each of \`rec.logs\` has a name of lowercase letters and digits joined by dashes: not ${JSON.stringify(name)}`,
			);
		}
		if (seen.has(name)) {
			throw new Error(`splates.config.ts: \`rec.logs\` names '${name}' twice`);
		}
		seen.add(name);
		if (typeof command !== "string" || !command.trim()) {
			throw new Error(
				`splates.config.ts: \`rec.logs\` '${name}' needs a command`,
			);
		}
		if (zone !== undefined && zone !== "utc" && zone !== "local") {
			throw new Error(
				`splates.config.ts: \`rec.logs\` '${name}' has a zone of "utc" or "local"`,
			);
		}
		if (label !== undefined && typeof label !== "string") {
			throw new Error(
				`splates.config.ts: \`rec.logs\` '${name}' has a label that is text`,
			);
		}
		return {
			name,
			command,
			...(zone === undefined ? {} : { zone }),
			...(label === undefined ? {} : { label }),
		};
	});
}

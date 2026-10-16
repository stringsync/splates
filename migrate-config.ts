import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { typedConfig, withoutSystems } from "./config-source";
import { CONFIG_FILE, ConfigFiles } from "./load-config";
import { checkSystems, SYSTEMS_FILE, type SystemsFile } from "./systems";

/**
 * Moves the systems an older `arbor.config.ts` names into `arbor.systems.ts`,
 * taking the `systems` key out of the config. Does nothing when the config
 * names none. Rewrites the config only once re-importing it shows the rest of
 * it unchanged, and puts it back otherwise. Answers with the exit code to end
 * on.
 */
export async function moveSystems({
	root,
	fs,
	log,
}: {
	/** The repository's main tree. */
	root: string;
	fs: Fs;
	log: Logger;
}): Promise<number> {
	const config = await new ConfigFiles(fs).importConfig(root);
	if (config.systems === undefined) {
		return 0;
	}
	const configPath = `${root}/${CONFIG_FILE}`;
	const systemsPath = `${root}/${SYSTEMS_FILE}`;
	const byHand = `move \`systems\` from ${CONFIG_FILE} into ${SYSTEMS_FILE} by hand`;
	if (await fs.exists(systemsPath)) {
		log.error(
			`both ${CONFIG_FILE} and ${SYSTEMS_FILE} name systems: ${byHand}`,
		);
		return 1;
	}
	const systems = checkSystems(`${configPath}: systems`, config.systems);

	const before = await fs.read(configPath);
	const after = withoutSystems(before);
	if (after === null) {
		log.error(
			`could not find \`systems\` to take out of ${CONFIG_FILE}: ${byHand}`,
		);
		return 1;
	}
	await fs.write(configPath, after);
	const { systems: _, ...rest } = config;
	const rewritten = await new ConfigFiles(fs)
		.importConfig(root)
		.catch(() => null);
	if (
		rewritten === null ||
		JSON.stringify(rewritten) !== JSON.stringify(rest)
	) {
		await fs.write(configPath, before);
		log.error(
			`taking \`systems\` out of ${CONFIG_FILE} changed the rest of it: ${byHand}`,
		);
		return 1;
	}
	await fs.write(systemsPath, systemsSource(systems));
	const count = Object.keys(systems).length;
	log.info(
		`${color.green("moved")} ${count} ${count === 1 ? "system" : "systems"} from ${CONFIG_FILE} to ${SYSTEMS_FILE}`,
	);
	return 0;
}

/**
 * Types an older `arbor.config.ts` by a type-only import and `satisfies`
 * rather than `defineConfig`, so a reader can import it without arbor
 * installed. Leaves a config it cannot rewrite as it is, since
 * `defineConfig` still works. Rewrites it only once re-importing it shows it
 * unchanged, and puts it back otherwise.
 */
export async function typeConfig({
	root,
	fs,
	log,
}: {
	/** The repository's main tree. */
	root: string;
	fs: Fs;
	log: Logger;
}): Promise<void> {
	const path = `${root}/${CONFIG_FILE}`;
	if (!(await fs.exists(path))) {
		return;
	}
	const before = await fs.read(path);
	if (!before.includes("defineConfig")) {
		return;
	}
	const after = typedConfig(before);
	if (after === null) {
		log.info(
			`left ${CONFIG_FILE} calling \`defineConfig\`: type it with \`satisfies ConfigFile\` by hand`,
		);
		return;
	}
	const config = await new ConfigFiles(fs).importConfig(root);
	await fs.write(path, after);
	const rewritten = await new ConfigFiles(fs)
		.importConfig(root)
		.catch(() => null);
	if (JSON.stringify(rewritten) !== JSON.stringify(config)) {
		await fs.write(path, before);
		log.info(
			`left ${CONFIG_FILE} calling \`defineConfig\`: type it with \`satisfies ConfigFile\` by hand`,
		);
		return;
	}
	log.info(
		`${color.green("typed")} ${CONFIG_FILE} with \`satisfies ConfigFile\``,
	);
}

/** An `arbor.systems.ts` that names `systems`, keys unquoted where they can be. */
export function systemsSource(systems: SystemsFile): string {
	const literal = JSON.stringify(systems, null, "\t").replace(
		/^(\s*)"([A-Za-z_$][\w$]*)":/gm,
		"$1$2:",
	);
	return `import type { SystemsFile } from "@webappwiz/arbor/systems";

export default ${literal} satisfies SystemsFile;
`;
}

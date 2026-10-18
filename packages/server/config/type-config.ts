import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { CONFIG_FILE, ConfigFiles, typedConfig } from ".";

/**
 * Types an older `splates.config.ts` by a type-only import and `satisfies`
 * rather than `defineConfig`, so a reader can import it without splates
 * installed. Leaves a config it cannot safely rewrite unchanged and logs
 * instructions for typing it by hand.
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

import type { Fs } from "webappwiz/system";
import { z } from "zod";

/**
 * Where the user's Pulumi project is, which `splates server infra init`
 * writes and `splates server deploy` reads the box from.
 */
const InfraConfig = z.object({
	/** The Pulumi project's directory. */
	dir: z.string(),
	stack: z.string().optional(),
	/** The private key that logs in as root, when it is the user's own rather than the stack's `sshKey`. */
	key: z.string().optional(),
});
export type InfraConfig = z.infer<typeof InfraConfig>;

/** Where the infra project is recorded, under splates's home. */
export function infraConfigPath(home: string): string {
	return `${home}/coordinator/infra.json`;
}

/** The recorded infra project; null for none. */
export async function readInfraConfig(
	fs: Fs,
	home: string,
): Promise<InfraConfig | null> {
	const path = infraConfigPath(home);
	return (await fs.exists(path))
		? InfraConfig.parse(JSON.parse(await fs.read(path)))
		: null;
}

/** Records `config` as the infra project, over what was there. */
export async function writeInfraConfig(
	fs: Fs,
	home: string,
	config: InfraConfig,
): Promise<void> {
	const path = infraConfigPath(home);
	await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
	await fs.write(path, `${JSON.stringify(config, null, "\t")}\n`);
}

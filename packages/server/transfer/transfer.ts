import type { Fs } from "webappwiz/system";
import { fail } from "../exit";

/** What an export file says it is, so an import refuses any other JSON. */
export const BUNDLE_FORMAT = "splates-config";

export const BUNDLE_VERSION = 1;

/**
 * What moves from a project's `.git/splates`: its hooks, and its tasks,
 * plans and conversations. Never `creds.json`, which names what the
 * project's agents asked a person for, nor the journal, locks or leases,
 * which belong to this machine and its processes.
 */
export const PROJECT_STATE = [
	"hooks.json",
	"tasks",
	"plans",
	"finished",
	"conversations",
];

/** What moves from splates's home: what the person set, not what this machine does for itself. */
export const MACHINE_STATE = ["agents.json", "auto-pick.json"];

/** Files that stay behind wherever they are found. */
const KEPT_BACK = /(^|\/)creds\.json$|\.lock(\/|$)/;

/** What an export holds: each file's text, by path under its directory. */
export interface Bundle {
	format: typeof BUNDLE_FORMAT;
	version: number;
	project: Record<string, string>;
	machine: Record<string, string>;
}

/** Where a bundle's two halves are read from and written to. */
export interface Places {
	fs: Fs;
	/** The project's `.git/splates`. */
	splatesDir: string;
	/** splates's home. */
	home: string;
}

/** Reads the project's and the machine's configuration into a bundle. */
export async function exportBundle({
	fs,
	splatesDir,
	home,
}: Places): Promise<Bundle> {
	return {
		format: BUNDLE_FORMAT,
		version: BUNDLE_VERSION,
		project: await collect(fs, splatesDir, PROJECT_STATE),
		machine: await collect(fs, home, MACHINE_STATE),
	};
}

/** How `importBundle` treats what is already here. */
export interface ImportOptions {
	/** Overwrite files that differ from the bundle instead of stopping. */
	force: boolean;
}

/** What importing a bundle did. */
export interface Imported {
	written: string[];
	/** Files the bundle names that already exist here with other contents. */
	conflicts: string[];
}

/**
 * Writes a bundle's files, leaving what is here alone and naming it when it
 * differs from the bundle, unless `force` overwrites it.
 */
export async function importBundle(
	places: Places,
	bundle: Bundle,
	opts: ImportOptions,
): Promise<Imported> {
	const { fs, splatesDir, home } = places;
	const targets = [
		...Object.entries(bundle.project).map(
			([path, text]) =>
				[`${splatesDir}/${path}`, text, `project ${path}`] as const,
		),
		...Object.entries(bundle.machine).map(
			([path, text]) => [`${home}/${path}`, text, `machine ${path}`] as const,
		),
	];
	const conflicts: string[] = [];
	for (const [path, text, label] of targets) {
		if ((await fs.exists(path)) && (await fs.read(path)) !== text) {
			conflicts.push(label);
		}
	}
	if (conflicts.length > 0 && !opts.force) {
		fail(
			"exists",
			`${conflicts.length} file(s) here differ from the export: ${conflicts.join(", ")}.\nRun again with --force to overwrite them.`,
			{ conflicts },
		);
	}
	const written: string[] = [];
	for (const [path, text, label] of targets) {
		if ((await fs.exists(path)) && (await fs.read(path)) === text) {
			continue;
		}
		await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
		await fs.write(path, text);
		written.push(label);
	}
	return { written, conflicts };
}

/** Reads an export file's text as a bundle, refusing anything else. */
export function parseBundle(text: string, from: string): Bundle {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		fail(
			"usage",
			`${from} is not JSON: give it an export from \`splates config export\``,
			{
				path: from,
			},
		);
	}
	const bundle = json as Partial<Bundle> | null;
	if (bundle?.format !== BUNDLE_FORMAT) {
		fail("usage", `${from} is not a splates export`, { path: from });
	}
	if (typeof bundle.version !== "number" || bundle.version > BUNDLE_VERSION) {
		fail(
			"outdated",
			`${from} was written by a newer splates: run \`bunx @stringsync/splates@latest\` instead`,
			{ path: from },
		);
	}
	for (const half of [bundle.project, bundle.machine]) {
		for (const [path, body] of Object.entries(half ?? {})) {
			if (
				typeof body !== "string" ||
				path.startsWith("/") ||
				path.split("/").includes("..") ||
				KEPT_BACK.test(path)
			) {
				fail("usage", `${from} holds a file splates will not import: ${path}`, {
					path: from,
				});
			}
		}
	}
	return {
		format: BUNDLE_FORMAT,
		version: bundle.version,
		project: bundle.project ?? {},
		machine: bundle.machine ?? {},
	};
}

/** Each file under `names` in `dir`, trees followed, as text by relative path. */
async function collect(
	fs: Fs,
	dir: string,
	names: string[],
): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	const visit = async (relative: string): Promise<void> => {
		if (KEPT_BACK.test(relative) || !(await fs.exists(`${dir}/${relative}`))) {
			return;
		}
		if ((await fs.stat(`${dir}/${relative}`)).isDirectory()) {
			for (const each of await fs.readdir(`${dir}/${relative}`)) {
				await visit(`${relative}/${each}`);
			}
			return;
		}
		files[relative] = await fs.read(`${dir}/${relative}`);
	};
	for (const name of names) {
		await visit(name);
	}
	return files;
}

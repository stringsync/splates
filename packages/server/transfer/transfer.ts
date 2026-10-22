import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { type CredRequest, type Creds, SCOPES } from "../creds";
import { fail } from "../exit";
import type { Storage } from "../storage";

/** What an export file says it is, so an import refuses any other JSON. */
export const BUNDLE_FORMAT = "splates-config";

/** 2 added `creds`, what to ask for again where the bundle goes. */
export const BUNDLE_VERSION = 2;

/** What an export holds: each file's text, by path under its directory, and the creds to ask for again. */
export interface Bundle {
	format: typeof BUNDLE_FORMAT;
	version: number;
	project: Record<string, string>;
	machine: Record<string, string>;
	creds: AskedCred[];
}

/** Where a bundle's two halves are read from and written to. */
export interface Places {
	/** Reads and writes the machine's half, files under `home`. */
	fs: Fs;
	/** The project's records, which its half is read from and written to. */
	storage: Storage;
	/** splates's home. */
	home: string;
}

/**
 * Reads the project's and the machine's configuration into a bundle, with
 * each cred `requests` asked for and the person did not turn down.
 */
export async function exportBundle(
	{ fs, storage, home }: Places,
	requests: CredRequest[],
	{ conversations = true }: ExportOptions = {},
): Promise<Bundle> {
	return {
		format: BUNDLE_FORMAT,
		version: BUNDLE_VERSION,
		project: await collectRecords(
			storage,
			conversations
				? PROJECT_STATE
				: PROJECT_STATE.filter((name) => name !== "conversations"),
		),
		machine: await collect(fs, home, MACHINE_STATE),
		creds: requests
			.filter((each) => each.status !== "dismissed")
			.map(({ name, scope, purpose, instructions }) => ({
				name,
				scope,
				purpose,
				instructions,
			}))
			.toSorted((left, right) => left.name.localeCompare(right.name)),
	};
}

/**
 * Asks the person again for each of the bundle's creds `creds` does not keep
 * yet, with the purpose and instructions they were first asked with, so the
 * Creds page lists what to fill in; the names asked for.
 */
export async function askAgain(
	creds: Creds,
	bundle: Bundle,
): Promise<string[]> {
	const asked: string[] = [];
	for (const { name, scope, purpose, instructions } of bundle.creds) {
		const request = await creds.request(name, {
			scope,
			purpose: purpose.trim() === "" ? NO_PURPOSE : purpose,
			instructions,
			task: null,
		});
		if (request !== null) {
			asked.push(name);
		}
	}
	return asked;
}

/** What `exportBundle` leaves out. */
export interface ExportOptions {
	/** Whether the conversations go too, most of an export's size; they do by default. */
	conversations?: boolean;
}

/** How `importBundle` treats what is already here. */
export interface ImportOptions {
	/** Overwrite files that differ from the bundle instead of stopping. */
	force: boolean;
	/**
	 * Directories of the project's half whose files here stay as they are,
	 * the bundle's copy left out rather than a conflict: a running server's
	 * conversations, which write their own logs.
	 */
	keep?: readonly string[];
}

/** What importing a bundle did. */
export interface Imported {
	written: string[];
	/** Files the bundle names that already exist here with other contents. */
	conflicts: string[];
	/** Files under `keep` that exist here, left as they are. */
	kept: string[];
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
	const { fs, storage, home } = places;
	const kept: string[] = [];
	const project: [string, string][] = [];
	for (const [path, text] of Object.entries(bundle.project)) {
		if (
			(opts.keep ?? []).some((dir) => path.startsWith(`${dir}/`)) &&
			(await readRecord(storage, path)) !== null
		) {
			kept.push(`project ${path}`);
			continue;
		}
		project.push([path, text]);
	}
	const machine = Object.entries(bundle.machine).map(
		([path, text]) => [`${home}/${path}`, text] as const,
	);
	const conflicts: string[] = [];
	for (const [path, text] of project) {
		const there = await readRecord(storage, path);
		if (there !== null && there !== text) {
			conflicts.push(`project ${path}`);
		}
	}
	for (const [path, text] of machine) {
		if ((await fs.exists(path)) && (await fs.read(path)) !== text) {
			conflicts.push(`machine ${path.slice(home.length + 1)}`);
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
	for (const [path, text] of project) {
		if ((await readRecord(storage, path)) === text) {
			continue;
		}
		await writeRecord(storage, path, text);
		written.push(`project ${path}`);
	}
	for (const [path, text] of machine) {
		if ((await fs.exists(path)) && (await fs.read(path)) === text) {
			continue;
		}
		await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
		await fs.write(path, text);
		written.push(`machine ${path.slice(home.length + 1)}`);
	}
	return { written, conflicts, kept };
}

/** The record at `path` in `storage` as text, or null for none: a log as its lines. */
async function readRecord(
	storage: Storage,
	path: string,
): Promise<string | null> {
	const at = path.lastIndexOf("/");
	return storage
		.collection(at < 0 ? "" : path.slice(0, at))
		.read(path.slice(at + 1));
}

/** Writes `text` as the record at `path`, a `.jsonl` one as a log, which is how splates reads it back. */
async function writeRecord(
	storage: Storage,
	path: string,
	text: string,
): Promise<void> {
	if (path.endsWith(".jsonl")) {
		const log = storage.log(path);
		await log.remove();
		await log.append(
			// A line a crash cut short is left out, as a log is read.
			...text.split("\n").flatMap((line): unknown[] => {
				try {
					return line === "" ? [] : [JSON.parse(line)];
				} catch {
					return [];
				}
			}),
		);
		return;
	}
	const at = path.lastIndexOf("/");
	await storage
		.collection(at < 0 ? "" : path.slice(0, at))
		.write(path.slice(at + 1), text);
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
	const creds = z.array(ASKED).safeParse(bundle.creds ?? []);
	if (!creds.success) {
		fail("usage", `${from} holds creds splates cannot read`, { path: from });
	}
	return {
		format: BUNDLE_FORMAT,
		version: bundle.version,
		project: bundle.project ?? {},
		machine: bundle.machine ?? {},
		creds: creds.data,
	};
}

/** Each record under `names` in `storage`, trees followed, as text by relative path. */
async function collectRecords(
	storage: Storage,
	names: string[],
): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	const visit = async (relative: string): Promise<void> => {
		if (KEPT_BACK.test(relative)) {
			return;
		}
		const text = await readRecord(storage, relative);
		if (text !== null) {
			files[relative] = text;
			return;
		}
		for (const each of await storage.collection(relative).list()) {
			await visit(`${relative}/${each}`);
		}
		for (const each of await storage.children(relative)) {
			await visit(`${relative}/${each}`);
		}
	};
	for (const name of names) {
		await visit(name);
	}
	return files;
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

/**
 * A cred the project's agents asked for, by name and with how to get it but
 * never its value, for the import to ask the person for again.
 */
const ASKED = z.object({
	name: z.string(),
	scope: z.enum(SCOPES),
	purpose: z.string(),
	instructions: z.string(),
});

export type AskedCred = z.infer<typeof ASKED>;

/** What a request from before requests said what for asks again with. */
const NO_PURPOSE =
	"Used by this project's agents on the machine this setup was exported from.";

/**
 * What moves from a project's records: its hooks, and its tasks,
 * lanes, plans, conversations and the records of tasks it ended. Never `creds.json`, which
 * holds this machine's record of requests (the bundle carries what to ask
 * for again in `creds`), nor the journal, locks or leases,
 * which belong to this machine and its processes.
 */
export const PROJECT_STATE = [
	"hooks.json",
	"tasks",
	"plans",
	"finished",
	"removed",
	"conversations",
];

/** What moves from splates's home: what the person set, its agent defaults (`offered.json`) included. */
export const MACHINE_STATE = [
	"agents.json",
	"auto-pick.json",
	"offered.json",
	"eval-agents.json",
];

/** Files that stay behind wherever they are found. */
const KEPT_BACK = /(^|\/)creds\.json$|\.lock(\/|$)/;

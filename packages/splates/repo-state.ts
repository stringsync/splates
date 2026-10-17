import { isAbsolute, normalize } from "node:path";
import type { Fs } from "webappwiz/system";
import { z } from "zod";

/**
 * Runs `call` on the records under `root`, as the coordinator does for a
 * worker: the path never reaches outside `root`. Throws what `fs` throws, for
 * the route to answer as an error.
 */
export async function answerState(
	fs: Fs,
	root: string,
	call: StateCall,
): Promise<unknown> {
	const at = within(root, call.path);
	switch (call.op) {
		case "exists":
			return fs.exists(at);
		case "mkdir":
			// Recursive unless told otherwise, as `Fs` is.
			return fs.mkdir(at, { recursive: call.recursive ?? true });
		case "read":
			return fs.read(at);
		case "write":
			return fs.write(at, call.data);
		case "append":
			return fs.append(at, call.data);
		case "readBytes":
			return Buffer.from(await fs.readBytes(at)).toString("base64");
		case "writeBytes":
			return fs.writeBytes(at, Buffer.from(call.data, "base64"));
		case "rename":
			return fs.rename(at, within(root, call.to));
		case "readdir":
			return fs.readdir(at);
		case "stat": {
			const stat = await fs.stat(at);
			return {
				directory: stat.isDirectory(),
				size: stat.size,
				mtimeMs: stat.mtimeMs,
			} satisfies WireStat;
		}
		case "rm":
			return fs.rm(at, {
				recursive: call.recursive ?? false,
				force: call.force ?? false,
			});
		case "chmod":
			return fs.chmod(at, call.mode);
		case "isSymlink":
			return fs.isSymlink(at);
	}
}

/** `path` under `root`, refusing one that climbs out of it. */
function within(root: string, path: string): string {
	const relative = normalize(path === "" ? "." : path);
	if (isAbsolute(relative) || relative === ".." || relative.startsWith("../")) {
		throw new Error(`'${path}' is outside the project's records`);
	}
	return relative === "." ? root : `${root}/${relative}`;
}

/**
 * Which project's records a relayed call reaches: one by its slug, as an
 * agent's env names it, or the one whose origin URL a checkout shares, for
 * `splates` run by hand on a worker.
 */
export type StateProject = { slug: string } | { origin: string };

/** One `Fs` call on a project's records, a path relative to `.git/splates`. */
const StateCall = z.discriminatedUnion("op", [
	z.object({ op: z.literal("exists"), path: z.string() }),
	z.object({
		op: z.literal("mkdir"),
		path: z.string(),
		recursive: z.boolean().optional(),
	}),
	z.object({ op: z.literal("read"), path: z.string() }),
	z.object({ op: z.literal("write"), path: z.string(), data: z.string() }),
	z.object({ op: z.literal("append"), path: z.string(), data: z.string() }),
	z.object({ op: z.literal("readBytes"), path: z.string() }),
	// The bytes as base64.
	z.object({ op: z.literal("writeBytes"), path: z.string(), data: z.string() }),
	z.object({ op: z.literal("rename"), path: z.string(), to: z.string() }),
	z.object({ op: z.literal("readdir"), path: z.string() }),
	z.object({ op: z.literal("stat"), path: z.string() }),
	z.object({
		op: z.literal("rm"),
		path: z.string(),
		recursive: z.boolean().optional(),
		force: z.boolean().optional(),
	}),
	z.object({ op: z.literal("chmod"), path: z.string(), mode: z.number() }),
	z.object({ op: z.literal("isSymlink"), path: z.string() }),
]);
export type StateCall = z.infer<typeof StateCall>;

/** What `POST /api/state` takes. */
export const StateRequest = z.object({
	project: z.union([
		z.object({ slug: z.string() }),
		z.object({ origin: z.string() }),
	]),
	call: StateCall,
});

/** What a stat answers with over the wire. */
export interface WireStat {
	directory: boolean;
	size: number;
	mtimeMs: number;
}

/** Where a worker daemon says its relay listens, under `SPLATES_HOME`. */
export function relayFile(home: string): string {
	return `${home}/relay.json`;
}

/** What `relay.json` holds. */
const RelayFile = z.object({ url: z.string() });

/**
 * The coordinator a command on a worker reaches its project's records
 * through, and which project they are: the `splates server` the agent's env
 * names, else the relay this machine's worker daemon keeps; the project its
 * env names, else the one whose origin URL `origin` is. Null when no relay is
 * known, or no project can be named.
 */
export async function findRelay(
	{ fs, env }: { fs: Fs; env: (name: string) => string | undefined },
	home: string,
	origin: () => Promise<string | null>,
): Promise<{ url: string; project: StateProject } | null> {
	let url = env("SPLATES_DEV");
	if (url === undefined) {
		const read = await fs.read(relayFile(home)).catch(() => null);
		const parsed = read === null ? null : RelayFile.safeParse(safeJson(read));
		url = parsed?.success ? parsed.data.url : undefined;
	}
	if (url === undefined) {
		return null;
	}
	const slug = env("SPLATES_PROJECT");
	if (slug !== undefined) {
		return { url, project: { slug } };
	}
	const found = await origin();
	return found === null ? null : { url, project: { origin: found } };
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * An origin URL as one repository, however it is written: `git@host:a/b.git`,
 * `https://host/a/b`, and `ssh://git@host/a/b.git` are the same.
 */
export function sameOrigin(url: string): string {
	return url
		.trim()
		.replace(/^[a-z+]+:\/\//i, "")
		.replace(/^[^@/]+@/, "")
		.replace(/^([^/:]+):(?!\d)/, "$1/")
		.replace(/\/+$/, "")
		.replace(/\.git$/, "")
		.toLowerCase();
}

import { isAbsolute, normalize } from "node:path";
import type { Fs } from "webappwiz/system";
import { z } from "zod";
import type { Document, Storage } from "../storage";
import { type AccessClient, accessHeaders } from "../workers";

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

/** What `POST /api/token` takes: the project whose repository a worker's git signs in to. */
export const TokenRequest = z.object({
	project: z.union([
		z.object({ slug: z.string() }),
		z.object({ origin: z.string() }),
	]),
});

/** What a stat answers with over the wire. */
export interface WireStat {
	directory: boolean;
	size: number;
	mtimeMs: number;
}

/**
 * What `relay.json` holds: where the worker daemon's relay listens while it
 * runs, the worker this machine is, and, for a coordinator elsewhere, its
 * URL and whether the worker's key and Access token are in its key file,
 * kept once the daemon stops so `splates` here reaches it directly.
 */
const RelayFile = z.object({
	url: z.string().optional(),
	worker: z.string().optional(),
	coordinator: z.string().optional(),
	keyFile: z.boolean().optional(),
});
export type RelayFile = z.infer<typeof RelayFile>;

/** Where a worker daemon says its relay listens, in the machine's storage. */
export function relayDocument(machine: Storage): Document<RelayFile> {
	return machine.document("relay.json");
}

/**
 * What a command sends the coordinator's server: `fetch`, through a relay,
 * or with the worker's Access service token when it reaches the server
 * through its tunnel.
 */
export type RelaySend = (url: string, init: RequestInit) => Promise<Response>;

/** What `relayOf` reads where the relay is, and whether it answers. */
export interface RelayDeps {
	machine: Storage;
	env: (name: string) => string | undefined;
	/**
	 * The Access service token the worker here joined with, from its key
	 * file or the system's store; none by default, so a relay that does not
	 * answer is used anyway.
	 */
	access?: (keyFile: boolean) => Promise<AccessClient | null>;
	/** Whether something listens at `url`; a TCP connect by default. */
	listening?: (url: string) => Promise<boolean>;
}

/**
 * The coordinator a command on a worker reaches its project's records
 * through, and which project they are: the `splates server` the agent's env
 * names, else the relay this machine's worker daemon keeps, or the
 * coordinator itself while no daemon relays; the project its env names,
 * else the one whose origin URL `origin` is. Null when no relay is known,
 * or no project can be named.
 */
export async function findRelay(
	deps: RelayDeps,
	origin: () => Promise<string | null>,
): Promise<FoundRelay | null> {
	const relay = await relayOf(deps);
	if (relay === null) {
		return null;
	}
	const slug = deps.env("SPLATES_PROJECT");
	if (slug !== undefined) {
		return { ...relay, project: { slug } };
	}
	const found = await origin();
	return found === null ? null : { ...relay, project: { origin: found } };
}

/**
 * The coordinator's server a command on this machine reaches, how, and the
 * worker this machine is: the `splates server` the agent's env names, else
 * the relay this machine's worker daemon keeps, else, once that does not
 * answer, the coordinator elsewhere it dials, passing Access with the
 * worker's service token. Null when none says.
 */
export async function relayOf(
	deps: RelayDeps,
): Promise<{ url: string; worker: string | null; send: RelaySend } | null> {
	const { machine, env, access, listening = answers } = deps;
	const read = await relayDocument(machine)
		.read()
		.catch(() => null);
	const parsed = read === null ? null : RelayFile.safeParse(read);
	const said = parsed?.success ? parsed.data : null;
	const worker = env("SPLATES_WORKER") ?? said?.worker ?? null;
	const dev = env("SPLATES_DEV");
	if (dev !== undefined) {
		return { url: dev, worker, send: fetch };
	}
	const { coordinator } = said ?? {};
	if (
		coordinator !== undefined &&
		access !== undefined &&
		(said?.url === undefined || !(await listening(said.url)))
	) {
		const headers = accessHeaders(await access(said?.keyFile ?? false));
		return {
			url: coordinator,
			worker,
			send: (url, init) =>
				fetch(url, {
					...init,
					headers: {
						...Object.fromEntries(new Headers(init.headers)),
						...headers,
					},
				}),
		};
	}
	return said?.url === undefined
		? null
		: { url: said.url, worker, send: fetch };
}

/** Whether a TCP connection to `url`'s host and port opens. */
async function answers(url: string): Promise<boolean> {
	const { hostname, port } = new URL(url);
	try {
		const socket = await Bun.connect({
			hostname,
			port: Number(port),
			socket: { data: () => {} },
		});
		socket.end();
		return true;
	} catch {
		return false;
	}
}

/** The relay `findRelay` found, and the worker it is this machine's. */
export interface FoundRelay {
	url: string;
	/** How each request reaches it. */
	send: RelaySend;
	project: StateProject;
	/**
	 * The worker this machine is, which a task's clone made here is recorded
	 * on; null when neither the env nor the daemon says.
	 */
	worker: string | null;
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

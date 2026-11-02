import type { Fs } from "core/system";
import type { ReleaseChanges } from "./git";

/**
 * Draws the graph of `sources` from each one's root and workspace
 * `package.json` files: the public packages each publishes, and the versions
 * each pins of the others'. A `workspace:` pin is the project's own and
 * draws no edge.
 */
// vet-ignore classes-over-function-exports: movePins joins readGraph and publishedPins, which read the same manifests; the three move into one class together
export async function readGraph(
	fs: Fs,
	sources: ShipSource[],
): Promise<ShipGraph> {
	const read = await Promise.all(
		sources.map(async (source) => {
			const named = source.packages ?? source.deploys;
			if (named === undefined) {
				return {
					source,
					manifests: await manifestsOf(fs, source.root, source.paths),
					own: undefined,
				};
			}
			const members = await workspaceClosure(fs, source.root, named);
			return {
				source: {
					...source,
					paths: members.map((member) => `${member.dir}/**`),
				},
				manifests: members.map((member) => member.manifest),
				own: members
					.filter((member) => named.includes(member.manifest.name ?? ""))
					.map((member) => member.manifest),
			};
		}),
	);
	const owner = new Map<string, string>();
	const ownerOf = new Map<string, { root: string; version: string }>();
	for (const { source, manifests, own } of read) {
		if (source.deploys !== undefined) {
			continue;
		}
		for (const manifest of own ?? manifests) {
			if (manifest.name !== undefined && manifest.private !== true) {
				owner.set(manifest.name, source.slug);
				ownerOf.set(manifest.name, {
					root: source.root,
					version: manifest.version ?? "",
				});
			}
		}
	}
	const rank = new Map(sources.map((each, i) => [each.slug, i]));
	const projects: ShipProject[] = read.map(({ source, manifests, own }) => {
		const deploy = source.deploys !== undefined;
		const packages = (own ?? manifests)
			.filter((_each) => !deploy)
			.filter((each) => each.name !== undefined && each.private !== true)
			.map((each) => each.name as string);
		return {
			...source,
			version: deploy
				? null
				: ((source.paths === undefined
						? manifests[0]?.version
						: ((own ?? manifests).find((each) => each.private !== true)
								?.version ?? (own ?? manifests)[0]?.version)) ?? null),
			packages,
			deploy,
			private: packages.length === 0,
			uses: usesOf(manifests, source, owner, ownerOf).sort(
				(one, other) =>
					(rank.get(one.project) ?? 0) - (rank.get(other.project) ?? 0),
			),
			dependents: [],
		};
	});
	const bySlug = new Map(projects.map((each) => [each.slug, each]));
	for (const project of projects) {
		for (const use of project.uses) {
			bySlug
				.get(use.project)
				?.dependents.push({ project: project.slug, pins: use.pins });
		}
	}
	return { projects };
}

/**
 * The public packages the project at `root` publishes, each at the version
 * its manifest names now: what a ship that ended there published.
 */
export async function publishedPins(fs: Fs, root: string): Promise<Pin[]> {
	return (await manifestsOf(fs, root)).flatMap((manifest) =>
		manifest.name === undefined ||
		manifest.private === true ||
		manifest.version === undefined
			? []
			: [{ name: manifest.name, version: manifest.version }],
	);
}

/** A registered project the graph is drawn over. */
export interface ShipSource {
	slug: string;
	root: string;
	/**
	 * The slug of the registered repository a ship target lives in, for a
	 * source that is one of several its `ships` names; absent when the slug is
	 * the repository's own.
	 */
	repo?: string;
	/**
	 * The path globs a ship target owns, relative to `root`: only manifests
	 * under them are read. Absent for the whole repository.
	 */
	paths?: string[];
	/**
	 * The workspace packages an npm target publishes: its version is theirs
	 * and its paths become their directories plus those of the workspace
	 * packages they depend on, which {@link readGraph} fills in.
	 */
	packages?: string[];
	/**
	 * The workspace packages a deploy target puts out: no version, and its
	 * paths become as for `packages`.
	 */
	deploys?: string[];
	/** The target's `shipStatus`, null for npm latest; absent to read the repository's config. */
	shipStatus?: string | null;
	/** Its `splates.config.ts`'s `ship`, null when it is never shipped. */
	ship: string | null;
}

/** A package one project pins of another's, at the version it pins. */
export interface Pin {
	name: string;
	version: string;
}

/** One project's use of another's packages. */
export interface Use {
	/** The other project's slug. */
	project: string;
	/** The other's packages it pins, by name. */
	pins: Pin[];
}

/** A registered project, as shipping sees it. */
export interface ShipProject extends ShipSource {
	/** Local commits since the current version tag; absent from older graph responses. */
	changes?: ReleaseChanges;
	/** The root manifest's version, null when it names none. */
	version: string | null;
	/** The public packages it publishes, by name. */
	packages: string[];
	/** It is a deploy target: no version, its shipStatus prints the commit deployed. */
	deploy?: boolean;
	/** It publishes nothing: every package it has is private. */
	private: boolean;
	/** The projects whose packages it pins. */
	uses: Use[];
	/** The projects pinning its packages. */
	dependents: Use[];
}

/** Every registered project and who pins whose packages, in registration order. */
export interface ShipGraph {
	projects: ShipProject[];
}

/**
 * The other projects' packages `manifests` pin, grouped by their project, in
 * the order first pinned.
 */
function usesOf(
	manifests: Manifest[],
	source: ShipSource,
	owner: Map<string, string>,
	ownerOf: Map<string, { root: string; version: string }>,
): Use[] {
	const pins = new Map<string, Map<string, Pin>>();
	for (const manifest of manifests) {
		for (const field of DEPENDENCY_FIELDS) {
			for (const [name, version] of Object.entries(manifest[field] ?? {})) {
				const from = owner.get(name);
				if (from === undefined || from === source.slug) {
					continue;
				}
				// A workspace pin is another target's only when both ship from one
				// repository; it pins the version that target has now.
				const workspace = version.startsWith("workspace:");
				const theirs = ownerOf.get(name);
				if (workspace && theirs?.root !== source.root) {
					continue;
				}
				const pinned = workspace ? (theirs?.version ?? version) : version;
				const of = pins.get(from) ?? new Map<string, Pin>();
				of.set(JSON.stringify([name, pinned]), { name, version: pinned });
				pins.set(from, of);
			}
		}
	}
	return [...pins].map(([project, of]) => ({
		project,
		pins: [...of.values()],
	}));
}

/**
 * Moves every pin of `pins` in the `package.json` files under `root` (the
 * root's and each workspace member's) to its version, keeping the range
 * mark it had; a `workspace:` pin is left alone. With `paths`, only the
 * manifests they own. The files it changed.
 */
export async function movePins(
	fs: Fs,
	root: string,
	pins: Pin[],
	paths?: string[],
): Promise<string[]> {
	const changed: string[] = [];
	const owned = ownedBy(paths);
	const rootManifest = await manifestAt(fs, root);
	if (rootManifest === null) {
		return changed;
	}
	const patterns = Array.isArray(rootManifest.workspaces)
		? rootManifest.workspaces
		: (rootManifest.workspaces?.packages ?? []);
	const dirs = [root, ...(await workspaceDirs(fs, root, patterns))];
	for (const dir of dirs) {
		const path = `${dir}/package.json`;
		if (!owned(path.slice(root.length + 1))) {
			continue;
		}
		if (!(await fs.exists(path))) {
			continue;
		}
		const text = await fs.read(path);
		let manifest: Manifest;
		try {
			manifest = JSON.parse(text) as Manifest;
		} catch {
			continue;
		}
		let moved = false;
		for (const field of DEPENDENCY_FIELDS) {
			const have = manifest[field];
			for (const pin of pins) {
				const was = have?.[pin.name];
				if (have === undefined || was === undefined) {
					continue;
				}
				if (was.startsWith("workspace:")) {
					continue;
				}
				const now = `${/^[\^~]/.exec(was)?.[0] ?? ""}${pin.version}`;
				if (now !== was) {
					have[pin.name] = now;
					moved = true;
				}
			}
		}
		if (moved) {
			const indent = /^\n?(\t| +)"/m.exec(text)?.[1] ?? "\t";
			await fs.write(
				path,
				`${JSON.stringify(manifest, null, indent)}${text.endsWith("\n") ? "\n" : ""}`,
			);
			changed.push(path);
		}
	}
	return changed;
}

/**
 * The root's manifest, then each workspace member's, those missing skipped:
 * a project with no `package.json` publishes and pins nothing.
 */
async function manifestsOf(
	fs: Fs,
	root: string,
	paths?: string[],
): Promise<Manifest[]> {
	const rootManifest = await manifestAt(fs, root);
	if (rootManifest === null) {
		return [];
	}
	const patterns = Array.isArray(rootManifest.workspaces)
		? rootManifest.workspaces
		: (rootManifest.workspaces?.packages ?? []);
	const owned = ownedBy(paths);
	const members: Manifest[] = [];
	for (const dir of await workspaceDirs(fs, root, patterns)) {
		if (!owned(`${dir.slice(root.length + 1)}/package.json`)) {
			continue;
		}
		const manifest = await manifestAt(fs, dir);
		if (manifest !== null) {
			members.push(manifest);
		}
	}
	return owned("package.json") ? [rootManifest, ...members] : members;
}

/**
 * The workspace members named `names` and every workspace member they depend
 * on, each with its directory relative to `root`.
 */
async function workspaceClosure(
	fs: Fs,
	root: string,
	names: string[],
): Promise<{ dir: string; manifest: Manifest }[]> {
	const rootManifest = await manifestAt(fs, root);
	const patterns = Array.isArray(rootManifest?.workspaces)
		? rootManifest.workspaces
		: (rootManifest?.workspaces?.packages ?? []);
	const byName = new Map<string, { dir: string; manifest: Manifest }>();
	for (const dir of await workspaceDirs(fs, root, patterns)) {
		const manifest = await manifestAt(fs, dir);
		if (manifest?.name !== undefined) {
			byName.set(manifest.name, { dir: dir.slice(root.length + 1), manifest });
		}
	}
	const found = new Map<string, { dir: string; manifest: Manifest }>();
	const pending = [...names];
	for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
		const member = byName.get(name);
		if (member === undefined) {
			throw new Error(`${name} is not a workspace package of ${root}`);
		}
		if (found.has(name)) {
			continue;
		}
		found.set(name, member);
		for (const field of DEPENDENCY_FIELDS) {
			for (const dependency of Object.keys(member.manifest[field] ?? {})) {
				if (byName.has(dependency)) {
					pending.push(dependency);
				}
			}
		}
	}
	return [...found.values()];
}

/** Whether a path relative to the root is one of `paths`, every path for none. */
function ownedBy(paths: string[] | undefined): (path: string) => boolean {
	if (paths === undefined) {
		return () => true;
	}
	const globs = paths.map(
		(path) =>
			new Bun.Glob(path.replace(/^\.\//, "").replace(/\/+$/, "") || "**"),
	);
	return (path) => globs.some((glob) => glob.match(path));
}

/**
 * The directories `patterns` name under `root`: each a path, with `*` for
 * every directory at that depth, as workspaces are declared.
 */
async function workspaceDirs(
	fs: Fs,
	root: string,
	patterns: string[],
): Promise<string[]> {
	const dirs: string[] = [];
	for (const pattern of patterns) {
		let found = [root];
		for (const segment of pattern
			.replace(/^\.\//, "")
			.replace(/\/$/, "")
			.split("/")) {
			if (segment !== "*") {
				found = found.map((dir) => `${dir}/${segment}`);
				continue;
			}
			const next: string[] = [];
			for (const parent of found) {
				if (await fs.exists(parent)) {
					for (const entry of (await fs.readdir(parent)).sort()) {
						next.push(`${parent}/${entry}`);
					}
				}
			}
			found = next;
		}
		dirs.push(...found);
	}
	return dirs;
}

/** The `package.json` in `dir`, or null when it has none or it does not parse. */
async function manifestAt(fs: Fs, dir: string): Promise<Manifest | null> {
	const path = `${dir}/package.json`;
	if (!(await fs.exists(path))) {
		return null;
	}
	try {
		return JSON.parse(await fs.read(path)) as Manifest;
	} catch {
		return null;
	}
}

/** The fields of a `package.json` the graph reads. */
interface Manifest {
	name?: string;
	version?: string;
	private?: boolean;
	workspaces?: string[] | { packages?: string[] };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

/** Where each dependency of a manifest is declared. */
const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

/** Whether every target is already pinned everywhere it occurs in the base manifests. */
export async function pinsMatch(
	fs: Fs,
	root: string,
	pins: Pin[],
	paths?: string[],
): Promise<boolean> {
	const manifests = await manifestsOf(fs, root, paths);
	return pins.every((pin) => {
		const versions = manifests.flatMap((manifest) =>
			DEPENDENCY_FIELDS.flatMap((field) => {
				const value = manifest[field]?.[pin.name];
				return value === undefined || value.startsWith("workspace:")
					? []
					: [value];
			}),
		);
		return (
			versions.length > 0 &&
			versions.every((version) => version.replace(/^[~^]/, "") === pin.version)
		);
	});
}

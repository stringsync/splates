import type { Fs } from "webappwiz/system";
import type { ReleaseChanges } from "./git";

/**
 * Draws the graph of `sources` from each one's root and workspace
 * `package.json` files: the public packages each publishes, and the versions
 * each pins of the others'. A `workspace:` pin is the project's own and
 * draws no edge.
 */
// scry-ignore classes-over-function-exports: movePins joins readGraph and publishedPins, which read the same manifests; the three move into one class together
export async function readGraph(
	fs: Fs,
	sources: ShipSource[],
): Promise<ShipGraph> {
	const read = await Promise.all(
		sources.map(async (source) => ({
			source,
			manifests: await manifestsOf(fs, source.root),
		})),
	);
	const owner = new Map<string, string>();
	for (const { source, manifests } of read) {
		for (const manifest of manifests) {
			if (manifest.name !== undefined && manifest.private !== true) {
				owner.set(manifest.name, source.slug);
			}
		}
	}
	const rank = new Map(sources.map((each, i) => [each.slug, i]));
	const projects: ShipProject[] = read.map(({ source, manifests }) => {
		const packages = manifests
			.filter((each) => each.name !== undefined && each.private !== true)
			.map((each) => each.name as string);
		return {
			...source,
			version: manifests[0]?.version ?? null,
			packages,
			private: packages.length === 0,
			uses: usesOf(manifests, source.slug, owner).sort(
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
	slug: string,
	owner: Map<string, string>,
): Use[] {
	const pins = new Map<string, Map<string, Pin>>();
	for (const manifest of manifests) {
		for (const field of DEPENDENCY_FIELDS) {
			for (const [name, version] of Object.entries(manifest[field] ?? {})) {
				const from = owner.get(name);
				if (
					from === undefined ||
					from === slug ||
					version.startsWith("workspace:")
				) {
					continue;
				}
				const of = pins.get(from) ?? new Map<string, Pin>();
				of.set(JSON.stringify([name, version]), { name, version });
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
 * mark it had; a `workspace:` pin is left alone. The files it changed.
 */
export async function movePins(
	fs: Fs,
	root: string,
	pins: Pin[],
): Promise<string[]> {
	const changed: string[] = [];
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
async function manifestsOf(fs: Fs, root: string): Promise<Manifest[]> {
	const rootManifest = await manifestAt(fs, root);
	if (rootManifest === null) {
		return [];
	}
	const patterns = Array.isArray(rootManifest.workspaces)
		? rootManifest.workspaces
		: (rootManifest.workspaces?.packages ?? []);
	const members: Manifest[] = [];
	for (const dir of await workspaceDirs(fs, root, patterns)) {
		const manifest = await manifestAt(fs, dir);
		if (manifest !== null) {
			members.push(manifest);
		}
	}
	return [rootManifest, ...members];
}

/**
 * The directories `patterns` name under `root`: each a path, or a path
 * ending in `/*` for every directory in it, as workspaces are declared.
 */
async function workspaceDirs(
	fs: Fs,
	root: string,
	patterns: string[],
): Promise<string[]> {
	const dirs: string[] = [];
	for (const pattern of patterns) {
		const path = `${root}/${pattern.replace(/^\.\//, "").replace(/\/$/, "")}`;
		if (!path.endsWith("/*")) {
			dirs.push(path);
			continue;
		}
		const parent = path.slice(0, -2);
		if (!(await fs.exists(parent))) {
			continue;
		}
		for (const entry of (await fs.readdir(parent)).sort()) {
			dirs.push(`${parent}/${entry}`);
		}
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
): Promise<boolean> {
	const manifests = await manifestsOf(fs, root);
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

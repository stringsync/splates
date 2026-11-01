import { fail } from "../exit";
import type { Config, ProjectConfig } from "./config";

/** What a changed path belongs to. */
export type PathScope =
	| { kind: "project"; slug: string }
	/** A path no project owns and none is charged for, such as `bun.lock`. */
	| { kind: "shared" }
	/** A path no project claims. */
	| { kind: "none" };

/**
 * The projects a repository holds and the paths each owns, from a config's
 * `projects` and `shared`. Throws on a slug that is empty or a glob that
 * is absolute or climbs out of the root, and on projects that overlap.
 */
export class Scopes {
	private readonly projects: { slug: string; globs: Bun.Glob[] }[];
	private readonly shared: Bun.Glob[];

	/** `repoName` names the one project of a config with no `projects`. */
	constructor(config: Pick<Config, "projects" | "shared">, repoName: string) {
		const declared = Object.fromEntries(
			Object.entries(config.projects ?? { [repoName]: ["**"] }).map(
				([slug, project]) => [slug, pathsOf(project)],
			),
		);
		const slugs = Object.keys(declared);
		for (const slug of slugs) {
			if (slug.trim() === "") {
				throw new Error("projects: a project's slug may not be empty");
			}
			if (declared[slug]?.length === 0) {
				throw new Error(`projects: ${slug} owns no paths`);
			}
		}
		const globs = slugs.flatMap((slug) =>
			(declared[slug] ?? []).map((glob) => ({ slug, glob: normalize(glob) })),
		);
		for (let i = 0; i < globs.length; i++) {
			for (const other of globs.slice(i + 1)) {
				const first = globs[i];
				if (
					first &&
					first.slug !== other.slug &&
					overlaps(first.glob, other.glob)
				) {
					throw new Error(
						`projects: ${first.slug} (${first.glob}) and ${other.slug} (${other.glob}) overlap`,
					);
				}
			}
		}
		this.projects = slugs.map((slug) => ({
			slug,
			globs: (declared[slug] ?? []).map(
				(glob) => new Bun.Glob(normalize(glob)),
			),
		}));
		this.shared = (config.projects ? config.shared : []).map(
			(glob) => new Bun.Glob(normalize(glob)),
		);
	}

	/** The slugs of every project, in the order the config names them. */
	slugs(): string[] {
		return this.projects.map((entry) => entry.slug);
	}

	/**
	 * The project a task added from `folder` (relative to the root, empty at
	 * it) changes: `named` if given and declared, else the project the folder
	 * is in, else the only project; null when none of them says. Throws on a
	 * `named` that is not declared, with the reason `usage`.
	 */
	pick(named: string | undefined, folder: string): string | null {
		const slugs = this.slugs();
		if (named !== undefined) {
			if (!slugs.includes(named)) {
				fail(
					"usage",
					`no project '${named}' in splates.config.ts: ${slugs.join(", ")}`,
					{ project: named },
				);
			}
			return named;
		}
		const at = folder === "" ? null : this.of(`${folder}/.`);
		if (at?.kind === "project") {
			return at.slug;
		}
		return slugs.length === 1 ? (slugs[0] ?? null) : null;
	}

	/** Which project, or shared, `path` (relative to the root) is in. */
	of(path: string): PathScope {
		const rel = path.replace(/^\.\//, "");
		const project = this.projects.find((candidate) =>
			candidate.globs.some((glob) => glob.match(rel)),
		);
		if (project) {
			return { kind: "project", slug: project.slug };
		}
		return this.shared.some((glob) => glob.match(rel))
			? { kind: "shared" }
			: { kind: "none" };
	}
}

/** The paths a `projects` entry owns, whether it is a list or a `ProjectConfig`. */
function pathsOf(project: string[] | ProjectConfig): string[] {
	return Array.isArray(project) ? project : project.paths;
}

/** The ship settings a project resolves to. */
export interface ShipSettings {
	ship: string | null;
	shipStatus: string | null;
	afterBump: string | null;
}

/**
 * The `ship`, `shipStatus` and `afterBump` of project `slug`: its own where
 * its `projects` entry sets them (`null` included), else the repository's.
 */
export function shipSettings(
	config: Partial<
		Pick<Config, "projects" | "ship" | "shipStatus" | "afterBump">
	>,
	slug: string,
): ShipSettings {
	const entry = config.projects?.[slug];
	const own: Partial<ProjectConfig> =
		entry === undefined || Array.isArray(entry) ? {} : entry;
	return {
		ship: own.ship !== undefined ? own.ship : (config.ship ?? null),
		shipStatus:
			own.shipStatus !== undefined
				? own.shipStatus
				: (config.shipStatus ?? null),
		afterBump:
			own.afterBump !== undefined ? own.afterBump : (config.afterBump ?? null),
	};
}

function normalize(glob: string): string {
	const stripped = glob.replace(/^\.\//, "").replace(/\/+$/, "");
	if (stripped.startsWith("/") || stripped.split("/").includes("..")) {
		throw new Error(`projects: ${glob} must stay inside the repository`);
	}
	return stripped === "" ? "**" : stripped;
}

/** The directory segments of `glob` before its first wildcard. */
function literalPrefix(glob: string): string[] {
	const segments = glob.split("/");
	const end = segments.findIndex((segment) => /[*?[\]{}]/.test(segment));
	return end === -1 ? segments : segments.slice(0, end);
}

/**
 * Whether two globs can match one path, judged by their literal leading
 * directories: one's is a prefix of the other's. Cautious, so a pair like
 * `a/*.ts` and `a/b/**` that cannot clash is still refused.
 */
function overlaps(left: string, right: string): boolean {
	const [leftPrefix, rightPrefix] = [literalPrefix(left), literalPrefix(right)];
	const shared = Math.min(leftPrefix.length, rightPrefix.length);
	return leftPrefix
		.slice(0, shared)
		.every((segment, i) => segment === rightPrefix[i]);
}

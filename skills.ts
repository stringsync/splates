import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";

/**
 * The repository the skills come from: each release is a tag in it, and each
 * skill a `skills/<name>/SKILL.md` there, which `bunx skills add` finds.
 */
export const SOURCE = "jaredjj3/webappwiz";

/**
 * The `skills` CLI, held to one major release so the flags passed here keep
 * meaning what they mean now.
 */
const CLI = "skills@1";

/**
 * Where a project keeps its skills. `skills` writes each one here, which
 * Codex and most agents read, and links the directories of the rest, such as
 * Claude Code's `.claude/skills`, to it.
 */
export const ROOT = ".agents/skills";

/** The `version:` in a skill's frontmatter, or null when it has none. */
export function versionOf(md: string): string | null {
	// frontmatter only, so a `version:` inside a fenced example in the body is
	// not mistaken for the real one
	const frontmatter = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
	return frontmatter.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

/**
 * The webappwiz skills a project has, installed through the `skills` CLI from
 * the tag of one release, so a project's copy is always some release's,
 * whichever of `bunx skills add`, `arbor` or `wiz` put it there. A skill whose
 * copy is a symbolic link is one someone keeps by hand, as this repository
 * links its own to the source it edits, so it is left as it is.
 */
export class ProjectSkills {
	constructor(
		/** The project's root, where `.agents/skills` is. */
		private root: string,
		private deps: { fs: Fs; ps: Ps; log: Logger },
	) {}

	/** Where the project keeps `name`, under its root. */
	path(name: string): string {
		return `${ROOT}/${name}`;
	}

	/** The skills the project has, ours or not, in name order. */
	async installed(): Promise<string[]> {
		const { fs } = this.deps;
		const names = await fs
			.readdir(`${this.root}/${ROOT}`)
			.catch((): string[] => []); // no such directory is just "none installed"
		const present: string[] = [];
		for (const name of names.toSorted()) {
			if (await fs.exists(this.file(name))) {
				present.push(name);
			}
		}
		return present;
	}

	/** The release the project's copy of `name` came from; null when it has none. */
	async version(name: string): Promise<string | null> {
		return this.deps.fs
			.read(this.file(name))
			.then(versionOf)
			.catch((): null => null); // not installed, or not readable: same answer here
	}

	/** Whether the project's copy of `name` is a link to one kept by hand. */
	async linked(name: string): Promise<boolean> {
		const { fs } = this.deps;
		const dir = `${this.root}/${this.path(name)}`;
		return (await fs.isSymlink(dir)) || (await fs.isSymlink(this.file(name)));
	}

	/**
	 * Installs each of `names` as release `version` ships it, over whatever
	 * copy is there, or throws when `skills` fails. Skips a linked copy and
	 * one already at `version`, saying so, so running it again changes
	 * nothing and needs no network.
	 */
	async add(names: string[], version: string): Promise<void> {
		const { ps, log } = this.deps;
		const wanted: string[] = [];
		for (const name of names) {
			const installed = await this.version(name);
			if (await this.linked(name)) {
				log.info(`${this.path(name)} links to your own copy; leaving it`);
			} else if (installed === version) {
				log.info(`${this.path(name)} is already ${name} ${version}`);
			} else {
				wanted.push(name);
				log.info(
					`${color.green("installing")} ${name} ${installed === null ? "" : `${installed} to `}${version}`,
				);
			}
		}
		if (wanted.length === 0) {
			return;
		}
		const { exitCode } = await ps.spawn(
			[
				"bunx",
				CLI,
				"add",
				`${SOURCE}#v${version}`,
				"--yes",
				"--skill",
				...wanted,
			],
			// `skills` reports each install to skills.sh unless told not to,
			// and a project updating its tools has not asked for that
			{ cwd: this.root, env: { DISABLE_TELEMETRY: "1" } },
		);
		if (exitCode !== 0) {
			throw new Error(
				`\`bunx ${CLI} add\` exited ${exitCode} installing ${wanted.join(", ")} ${version}`,
			);
		}
	}

	private file(name: string): string {
		return `${this.root}/${this.path(name)}/SKILL.md`;
	}
}

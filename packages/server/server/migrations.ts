import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { shellQuoted } from "../coordinator";
import { Exit, fail } from "../exit";
import type { Projects } from "../projects";
import {
	type Migration,
	type MigrationFailure,
	recordsMigration,
} from "../records";

/** What `Migrations` works with. */
export interface MigrationsHome {
	fs: Fs;
	ps: Ps;
	log: Logger;
	projects: Projects;
	/** Opens the project at `root` again, as its next request would. */
	reopen(root: string): Promise<unknown>;
}

/**
 * What `splates server` does about each project's records being older than it
 * reads: moves them all forward before it listens, and, for one whose
 * migration failed, says why to the page, tries again when asked, and
 * names the root its terminal opens in. A failure is never tried again on
 * its own, so the server comes up once and stays up, however often it is
 * started.
 */
export class Migrations {
	constructor(private readonly home: MigrationsHome) {}

	/**
	 * Moves every registered project's records forward, all at once, each
	 * within the limit `Migration` keeps: a failure is kept for its page and
	 * never stops the others, or the server.
	 */
	async startAll(): Promise<void> {
		const { projects, log } = this.home;
		const roots = (await projects.list().catch(() => []))
			.filter((each) => !each.gone)
			.map((each) => each.root);
		await Promise.all(
			roots.map(async (root) => {
				try {
					await (await this.of(root)).run();
				} catch (error) {
					// One a migration refused has said why; the rest open, or
					// refuse, as each is asked for.
					if (!(error instanceof Exit)) {
						log.error(`${root} did not migrate: ${String(error)}`);
					}
				}
			}),
		);
	}

	/**
	 * The project `request` names with `?project=`, or the focused one, read
	 * from the registry alone, so it is found with records that do not open.
	 */
	async rootFor(request: Request): Promise<string> {
		const { projects } = this.home;
		const slug = new URL(request.url).searchParams.get("project") ?? "";
		const found =
			slug === ""
				? await projects.focused()
				: (await projects.list()).find((each) => each.slug === slug);
		if (found === null || found === undefined) {
			fail("not_found", `no splates project '${slug}'`, { project: slug });
		}
		return found.root;
	}

	/**
	 * The failure kept for the project `request` names, with what the page's
	 * Fix with an agent types into its terminal and the branch it opens on;
	 * `failure` null for none.
	 */
	readonly read = async (request: Request): Promise<Response> => {
		const root = await this.rootFor(request);
		const migration = await this.of(root);
		const failure = await migration.failure();
		const { stdout } = await this.home.ps.spawnCapture([
			"git",
			"-C",
			root,
			"branch",
			"--show-current",
		]);
		return Response.json({
			root,
			trunk: stdout.trim(),
			failure,
			fix: failure === null ? null : this.fix(migration, failure),
		});
	};

	/** Forgets the failure kept for the project `request` names, and opens it again. */
	readonly retry = async (request: Request): Promise<Response> => {
		const root = await this.rootFor(request);
		await (await this.of(root)).forget();
		await this.home.reopen(root);
		return Response.json({});
	};

	private of(root: string): Promise<Migration> {
		return recordsMigration(this.home, `${root}/.git`);
	}

	/** The command that starts an agent told what failed and how to try again. */
	private fix(migration: Migration, failure: MigrationFailure): string {
		const splates = this.home.ps.self.map(shellQuoted).join(" ");
		const prompt = [
			`splates could not migrate this repository's records under ${migration.format.splatesDir} from format ${failure.from} to ${failure.to}${failure.step === null ? "" : `, at the step that ${failure.step}`}, so it put them back as they were, from the backup it took first.`,
			`Running splates ${failure.release}, it said: ${failure.error.replaceAll(/\s*\n\s*/g, " ")}`,
			`The failure is kept in ${migration.failurePath}.`,
			"Find out what stopped the step. When it is the records, fix them; when it is splates itself, say what would need to change in it, and fix nothing there.",
			`Then run \`${splates} migrate\` here to try again: once it passes, the splates page opens this project.`,
			"Ask me before deleting or rewriting any record.",
		].join(" ");
		// One line, as typed into the shell, so it runs without a continuation.
		return `claude ${shellQuoted(prompt)}`;
	}
}

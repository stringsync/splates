import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";
import type { Pushed } from "../merge";
import { asideOf } from "../tunnel";
import { accessHeaders, joinAccess } from "../workers";
import type { BoxStanding } from "./box";
import { BOX_PROJECTS, type MovedProject, movedProjects } from "./paths";
import {
	type BoxProject,
	BUNDLE,
	COORDINATOR_UNIT,
	clonesScript,
	inviteScript,
	needsScript,
	placeScript,
	readClones,
	refreshScript,
	restartScript,
	startScript,
	upgradeScript,
	withdrawScript,
} from "./scripts";
import { BoxShell } from "./ssh";
import { MOVED_HOME, stage } from "./stage";
import type { WorkersWithout } from "./without";

/**
 * Moves the coordinator onto its box, the one the user's Pulumi stack made:
 * checks what it needs, stops at `blocked` until the box's Parameter Store
 * holds the creds it reads (the stack puts them there), readies the box's
 * clones with each project's deploy key, which must push trunk; then stops
 * this machine's `splates server` once its agents checkpoint, carries its
 * records over (no creds go: the box reads its own), starts the server
 * there for good, and joins this machine to it as a worker, which carries on each task in its worktree here. This
 * machine's own records go aside, kept. With `dryRun`, stops before
 * anything changes here. Once the coordinator runs on the box, it brings
 * the box's splates to this release and restarts it there instead,
 * finishing first what a move that failed once the box served left undone.
 */
export class CoordinatorMove {
	private readonly fetch: typeof fetch;
	private readonly pause: Duration;

	constructor(private readonly opts: CoordinatorMoveOptions) {
		this.fetch = opts.fetch ?? fetch;
		this.pause = opts.pause ?? Duration.secs(2);
	}

	async run({ dryRun = false }: { dryRun?: boolean } = {}): Promise<Moved> {
		const { log, version } = this.opts;
		const standing = await this.opts.box();
		const updated =
			standing === null ? null : await this.update(standing, { dryRun });
		if (updated !== null) {
			return updated;
		}
		const { box, repos } = await this.check(standing);
		const host = box.host;
		const without = await this.opts.workersWithout();
		log.info(without.said);
		const shell = this.shell(box);
		const projects = await this.boxProjects(repos);
		log.info(`bringing splates on the box at ${box.ipv4} to ${version}`);
		await shell.run(upgradeScript(version));
		log.info("readying each project's clone on the box");
		const needs = (await shell.run(needsScript(projects)))
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
		if (needs.length > 0) {
			return { status: "blocked", needs };
		}
		const { refused } = readClones(await shell.run(clonesScript(projects)));
		if (refused.length > 0) {
			throw new Error(
				`the box cannot clone or push trunk of ${refused.join(", ")} with its deploy key: check that the stack's key is on the repository with write access, and that the box can reach it`,
			);
		}
		if (dryRun) {
			return {
				status: "ready",
				host,
				projects: repos.map((each) => each.slug),
			};
		}

		await this.stopHere(repos);
		for (const repo of repos) {
			for (const { task, pushed } of await repo.pushTasks()) {
				if (pushed.status === "refused" || pushed.status === "failed") {
					log.info(`${repo.slug}/${task} stays unpushed: ${pushed.why}`);
				}
			}
		}
		let token: string | undefined;
		try {
			await this.carry(shell, repos, projects);
			log.info(`starting splates server on the box`);
			await shell.run(startScript());
			// Minted before anything here goes aside: the token the cloud
			// API takes may lack the scope a worker's service token needs.
			token = await this.invite(shell);
			await this.served(host, token);
		} catch (error) {
			if (token !== undefined) {
				await this.withdraw(shell, token);
			}
			await shell
				.run("systemctl disable --now splates-coordinator || true\n")
				.catch(() => {});
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\nNothing here changed: start \`splates server\` on this machine again, and move once that is fixed`,
			);
		}
		const record: MoveRecord = {
			host,
			stamp: (this.opts.now?.() ?? new Date())
				.toISOString()
				.replace(/[:.]/g, "-"),
			roots: repos.map((each) => each.root),
			finished: false,
		};
		await this.keep(record);
		return this.finish(shell, record, token).catch((error: unknown) => {
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\nThe server runs on the box at https://${host} now: once that is fixed, \`splates server deploy\` again finishes the move`,
			);
		});
	}

	/**
	 * The move's steps once the box serves: this machine's records go
	 * aside, and it joins the box as its worker, kept up by its LaunchAgent.
	 * Each may run again, so a deploy after one failed finishes the rest.
	 */
	private async finish(
		shell: BoxShell,
		record: MoveRecord,
		token?: string,
	): Promise<Moved> {
		const aside = await this.putAside(record);
		const coordinator = `https://${record.host}`;
		await this.opts.join(coordinator, token ?? (await this.invite(shell)));
		const worker = await this.opts.keepWorker(coordinator);
		await this.keep({ ...record, finished: true });
		return { status: "moved", host: record.host, aside, worker };
	}

	/** A join token from the box's server. */
	private async invite(shell: BoxShell): Promise<string> {
		return Invited.parse(JSON.parse(await shell.run(inviteScript()))).token;
	}

	/**
	 * Withdraws `token` from the box's server, revoking the service token
	 * minted for it: the next move's records replace the box's, so its
	 * server would never revoke it.
	 */
	private async withdraw(shell: BoxShell, token: string): Promise<void> {
		try {
			await shell.run(withdrawScript(), JSON.stringify({ token }));
		} catch (error) {
			this.opts.log.error(
				`could not withdraw the worker's invite from the box: ${error instanceof Error ? error.message : String(error)}; revoke its service token in Zero Trust → Access → Service Auth`,
			);
		}
	}

	private async keep(record: MoveRecord): Promise<void> {
		const { fs, home } = this.opts;
		const path = moveRecordPath(home);
		await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
		await fs.write(path, `${JSON.stringify(record, null, "\t")}\n`);
	}

	/**
	 * Once the coordinator runs on the box, brings the box's splates to
	 * this release and restarts it there, as a deploy does from then on;
	 * with `dryRun`, only says it would. Null while it does not run there,
	 * for a move.
	 */
	private async update(
		box: BoxStanding,
		{ dryRun }: { dryRun: boolean },
	): Promise<Moved | null> {
		const { fs, home, log, version } = this.opts;
		const shell = this.shell(box);
		const active = await shell.run(
			`systemctl is-active ${COORDINATOR_UNIT} || true\n`,
		);
		if (active.trim() !== "active") {
			return null;
		}
		if (dryRun) {
			return { status: "deployed", ipv4: box.ipv4, version };
		}
		log.info(`bringing splates on the box at ${box.ipv4} to ${version}`);
		await shell.run(upgradeScript(version));
		log.info("refreshing the box's unit, helper scripts and cloudflared");
		await shell.run(refreshScript());
		log.info("restarting splates server on the box");
		await shell.run(restartScript());
		const record = await moveRecord(fs, home);
		if (record !== null && !record.finished) {
			log.info("finishing the move the last deploy left undone");
			return this.finish(shell, record);
		}
		return { status: "updated", ipv4: box.ipv4, version };
	}

	private shell(box: BoxStanding): BoxShell {
		return new BoxShell({
			ps: this.opts.ps,
			ipv4: box.ipv4,
			key: box.key,
			knownHosts: `${this.opts.home}/coordinator/known_hosts`,
		});
	}

	/** What the move needs, all of it said at once when any is missing. */
	private async check(box: BoxStanding | null): Promise<{
		box: BoxStanding;
		repos: MoveRepo[];
	}> {
		const missing: string[] = [];
		if (box === null) {
			missing.push(
				"no coordinator's box: `splates server infra init` writes the Pulumi project and `pulumi up` there makes it",
			);
		}
		const repos = await this.opts.repos();
		if (repos.length === 0) {
			missing.push("no project here to move: `splates projects` lists none");
		}
		for (const repo of repos) {
			const problem = remoteProblem(repo);
			if (problem !== null) {
				missing.push(problem);
			}
		}
		if (box === null || missing.length > 0) {
			throw new Error(
				`cannot move yet:\n${missing.map((each) => `- ${each}`).join("\n")}`,
			);
		}
		return { box, repos };
	}

	private async boxProjects(repos: MoveRepo[]): Promise<BoxProject[]> {
		const moved = movedProjects(repos);
		return repos.map((repo, index) => ({
			...(moved[index] as MovedProject),
			url: repo.url ?? "",
			trunk: repo.trunk,
		}));
	}

	/**
	 * Has this machine's `splates server` checkpoint every agent and shut
	 * down, then waits until it is gone; nothing to do when it is not up.
	 */
	private async stopHere(repos: MoveRepo[]): Promise<void> {
		const { dev, log } = this.opts;
		if (!(await this.answers(dev))) {
			return;
		}
		log.info(`asking every agent of ${dev} to checkpoint, then stopping it`);
		const asked = await this.fetch(new URL("/api/checkpoint", dev), {
			method: "POST",
			headers: {
				origin: new URL(dev).origin,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				projects: repos.map((each) => each.slug),
				after: "shutdown",
			}),
		});
		if (!asked.ok) {
			throw new Error(
				`${dev} would not checkpoint (${asked.status}): ${await asked.text()}`,
			);
		}
		const within = this.opts.checkpointWithin ?? Duration.mins(30);
		const until = Date.now() + within.ms;
		while (await this.answers(dev)) {
			if (Date.now() > until) {
				throw new Error(
					`${dev} is still up after ${within.human()}: stop what keeps its agents, or stop it, and move again`,
				);
			}
			await sleep(this.pause);
		}
	}

	/** Lays out the records, sends them and puts them in place. */
	private async carry(
		shell: BoxShell,
		repos: MoveRepo[],
		projects: BoxProject[],
	): Promise<void> {
		const { fs, ps, home, log } = this.opts;
		const staging = `${home}/move`;
		await fs.rm(staging, { recursive: true, force: true });
		try {
			await stage({
				fs,
				home,
				staging: `${staging}/bundle`,
				worker: this.opts.worker,
				projects: projects.map((project, index) => ({
					...project,
					worktreeRoot: repos[index]?.worktreeRoot ?? "",
				})),
			});
			const bundle = `${staging}/bundle.tgz`;
			// No AppleDouble `._*` files beside each one in the archive.
			const packed = await ps.spawnCapture(
				["tar", "-czf", bundle, "-C", `${staging}/bundle`, "."],
				{ env: { COPYFILE_DISABLE: "1" } },
			);
			if (packed.exitCode !== 0) {
				throw new Error(`could not pack the records: ${packed.stderr.trim()}`);
			}
			log.info("sending the records to the box");
			await shell.copy(bundle, BUNDLE);
			await shell.run(placeScript(projects, this.boxHere(projects)));
		} finally {
			await fs.rm(staging, { recursive: true, force: true });
		}
	}

	/** The box's clone of the project the move runs in, else of the first. */
	private boxHere(projects: BoxProject[]): string {
		const { here } = this.opts;
		const found = projects.find(
			(each) => here === each.root || here.startsWith(`${each.root}/`),
		);
		return (found ?? projects[0])?.boxRoot ?? BOX_PROJECTS;
	}

	/**
	 * Waits until the tunnel's host reaches the box's server: an empty join,
	 * past Access with the service token `token` carries, as a worker joins,
	 * is refused by splates itself. Cloudflare answers 502 or 530 while no
	 * connector serves the host, and Access a sign-in either way.
	 */
	private async served(host: string, token: string): Promise<void> {
		const within = this.opts.servedWithin ?? Duration.mins(2);
		const until = Date.now() + within.ms;
		for (;;) {
			const status = await this.fetch(`https://${host}/api/workers/join`, {
				method: "POST",
				redirect: "manual",
				headers: {
					...accessHeaders(joinAccess(token)),
					"content-type": "application/json",
				},
				body: "{}",
			})
				.then(async (response) =>
					response.status === 400 &&
					Refused.safeParse(await response.json().catch(() => null)).success
						? "served"
						: String(response.status),
				)
				.catch((error: unknown) =>
					error instanceof Error ? error.message : String(error),
				);
			if (status === "served") {
				return;
			}
			if (Date.now() > until) {
				throw new Error(
					`${host} does not reach splates server on the box after ${within.human()} (last ${status})`,
				);
			}
			await sleep(this.pause);
		}
	}

	/**
	 * Moves this machine's coordinator records aside, kept: the home files
	 * into `moved-<date>`, each project's `.git/splates` to
	 * `.git/splates.moved`. Its checkouts' `splates` then reach the box.
	 */
	private async putAside({ stamp, roots }: MoveRecord): Promise<string> {
		const { fs, home } = this.opts;
		const aside = asideOf(home, stamp);
		for (const name of MOVED_HOME) {
			if (await fs.exists(`${home}/${name}`)) {
				const to = `${aside}/${name}`;
				await fs.mkdir(to.slice(0, to.lastIndexOf("/")), { recursive: true });
				await fs.rename(`${home}/${name}`, to);
			}
		}
		for (const root of roots) {
			const records = `${root}/.git/splates`;
			if (await fs.exists(records)) {
				const to = (await fs.exists(`${records}.moved`))
					? `${records}.moved-${stamp}`
					: `${records}.moved`;
				await fs.rename(records, to);
			}
		}
		return aside;
	}

	private async answers(url: string): Promise<boolean> {
		return this.fetch(url, { redirect: "manual" })
			.then(() => true)
			.catch(() => false);
	}
}

/** A project as the move reads it here. */
export interface MoveRepo {
	slug: string;
	root: string;
	/** Its central remote, as `remote` in its config; null for none. */
	remote: string | null;
	/** That remote's URL; null for none. */
	url: string | null;
	trunk: string;
	worktreeRoot: string;
	/** Pushes each task worked in a worktree here as `splates/<task>`, saying how each went. */
	pushTasks(): Promise<{ task: string; pushed: Pushed }[]>;
}

/** What the move runs on; its seams over the box, this machine and the network. */
export interface CoordinatorMoveOptions {
	ps: Ps;
	fs: Fs;
	log: Logger;
	/** splates's home here. */
	home: string;
	/** The splates release the box runs, and the Mac's worker. */
	version: string;
	/** The box as `splates server status` says it stands, or null for none. */
	box: () => Promise<BoxStanding | null>;
	/** Each project this machine's coordinator keeps. */
	repos: () => Promise<MoveRepo[]>;
	/** Where the move runs: the box's server starts in the clone of the project there, whose config names the worker provider. */
	here: string;
	/** This machine's `splates server`. */
	dev: string;
	/** What this machine is known by as a worker. */
	worker: string;
	/** How the box gets workers with this machine off, or why it gets none, said before the move. */
	workersWithout: () => Promise<WorkersWithout>;
	/** Spends a join token as `splates worker join --key-file` does. */
	join: (coordinator: string, token: string) => Promise<void>;
	/** Keeps this machine's worker dialing `coordinator` from now on, saying how. */
	keepWorker: (coordinator: string) => Promise<string>;
	fetch?: typeof fetch;
	/** How long to wait between looks while something comes up or goes down. */
	pause?: Duration;
	/** How long this machine's agents have to checkpoint. */
	checkpointWithin?: Duration;
	/** How long the tunnel's host has to reach the box's server once it starts. */
	servedWithin?: Duration;
	now?: () => Date;
}

/** How a move ended. */
export type Moved =
	| { status: "moved"; host: string; aside: string; worker: string }
	| { status: "ready"; host: string; projects: string[] }
	/** The coordinator ran on the box already, which now runs `version`. */
	| { status: "updated"; ipv4: string; version: string }
	/** On a dry run, the coordinator runs on the box already, which a deploy brings to `version`. */
	| { status: "deployed"; ipv4: string; version: string }
	/** The box's Parameter Store lacks creds its stack should have put there, each named. */
	| { status: "blocked"; needs: string[] };

const Invited = z.object({ token: z.string() });

/** How splates refuses a request, as `refuse` answers. */
const Refused = z.object({ reason: z.string(), message: z.string() });

/**
 * What a move keeps here once the box serves, so a deploy after a failed
 * step finishes it: the tunnel's host, the stamp its records went aside
 * under, each project's root, and whether this machine has joined the box
 * and kept its worker up.
 */
const MoveRecord = z.object({
	host: z.string(),
	stamp: z.string(),
	roots: z.array(z.string()),
	finished: z.boolean(),
});
export type MoveRecord = z.infer<typeof MoveRecord>;

/** Where a move keeps its `MoveRecord`, under splates's home. */
export function moveRecordPath(home: string): string {
	return `${home}/coordinator/moved.json`;
}

/** The record of the move this machine made onto its box; null for none. */
export async function moveRecord(
	fs: Fs,
	home: string,
): Promise<MoveRecord | null> {
	const path = moveRecordPath(home);
	return (await fs.exists(path))
		? MoveRecord.parse(JSON.parse(await fs.read(path)))
		: null;
}

/**
 * What keeps the box from cloning and pushing `repo` with a deploy key: no
 * central remote, or one git reaches other than over SSH; null when none.
 */
export function remoteProblem(
	repo: Pick<MoveRepo, "slug" | "root" | "remote" | "url">,
): string | null {
	if (repo.remote === null) {
		return `${repo.slug} names no central remote, which this machine checks it out from as a worker: add \`remote: "origin"\` to ${repo.root}/splates.config.ts`;
	}
	if (repo.url === null) {
		return `${repo.slug} has no remote ${repo.remote}`;
	}
	if (!sshUrl(repo.url)) {
		return `${repo.slug}'s ${repo.remote} is ${repo.url}, which a deploy key cannot push to: make it an SSH URL, as git@github.com:<owner>/<repo>.git`;
	}
	return null;
}

/** Whether git reaches `url` over SSH, as a deploy key signs in. */
function sshUrl(url: string): boolean {
	return /^ssh:\/\//.test(url) || /^[\w.-]+@[\w.-]+:/.test(url);
}

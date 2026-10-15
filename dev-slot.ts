import { color } from "webappwiz/log";
import { FileLock } from "webappwiz/system";
import type { ArborDeps } from "./arbor";
import { savedTunnelOf } from "./arbor-flags";
import { SYSTEM_STORES } from "./creds";
import { fail } from "./exit";
import { Projects } from "./projects";
import { openRepository, type Repository } from "./repository";
import { arborHome } from "./roster";
import { SavedTunnel } from "./saved-tunnel";
import { slotTunnelSetup } from "./slot-tunnel";
import { type Slot, Slots } from "./slots";

/** Set in a slot's server's environment to the word it serves under. */
export const SLOT = "ARBOR_SLOT";

/**
 * Set in a slot's server's environment to the machine's `ARBOR_HOME`, whose
 * tunnel and slots the page lists to switch between.
 */
export const MACHINE_HOME = "ARBOR_MACHINE_HOME";

/** How `arbor dev --slot` starts its server: where, and with what added. */
export interface SlotStart {
	slot: Slot;
	/** The public host it answers on, as in fox.example.com. */
	host: string;
	/** The slot's home, its `ARBOR_HOME`, and the word it serves under. */
	env: Record<string, string>;
	/** The project the server starts in. */
	cwd: string;
}

/**
 * Readies the slot this checkout holds, claimed now when it holds none: its
 * tunnel, made on the slot's first claim, and its home, `~/.arbor/slots/<word>`,
 * which keeps its own projects, roster and tunnel apart from the machine's, so
 * it never drives the agents of the `arbor dev` serving your projects. Its
 * server starts in the project it is run in when its home registers that one,
 * else in a throwaway project of its own, made on the first start.
 */
export async function devSlot(ctx: ArborDeps & Repository): Promise<SlotStart> {
	const { fs, ps, log, git, secrets = SYSTEM_STORES } = ctx;
	const machine = await savedTunnelOf(ctx).read();
	if (machine === null) {
		fail(
			"usage",
			"--slot serves on a subdomain of the zone `arbor tunnel setup` uses: run `arbor tunnel setup <host> --email <you>` first",
			{},
		);
	}
	const registry = arborHome(ps);
	const slots = new Slots(`${registry}/slots.json`, {
		fs,
		lock: new FileLock(`${registry}/slots.lock`, { fs, ps, log }),
	});
	// The worktree it runs in, not the main tree every worktree shares, so
	// each worktree holds a slot of its own.
	const { stdout } = await ps.spawnCapture(
		["git", "rev-parse", "--show-toplevel"],
		{ cwd: ps.cwd() },
	);
	const tree = stdout.trim() || git.root;
	let slot: Slot;
	try {
		slot = await slots.claim(tree);
	} catch (error) {
		fail("slots_full", error instanceof Error ? error.message : String(error));
	}
	const home = `${registry}/slots/${slot.word}`;
	const saved = new SavedTunnel(`${home}/tunnel.json`, {
		fs,
		store: secrets.device,
	});
	let record = await saved.read();
	if (record === null || (await saved.token()) === undefined) {
		log.info(`setting up slot ${slot.word} ${slot.emoji}`);
		record = await slotTunnelSetup({
			slot,
			machine,
			creds: ctx.creds,
			saved,
			log,
			fetch: ctx.fetch,
		});
	}
	const projects = new Projects(`${home}/projects.json`, {
		fs,
		lock: new FileLock(`${home}/projects.lock`, { fs, ps, log }),
	});
	const registered = (await projects.list()).some(
		(each) => each.root === git.root,
	);
	const cwd = registered ? git.root : await throwaway(ctx, home, projects);
	log.info(
		`slot ${slot.word} ${slot.emoji}: ${color.blue(`https://${record.host}`)}, serving ${cwd}`,
	);
	return {
		slot,
		host: record.host,
		env: { ARBOR_HOME: home, [SLOT]: slot.word, [MACHINE_HOME]: registry },
		cwd,
	};
}

/**
 * The slot's own project, `<home>/project`: a repository with one empty
 * commit and arbor's records, registered in the slot's home. Made once, and
 * kept for the slot's next start, whichever tree holds it then.
 */
async function throwaway(
	ctx: ArborDeps,
	home: string,
	projects: Projects,
): Promise<string> {
	const { fs, ps, log } = ctx;
	const root = `${home}/project`;
	if (!(await fs.exists(`${root}/.git`))) {
		await fs.mkdir(root);
		for (const argv of [
			["git", "init", "--quiet", "--initial-branch", "main"],
			[
				"git",
				"-c",
				"user.name=arbor",
				"-c",
				"user.email=arbor@localhost",
				"commit",
				"--quiet",
				"--allow-empty",
				"--message",
				"Start",
			],
		]) {
			const { exitCode, stderr } = await ps.spawnCapture(argv, { cwd: root });
			if (exitCode !== 0) {
				throw new Error(`could not make ${root}: ${stderr.trim()}`);
			}
		}
		log.info(`${color.green("created")} ${root}, the slot's own project`);
	}
	await openRepository(ctx, { at: root, creates: true });
	await projects.register(root);
	return root;
}

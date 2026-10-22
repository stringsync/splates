import { color, type Logger } from "webappwiz/log";
import { SYSTEM_STORES } from "../creds";
import { fail } from "../exit";
import { splatesHome } from "../models";
import { Projects } from "../projects";
import { openRepository } from "../records";
import type { SplatesDeps } from "../server/shared";
import { FsStorage } from "../storage";
import { machineTunnel, SavedTunnel } from "../tunnel";
import { slotTunnelSetup } from "./slot-tunnel";
import { MACHINE_HOME, SLOT, type Slot, Slots } from "./slots";

/** How `splates server --slot` starts its server: with what added. */
export interface SlotStart {
	slot: Slot;
	/** The public host it answers on, as in fox.example.com. */
	host: string;
	/** The slot's home, its `SPLATES_HOME`, and the word it serves under. */
	env: Record<string, string>;
}

/**
 * Readies the slot this checkout holds, claimed now when it holds none: its
 * tunnel, made on the slot's first claim, and its home, `~/.splates/slots/<word>`,
 * which keeps its own projects, roster and tunnel apart from the machine's, so
 * it never drives the agents of the `splates server` serving your projects. Its
 * home starts out with a throwaway project of its own, made on the first
 * start, so its page has one to show.
 */
export async function devSlot(ctx: SplatesDeps): Promise<SlotStart> {
	const { fs, ps, log, secrets = SYSTEM_STORES } = ctx;
	// The checkout of splates it runs from, wherever it is run, whose creds
	// keep the slot's tunnel token.
	const checkout = import.meta.dirname;
	const { git, creds } = await openRepository(ctx, { at: checkout }).catch(
		(error: unknown) => {
			if (error instanceof Error && error.message.startsWith("not a git")) {
				fail(
					"usage",
					"--slot serves a checkout of splates: run that checkout's bin/splates",
					{ at: checkout },
				);
			}
			throw error;
		},
	);
	// Moving the server onto its box takes the machine's tunnel with it,
	// but slots stay here, under its zone still.
	const machine = await machineTunnel({
		fs,
		home: splatesHome(ps),
		store: secrets.device,
	});
	if (machine === null) {
		fail(
			"usage",
			"--slot serves on a subdomain of the zone `splates tunnel setup` uses: run `splates tunnel setup <host> --email <you>` first",
			{},
		);
	}
	const registry = ps.env(MACHINE_HOME) ?? splatesHome(ps);
	const slots = Slots.ofMachine(ctx);
	// The worktree it runs in, not the main tree every worktree shares, so
	// each worktree holds a slot of its own.
	const { stdout } = await ps.spawnCapture(
		["git", "rev-parse", "--show-toplevel"],
		{ cwd: checkout },
	);
	const tree = stdout.trim() || git.root;
	if (!(await slots.owns(tree))) {
		fail(
			"usage",
			`--slot serves a task's worktree, and ${tree} is the main tree every agent shares, whose server would be any of theirs to stop: \`cd "$(splates path <task>)"\` into your task's worktree, then run \`bin/splates server --slot\` there`,
			{ at: tree },
		);
	}
	let slot: Slot;
	try {
		slot = await slots.claim(tree);
	} catch (error) {
		fail("slots_full", error instanceof Error ? error.message : String(error));
	}
	const home = slots.home(slot);
	await stopLeftover(slots, slot, log);
	const saved = SavedTunnel.in(new FsStorage(`${home}`, fs), secrets.device);
	let record = await saved.read();
	// One saved before slots asked for their token at each start names no
	// account, so it is set up again, reusing its tunnel.
	if (record?.account === undefined) {
		log.info(`setting up slot ${slot.word} ${slot.emoji}`);
		record = await slotTunnelSetup({
			slot,
			machine,
			creds,
			saved,
			log,
			fetch: ctx.fetch,
		});
	}
	const projects = Projects.in(FsStorage.ofMachine({ fs, ps, log, home }), fs);
	if ((await projects.list()).length === 0) {
		await throwaway(ctx, home, projects);
	}
	log.info(
		`slot ${slot.word} ${slot.emoji}: ${color.blue(`https://${record.host}`)}`,
	);
	return {
		slot,
		host: record.host,
		env: { SPLATES_HOME: home, [SLOT]: slot.word, [MACHINE_HOME]: registry },
	};
}

/**
 * The slot's own project, `<home>/project`: a repository with one empty
 * commit and splates's records, registered in the slot's home. Made once, and
 * kept for the slot's next start, whichever tree holds it then.
 */
async function throwaway(
	ctx: SplatesDeps,
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
				"user.name=splates",
				"-c",
				"user.email=splates@localhost",
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

/**
 * Stops the server this tree's slot last ran, if it still runs, as one does
 * when its wrapper was killed or it was started again: it holds a port, and
 * its cloudflared still serves the slot's host from it, so the new server
 * would answer beside old code. Only this tree ever holds the word, so the
 * server is this task's own to stop.
 */
export async function stopLeftover(
	slots: Slots,
	slot: Slot,
	log: Pick<Logger, "info">,
): Promise<void> {
	const pid = await slots.stop(slot);
	if (pid !== null) {
		log.info(
			`stopped slot ${slot.word} ${slot.emoji}'s last server, pid ${pid}, to serve this tree's code`,
		);
	}
}

import { dirname } from "node:path";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { type SecretStores, SYSTEM_STORES } from "../creds";
import { splatesHome } from "../models";
import { Projects } from "../projects";
import { openRepository } from "../records";
import { FsStorage } from "../storage";
import { WorkerBudget, WorkerRecords, workerJoin } from "../workers";
import { CoordinatorBox } from "./box";
import { installWorkerAgent } from "./launch-agent";
import { CoordinatorMove, type MoveRepo } from "./move";
import { workersWithout } from "./without";

/** A `CoordinatorMove` of this machine's coordinator, onto its box. */
export function machineMove(opts: MachineMoveOptions): CoordinatorMove {
	const { ps, fs, log, version } = opts;
	const stores = opts.stores ?? SYSTEM_STORES;
	const home = splatesHome(ps);
	const userHome = ps.env("HOME") ?? dirname(home);
	return new CoordinatorMove({
		ps,
		fs,
		log,
		home,
		version,
		dev: opts.dev,
		worker: ps.hostname,
		here: ps.cwd(),
		...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
		box: async () => {
			const box = new CoordinatorBox({ ps, fs, home });
			return (await box.status()) === null ? null : box.ready();
		},
		repos: async () => {
			const listed = await Projects.ofMachine({ fs, ps, log }).list();
			return Promise.all(
				listed
					.filter((each) => !each.gone)
					.map((each) => moveRepo({ ps, fs, log, stores }, each)),
			);
		},
		workersWithout: async () => {
			const settings = new FsStorage(home, fs);
			const here = await openRepository(
				{ ps, fs, log, secrets: stores },
				{ at: ps.cwd() },
			).catch(() => null);
			return workersWithout({
				config: here?.config ?? null,
				budget: await WorkerBudget.open(
					settings.document("worker-budget.json"),
				),
				records: await WorkerRecords.open(settings.document("workers.json")),
				worker: ps.hostname,
			});
		},
		join: (coordinator, token) =>
			workerJoin({
				coordinator,
				join: token,
				id: ps.hostname,
				keyFile: true,
				log,
				ps,
				fs,
			}),
		keepWorker: (coordinator) =>
			installWorkerAgent({
				fs,
				ps,
				home: userHome,
				splatesHome: home,
				coordinator,
				version,
				bunx: `${dirname(process.execPath)}/bunx`,
			}),
	});
}

/** What `machineMove` runs on. */
export interface MachineMoveOptions {
	ps: Ps;
	fs: Fs;
	log: Logger;
	/** The splates release the box runs, and this machine's worker. */
	version: string;
	/** This machine's `splates server`. */
	dev: string;
	/** Where creds are kept; the system's stores by default. */
	stores?: SecretStores;
	fetch?: typeof fetch;
}

async function moveRepo(
	deps: { ps: Ps; fs: Fs; log: Logger; stores: SecretStores },
	project: { slug: string; root: string },
): Promise<MoveRepo> {
	const repo = await openRepository(
		{ ps: deps.ps, fs: deps.fs, log: deps.log, secrets: deps.stores },
		{ at: project.root },
	);
	const { remote, trunk, worktreeRoot } = repo.config;
	return {
		slug: project.slug,
		root: project.root,
		remote,
		url: remote === null ? null : await repo.git.remoteUrl(remote),
		trunk,
		worktreeRoot,
		pushTasks: async () => {
			const pushed = [];
			for (const tree of await repo.service.list()) {
				if (tree.state !== null && tree.machine === null && tree.exists) {
					pushed.push({
						task: tree.task,
						pushed: await repo.branches.pushTree(tree),
					});
				}
			}
			return pushed;
		},
	};
}

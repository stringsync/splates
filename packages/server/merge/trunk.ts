import type { Fs } from "webappwiz/system";
import { z } from "zod";
import type { Config } from "../config";
import type { Git } from "../git";
import { PUSHED_PREFIX, trackingRef } from "./branches";

/** Who holds the merge lease, as its `holder.json` names them. */
export const LeaseHolder = z.object({
	pid: z.number(),
	hostname: z.string(),
});
export type LeaseHolder = z.infer<typeof LeaseHolder>;

/**
 * What a merge holding the lease lands: `head`, the
 * tested `splates/<task>` it pushed, onto `onto`, the trunk commit it
 * rebased onto and tested on.
 */
export const LandRequest = z.object({
	task: z.string(),
	onto: z.string(),
	head: z.string(),
	holder: LeaseHolder,
});
export type LandRequest = z.infer<typeof LandRequest>;

/** How a landing went. */
export type Landed =
	/** Trunk is `head` on the remote; `local` says what became of the server's own checkout. */
	| { status: "landed"; local: "moved" | { stuck: string } }
	/** Refused before trunk moved, for `why`. */
	| { status: "refused"; why: string }
	/** Trunk moved: rebase and test again without charging an attempt. */
	| { status: "moved" };

/** Moves trunk on the central remote to a task's tested branch. */
export interface TrunkLanding {
	land(request: LandRequest): Promise<Landed>;
}

/**
 * Lands a tested branch on the remote's trunk, from the server's machine,
 * refused unless the request's holder still holds the merge lease and trunk
 * has not moved since the branch was tested.
 */
export class CoordinatorLanding implements TrunkLanding {
	constructor(
		private readonly deps: {
			git: Git;
			fs: Fs;
			config: Pick<Config, "remote" | "trunk">;
			/** The merge lease's directory, `merge.lock`. */
			lease: string;
		},
	) {}

	async land({ task, onto, head, holder }: LandRequest): Promise<Landed> {
		const { git, config } = this.deps;
		const { remote, trunk } = config;
		if (remote === null) {
			return {
				status: "refused",
				why: "no central remote is configured, so there is no trunk to push",
			};
		}
		const held = await this.holder();
		if (
			held === null ||
			held.pid !== holder.pid ||
			held.hostname !== holder.hostname
		) {
			return {
				status: "refused",
				why: `the merge lease is no longer held by pid ${holder.pid} on ${holder.hostname}${held === null ? "" : `: pid ${held.pid} on ${held.hostname} holds it`}`,
			};
		}
		const branch = `refs/heads/${PUSHED_PREFIX}${task}`;
		const trunkRef = `refs/heads/${trunk}`;
		const heads = await git.remoteHeads(remote, [trunkRef, branch]);
		if (heads === null) {
			return { status: "refused", why: `could not read ${remote}` };
		}
		if (heads.get(trunkRef) !== onto) {
			return { status: "moved" };
		}
		if (heads.get(branch) !== head) {
			return {
				status: "refused",
				why: `${PUSHED_PREFIX}${task} on ${remote} is ${short(heads.get(branch) ?? "missing")}, not the tested ${short(head)}`,
			};
		}
		if (!(await git.hasCommit(head))) {
			const fetched = await git.fetch(git.root, [remote, branch]);
			if (fetched.code !== 0) {
				return {
					status: "refused",
					why: `could not fetch ${PUSHED_PREFIX}${task}: ${fetched.stderr || fetched.stdout}`,
				};
			}
		}
		if (!(await git.isAncestor(onto, head))) {
			return {
				status: "refused",
				why: `${PUSHED_PREFIX}${task} is not a fast-forward of ${short(onto)}`,
			};
		}
		// Compared and swapped, so a trunk moved since the check is refused
		// rather than overwritten.
		const pushed = await git.push(git.root, [
			"--no-verify",
			`--force-with-lease=${trunkRef}:${onto}`,
			remote,
			`${head}:${trunkRef}`,
		]);
		if (pushed.code !== 0) {
			const latest = await git.remoteHeads(remote, [trunkRef]);
			if (latest !== null && latest.get(trunkRef) !== onto) {
				return { status: "moved" };
			}
			return {
				status: "refused",
				why: `${remote} refused ${trunk}: ${pushed.stderr || pushed.stdout}`,
			};
		}
		await git.run(git.root, "update-ref", trackingRef(remote, trunk), head);
		return { status: "landed", local: await this.fastForward(head) };
	}

	/**
	 * Brings the server's own trunk to `head`, where it is checked out,
	 * so a single machine sees what landed as it did before the remote.
	 */
	private async fastForward(
		head: string,
	): Promise<"moved" | { stuck: string }> {
		const { git, config } = this.deps;
		const holder = await git.worktreeFor(config.trunk);
		if (holder === null) {
			if (!(await git.isAncestor(`refs/heads/${config.trunk}`, head))) {
				return { stuck: `${config.trunk} holds commits the remote lacks` };
			}
			const moved = await git.run(
				git.root,
				"branch",
				"--force",
				config.trunk,
				head,
			);
			return moved.code === 0 ? "moved" : { stuck: moved.stderr };
		}
		const merged = await git.mergeFfOnly(holder, head);
		return merged.code === 0
			? "moved"
			: { stuck: (merged.stderr || merged.stdout).trim() };
	}

	private async holder(): Promise<LeaseHolder | null> {
		const raw = await this.deps.fs
			.read(`${this.deps.lease}/holder.json`)
			.catch(() => null);
		if (raw === null) {
			return null;
		}
		try {
			const parsed = LeaseHolder.safeParse(JSON.parse(raw));
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	}
}

function short(commit: string): string {
	return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 8) : commit;
}

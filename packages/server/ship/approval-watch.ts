import type { Ps } from "webappwiz/system";
import { approvalChange, awaitingApproval } from "./approval";
import type { Ship } from "./record";
import type { ReleaseStep } from "./release-steps";
import { begun, ended, type Stage, type StageKey } from "./stages";

// A `status` of `npm stage view --json` that names a scan under way.
const SCANNING = /^pending$|scan|process|queue|progress|check|analy/i;

/**
 * Whether npm's scan of a staged package still runs, from the JSON of
 * `npm stage view <stage-id> --json`, and the status it read.
 */
export function scanning(json: string): { scanning: boolean; status: string } {
	// A status it cannot read counts as scanned, so a change in npm's words never holds the push back for good.
	try {
		const { status } = JSON.parse(json) as { status?: unknown };
		return typeof status === "string"
			? { scanning: SCANNING.test(status), status }
			: { scanning: false, status: "no status" };
	} catch {
		return { scanning: false, status: "unreadable" };
	}
}

/** What an {@link ApprovalWatch} reaches the ship through. */
export interface ApprovalWatchOptions {
	ps: Ps;
	root: string;
	/** Milliseconds between looks at npm's scan. */
	every: number;
	now: () => number;
	/** The environment npm runs under, signed in. */
	env: () => Record<string, string>;
	/** Who is signed in to npm, if known. */
	user: () => string | null;
	/** Whether the server is stopping. */
	stopped: () => boolean;
	/** Where in the ship log the output last heard began. */
	from: () => number;
	/** How many bytes the ship log holds. */
	bytes: () => number;
	read: () => Promise<Ship | null>;
	update: (change: Partial<Ship>) => Promise<void>;
	stage: (key: StageKey, change: (stage: Stage) => Stage) => Promise<void>;
}

/**
 * Holds a ship's wait on the person to approve what its release staged
 * until npm has finished scanning it, so the push says the packages are
 * ready to approve rather than that they are staged.
 */
export class ApprovalWatch {
	/** The steps of the release as they last stood. */
	private latest: ReleaseStep[] = [];
	/** The poll of npm's scan, while one runs. */
	private scan: Promise<void> | null = null;

	constructor(private readonly opts: ApprovalWatchOptions) {}

	/** The release's steps now stand as `steps`. */
	async keep(steps: ReleaseStep[]): Promise<void> {
		this.latest = steps;
		const ship = await this.opts.read();
		if (ship === null || this.opts.stopped() || ship.status !== "running") {
			return;
		}
		if (
			awaitingApproval(steps).length === 0 ||
			ship.waiting?.kind === "approve"
		) {
			await this.approved(ship.waiting, steps);
		} else if (this.scan === null) {
			await this.opts.stage("approve", (stage) => ({
				...begun(stage, this.stamp(), "checking"),
				log: stage.log ?? { from: this.opts.from(), to: null },
			}));
			this.scan = this.scanned().finally(() => {
				this.scan = null;
			});
		}
	}

	/** Sets the wait on the person for what is staged, or ends it once it is approved. */
	private async approved(
		waiting: Ship["waiting"],
		steps: ReleaseStep[],
	): Promise<void> {
		const change = approvalChange(
			waiting,
			steps,
			this.stamp(),
			this.opts.user(),
		);
		if (change === null) {
			return;
		}
		await this.opts.update(change);
		await this.opts.stage("approve", (stage) =>
			change.waiting === null
				? {
						...ended(stage, this.stamp(), "done"),
						log:
							stage.log === null
								? null
								: { ...stage.log, to: this.opts.bytes() },
					}
				: {
						...begun(stage, this.stamp(), "asking"),
						check: null,
						log: stage.log ?? { from: this.opts.from(), to: null },
					},
		);
	}

	/**
	 * Polls `npm stage view` for each staged package until npm's scan of all
	 * of them is over, then asks the person, which pushes once. A package
	 * whose view fails counts as scanned, since the person can still look.
	 */
	private async scanned(): Promise<void> {
		const { ps, root, every } = this.opts;
		while (!this.opts.stopped()) {
			const packages = awaitingApproval(this.latest);
			const ship = await this.opts.read();
			if (ship?.status !== "running") {
				return;
			}
			let waiting = 0;
			const heard: string[] = [];
			for (const each of packages) {
				const view = await ps.spawnCapture(
					["npm", "stage", "view", each.stageId, "--json"],
					{ cwd: root, env: this.opts.env() },
				);
				const scan =
					view.exitCode === 0
						? scanning(view.stdout)
						: { scanning: false, status: "view failed" };
				heard.push(`${each.package}@${each.version}: ${scan.status}`);
				waiting += scan.scanning ? 1 : 0;
			}
			if (waiting === 0) {
				await this.approved(ship.waiting, this.latest);
				return;
			}
			const next = new Date(this.opts.now() + every).toISOString();
			await this.opts.stage("approve", (stage) => ({
				...stage,
				check: {
					at: this.stamp(),
					result: `npm is scanning ${waiting} of ${packages.length} staged packages (${heard.join(", ")})`,
					next,
				},
			}));
			await Bun.sleep(every);
		}
	}

	private stamp(): string {
		return new Date(this.opts.now()).toISOString();
	}
}

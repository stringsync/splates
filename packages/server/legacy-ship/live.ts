import type { Logger } from "core/log";
import type { Ps } from "core/system";
import { Duration } from "core/time";
import { NoopLogger } from "../noop-logger";
import { ShipCommandClient } from "./command-client";
import type { ShipProject } from "./graph";

/** Read a project's live artifacts and check whether every one serves a target version. */
export class ShipLive {
	constructor(
		private readonly ps: Pick<Ps, "spawnCapture">,
		private readonly opts: ShipLiveOptions = {},
	) {}

	/** Read artifact evidence from the target command. */
	async read(project: LiveProject): Promise<LiveVersions> {
		const status =
			project.commandPlan === undefined
				? null
				: await new ShipCommandClient(
						this.ps,
						this.opts.log ?? new NoopLogger(),
					).status(project, project.commandInputs);
		if (project.commandPlan !== undefined && status === null) {
			throw new Error(`${project.slug}: ship status --json unavailable`);
		}
		if (status !== null) {
			if (
				status.identity.kind !== project.commandPlan?.identity.kind ||
				status.identity.to !== project.commandPlan?.identity.to
			) {
				throw new Error(
					`${project.slug}: status identity differs from the ship plan`,
				);
			}
			return { version: status.identity.to, artifacts: status.artifacts };
		}
		throw new Error(
			`${project.slug}: ship plan --json unavailable; adopt the core/legacy-ship ShipCommand wrapper`,
		);
	}

	/** Compare with the requested release, keeping each lagging artifact's actual version. */
	async check(project: LiveProject, version: string): Promise<LiveCheck> {
		const status = await this.read(project);
		const lagging = status.artifacts.filter(
			(artifact) => artifact.deployed !== version,
		);
		return {
			...status,
			live: status.artifacts.length > 0 && lagging.length === 0,
			lagging,
		};
	}
}

/** The graph fields needed to read a project's release status. */
export type LiveProject = Pick<ShipProject, "root" | "version" | "packages"> &
	Partial<
		Pick<
			ShipProject,
			"slug" | "paths" | "ship" | "commandPlan" | "commandInputs"
		>
	>;

/** Dependencies to replace when reading live versions. */
export interface ShipLiveOptions {
	log?: Logger;
}

/** What one release artifact serves now; null means nothing is live. */
export interface LiveArtifact {
	name: string;
	deployed: string | null;
}

/** The local release version beside each live artifact. */
export interface LiveVersions {
	version: string | null;
	artifacts: LiveArtifact[];
}

/** Whether all artifacts serve the requested release, and which still lag. */
export interface LiveCheck extends LiveVersions {
	live: boolean;
	lagging: LiveArtifact[];
}

/** Default time a ship step waits for its upstream or its own release to go live. */
export const REGISTRY_DEADLINE = Duration.mins(30);

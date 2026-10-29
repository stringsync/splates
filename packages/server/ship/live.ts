import type { Registry } from "webappwiz/ship";
import type { Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { ConfigFiles } from "../config";
import type { ShipProject } from "./graph";
import { ShipRegistry } from "./registry";

/** Read a project's live artifacts and check whether every one serves a target version. */
export class ShipLive {
	private readonly configs: Pick<ConfigFiles, "read">;
	private readonly registry: Pick<Registry, "deployed">;

	constructor(
		private readonly ps: Pick<Ps, "spawnCapture">,
		opts: ShipLiveOptions = {},
	) {
		this.configs = opts.configs ?? new ConfigFiles();
		this.registry = opts.registry ?? new ShipRegistry();
	}

	/** Read from shipStatus in the main tree, or npm latest for the graph's public packages. */
	async read(project: LiveProject): Promise<LiveVersions> {
		const command = (await this.configs.read(project.root)).shipStatus;
		if (command !== undefined && command !== null) {
			if (typeof command !== "string" || command.trim() === "") {
				throw new Error(
					`${project.root}: shipStatus must be a nonempty command`,
				);
			}
			const result = await this.ps.spawnCapture(["sh", "-c", command], {
				cwd: project.root,
				timeoutMs: Duration.secs(30).ms,
				stdin: "",
			});
			if (result.exitCode !== 0) {
				throw new Error(
					`${project.root}: shipStatus exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
				);
			}
			try {
				return LIVE_VERSIONS.parse(JSON.parse(result.stdout));
			} catch (cause) {
				throw new Error(`${project.root}: invalid shipStatus JSON: ${cause}`, {
					cause,
				});
			}
		}
		if (project.packages.length === 0) {
			throw new Error(
				`${project.root}: no public packages to read; configure shipStatus for live artifacts`,
			);
		}
		const artifacts: LiveArtifact[] = [];
		for (const name of project.packages) {
			artifacts.push({
				name,
				deployed: (await this.registry.deployed(name)) ?? null,
			});
		}
		return { version: project.version, artifacts };
	}

	/** Compare with the requested release, keeping each lagging artifact's actual version. */
	async check(project: LiveProject, version: string): Promise<LiveCheck> {
		const status = await this.read(project);
		const lagging = status.artifacts.filter(
			(artifact) => artifact.deployed !== version,
		);
		return { ...status, live: lagging.length === 0, lagging };
	}
}

/** The graph fields needed to read a project's release status. */
export type LiveProject = Pick<ShipProject, "root" | "version" | "packages">;

/** Dependencies to replace when reading live versions. */
export interface ShipLiveOptions {
	configs?: Pick<ConfigFiles, "read">;
	registry?: Pick<Registry, "deployed">;
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

const NONEMPTY = z.string().trim().min(1);
const LIVE_VERSIONS = z
	.object({
		version: NONEMPTY,
		artifacts: z
			.array(z.object({ name: NONEMPTY, deployed: NONEMPTY.nullable() }))
			.min(1),
	})
	.refine(
		(status) =>
			new Set(status.artifacts.map((artifact) => artifact.name)).size ===
			status.artifacts.length,
		{
			message: "artifact names must be unique",
		},
	);

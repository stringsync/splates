export { FakeReleaseGit } from "./fake-release-git";

import { FakeFs, type FakePs } from "webappwiz/system/testing";
import type { BumpState, BumpTake } from "./bumps";
import type { CascadeProject } from "./cascade";
import type { ShipGraph, ShipSource } from "./graph";
import type { ShipBump } from "./plan";
import type { Ship } from "./run";
import type { Stage } from "./stages";

/** A `package.json` a fixture writes. */
type Manifest = Record<string, unknown>;

/**
 * The projects served today, as `package.json` files on a fake disk:
 * webappwiz → splates, mdom, vexml, sound2score; mdom → vexml, sound2score;
 * vexml and splates → sound2score. sound2score is private.
 */
export async function servedProjects(
	fs: FakeFs = new FakeFs(),
): Promise<{ fs: FakeFs; sources: ShipSource[] }> {
	const write = async (path: string, manifest: Manifest) => {
		await fs.mkdir(path, { recursive: true });
		await fs.write(`${path}/package.json`, JSON.stringify(manifest));
	};
	await write("/webappwiz", {
		name: "webappwiz-workspace",
		version: "0.0.50",
		private: true,
		workspaces: ["packages/*"],
	});
	await write("/webappwiz/packages/webappwiz", {
		name: "webappwiz",
		version: "0.0.50",
	});
	await write("/webappwiz/packages/cli", {
		name: "@webappwiz/cli",
		version: "0.0.50",
		dependencies: { webappwiz: "workspace:*" },
	});
	await write("/splates", {
		name: "splates-workspace",
		version: "0.0.57",
		private: true,
		workspaces: ["packages/*"],
		devDependencies: { "@webappwiz/cli": "0.0.50", webappwiz: "0.0.50" },
	});
	await write("/splates/packages/server", {
		name: "@stringsync/splates-server",
		version: "0.0.57",
		dependencies: { webappwiz: "0.0.50" },
	});
	await write("/splates/packages/web", {
		name: "@stringsync/splates-web",
		private: true,
	});
	await write("/mdom", {
		name: "@stringsync/mdom",
		version: "1.4.2",
		dependencies: { webappwiz: "0.0.50" },
	});
	await write("/vexml", {
		name: "@stringsync/vexml",
		version: "2.0.9",
		dependencies: { "@stringsync/mdom": "1.4.2", webappwiz: "0.0.50" },
	});
	await write("/sound2score", {
		name: "sound2score",
		version: "0.1.0",
		private: true,
		dependencies: {
			"@stringsync/mdom": "1.4.2",
			"@stringsync/splates-server": "0.0.57",
			"@stringsync/vexml": "2.0.9",
			webappwiz: "0.0.50",
		},
	});
	const sources: ShipSource[] = [
		{ slug: "webappwiz", root: "/webappwiz", ship: "wiz dev ship" },
		{ slug: "splates", root: "/splates", ship: "./bin/splates dev ship" },
		{ slug: "mdom", root: "/mdom", ship: "wiz dev ship" },
		{ slug: "vexml", root: "/vexml", ship: "wiz dev ship" },
		{ slug: "sound2score", root: "/sound2score", ship: null },
	];
	return { fs, sources };
}

/** The `index`th child `ps` started, once it has. */
export async function nth(ps: FakePs, index: number) {
	await until(async () => ps.getChildren().length > index);
	return ps.getChildren()[index] as ReturnType<FakePs["start"]>;
}

/** Waits for `done` to answer true, failing after a second. */
export async function until(done: () => Promise<boolean>): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (await done()) {
			return;
		}
		await Bun.sleep(5);
	}
	throw new Error("timed out");
}

/** A project as a cascade reaches it, its ship and bump tasks driven by the test. */
export class FakeProject implements CascadeProject {
	ship: Ship | null = null;
	afterBump: string | null = null;
	starts = 0;
	releaseBumps: ShipBump[] = [];
	refuse: string | null = null;
	bumps = {
		added: [] as { from: string; origin: string; takes: BumpTake[] }[],
		states: new Map<number, BumpState>(),
		add: async (
			{ from, origin }: { from: string; origin: string },
			takes: BumpTake[],
		) => {
			this.bumps.added.push({ from, origin, takes });
			const id = 100 + this.bumps.added.length;
			this.bumps.states.set(id, "open");
			return id;
		},
		state: async (id: number) => this.bumps.states.get(id) ?? "removed",
		removed: [] as number[],
		remove: async (id: number) => {
			this.bumps.removed.push(id);
			this.bumps.states.set(id, "removed");
		},
	};
	/** The logs each ship was told to write to. */
	logs: (string | undefined)[] = [];
	stops = 0;
	shipping = {
		start: async (
			bump: ShipBump = "patch",
			{ log }: { log?: string } = {},
		): Promise<Ship> => {
			if (this.refuse !== null) {
				throw new Error(this.refuse);
			}
			this.starts++;
			this.releaseBumps.push(bump);
			this.logs.push(log);
			this.ship = {
				project: this.root.slice(1),
				command: "wiz dev ship",
				bump,
				status: "running",
				step: "login",
				from: null,
				to: null,
				started: `2026-10-27T12:00:0${this.starts}.000Z`,
				ended: null,
				waiting: null,
				error: null,
				resumed: 0,
				log,
				stages: this.stages,
			};
			return this.ship;
		},
		current: async () => this.ship,
		stop: async () => {
			this.stops++;
			this.end("failed");
		},
	};

	/** The ship's own steps as its next ship starts them, which a test may set. */
	stages: Stage[] | undefined = undefined;

	constructor(readonly root: string) {}

	/** Its first bump task. */
	bump(): number {
		return 101;
	}

	end(status: "done" | "failed", to: string | null = null): void {
		if (this.ship !== null) {
			this.ship = { ...this.ship, status, to, error: "npm said no\nmore" };
		}
	}
}

/** `graph` with each project `commits` names that many commits past its version tag. */
export function withChanges(
	graph: ShipGraph,
	commits: Record<string, number>,
): ShipGraph {
	for (const project of graph.projects) {
		const count = commits[project.slug];
		if (count !== undefined) {
			project.changes = {
				commits: count,
				branch: "main",
				tag: `v${project.version}`,
				error: null,
			};
		}
	}
	return graph;
}

export { FakeReleaseGit } from "./fake-release-git";

import { FakeFs, type FakePs } from "webappwiz/system/testing";
import type { ShipGraph, ShipSource } from "./graph";

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

/** The `index`th terminal `ps` started, once it has. */
export async function nth(ps: FakePs, index: number) {
	await until(async () => ps.getTerminals().length > index);
	return ps.getTerminals()[index] as ReturnType<FakePs["startOnTerminal"]>;
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

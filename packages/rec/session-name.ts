import type { Fs } from "core/system";
import { z } from "zod";

export const sessionName = z.string().regex(/^[a-z]+(?:-[a-z]+)*$/, {
	message:
		"Use lowercase words joined by hyphens, for example brave-copper-otter",
});

const qualities = [
	"brave",
	"calm",
	"clever",
	"bright",
	"gentle",
	"happy",
	"lucky",
	"quiet",
	"swift",
	"kind",
	"merry",
	"bold",
];
const colors = [
	"copper",
	"amber",
	"silver",
	"golden",
	"coral",
	"indigo",
	"olive",
	"violet",
	"scarlet",
	"azure",
	"ivory",
	"jade",
];
const animals = [
	"otter",
	"badger",
	"falcon",
	"fox",
	"heron",
	"lynx",
	"panda",
	"robin",
	"seal",
	"tiger",
	"whale",
	"wren",
];

/** Pick an unused memorable name; throws when the vocabulary is exhausted. */
export function suggestName(
	used: ReadonlySet<string>,
	random = Math.random,
): string {
	const size = qualities.length * colors.length * animals.length;
	const start = Math.floor(random() * size);
	for (let offset = 0; offset < size; offset++) {
		const index = (start + offset) % size;
		const name = `${qualities[Math.floor(index / (colors.length * animals.length))]}-${colors[Math.floor(index / animals.length) % colors.length]}-${animals[index % animals.length]}`;
		if (!used.has(name)) {
			return name;
		}
	}
	throw new Error("All session names are in use; choose one with --name");
}

/** Select session identities using the saved sessions and running recorder. */
export class SessionNames {
	constructor(private readonly fs: Fs) {}
	/** Read occupied names from saved sessions in a root folder. */
	async used(root: string): Promise<Set<string>> {
		const used = new Set<string>();
		for (const entry of await this.fs
			.readdir(root)
			.catch(() => [] as string[])) {
			used.add(entry);
			try {
				const manifest = JSON.parse(
					await this.fs.read(`${root}/${entry}/manifest.json`),
				);
				if (typeof manifest.name === "string") {
					used.add(manifest.name);
				}
			} catch {
				// An unfinished or legacy folder still reserves its basename.
			}
		}
		return used;
	}

	/** Read saved names and the name reserved by the running recorder. */
	async available(home: string, userHome: string): Promise<Set<string>> {
		const used = await this.used(`${userHome}/Desktop/rec`);
		for (const name of await this.used(`${home}/sessions`)) {
			used.add(name);
		}
		for (const dir of await this.savedFolders(home)) {
			try {
				const manifest = JSON.parse(await this.fs.read(`${dir}/manifest.json`));
				if (typeof manifest.name === "string") {
					used.add(manifest.name);
				}
			} catch {
				// Deleted sessions no longer reserve a name.
			}
		}
		const active = JSON.parse(
			await this.fs.read(`${home}/server.json`).catch(() => "{}"),
		);
		if (typeof active.name === "string") {
			used.add(active.name);
		}
		return used;
	}

	private async savedFolders(home: string): Promise<string[]> {
		return JSON.parse(
			await this.fs.read(`${home}/session-folders.json`).catch(() => "[]"),
		);
	}

	/** Remember a saved folder so custom output paths participate in name checks. */
	async remember(home: string, dir: string): Promise<void> {
		const folders = await this.savedFolders(home);
		await this.fs.write(
			`${home}/session-folders.json`,
			JSON.stringify([...new Set([...folders, dir])]),
		);
	}

	/** Choose a launch name, rejecting an occupied explicit name, including a custom output folder's. */
	async choose(
		used: Set<string>,
		requested?: string,
		out?: string,
	): Promise<string> {
		if (out) {
			const saved = JSON.parse(
				await this.fs.read(`${out}/manifest.json`).catch(() => "{}"),
			);
			if (typeof saved.name === "string") {
				used.add(saved.name);
			}
		}
		const name = requested ?? suggestName(used);
		if (used.has(name)) {
			throw new Error(
				`Session name ${name} is already in use; choose another --name`,
			);
		}
		return name;
	}
}

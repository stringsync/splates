import { resolve } from "node:path";
import { Markdown } from "webappwiz/md";
import type { Fs } from "webappwiz/system";

/** One durable project note, found by its description and read at its path. */
export interface ProjectNote {
	path: string;
	description: string;
}

/** The markdown notes in a checkout, with their on-demand descriptions. */
export class Notes {
	constructor(private readonly fs: Fs) {}

	/** Reads the flat notes directory in filename order; an absent directory is empty. */
	async list(
		root: string,
		{ notesDir = "notes" }: { notesDir?: string } = {},
	): Promise<ProjectNote[]> {
		const directory = resolve(root, notesDir);
		if (!(await this.fs.exists(directory))) {
			return [];
		}
		const notes: ProjectNote[] = [];
		for (const file of (await this.fs.readdir(directory)).sort()) {
			const path = resolve(directory, file);
			if (!file.endsWith(".md") || (await this.fs.stat(path)).isDirectory()) {
				continue;
			}
			const description = Markdown.parse(
				(await this.fs.read(path)).replace(/\r\n/g, "\n"),
			).fields.description?.trim();
			if (!description || description === "|" || description === ">") {
				throw new Error(`${path}: frontmatter needs a one-line description`);
			}
			notes.push({ path, description });
		}
		return notes;
	}
}

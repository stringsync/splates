import { resolve } from "node:path";
import { Markdown } from "webappwiz/md";
import type { Fs } from "webappwiz/system";

/** One durable project note, found by its description and read at its path. */
export interface ProjectNote {
	path: string;
	description: string;
}

/** A note's source for an agent and its body for the reader. */
export interface ReadNote extends ProjectNote {
	text: string;
	body: string;
}

/** Where a checkout keeps its notes, relative to its root. */
export interface NotesOptions {
	notesDir?: string;
}

/** The markdown notes in a checkout, with their on-demand descriptions. */
export class Notes {
	constructor(private readonly fs: Fs) {}

	/** Only a listed note may be read, so a page cannot ask for arbitrary files. */
	async read(
		root: string,
		path: string,
		opts: NotesOptions = {},
	): Promise<ReadNote | null> {
		const note = (await this.list(root, opts)).find(
			(note) => note.path === path,
		);
		if (note === undefined) {
			return null;
		}
		const text = await this.fs.read(note.path);
		return {
			...note,
			text,
			body: Markdown.parse(text.replace(/\r\n/g, "\n")).body,
		};
	}

	/** Reads the flat notes directory in filename order; an absent directory is empty. */
	async list(
		root: string,
		{ notesDir = "notes" }: NotesOptions = {},
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

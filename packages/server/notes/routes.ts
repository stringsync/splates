import { relative } from "node:path";
import { fail } from "../exit";
import type { Project } from "../server/shared";
import { type ListedNote, Notes } from "./notes";
import { NoteUses } from "./uses";

/** Read the project's landed notes from its main checkout. */
export class NotesRoutes {
	constructor(private readonly project: Project) {}

	readonly listNotes = async (): Promise<Response> => {
		const { service, fs, storage } = this.project;
		const root = service.git.root;
		const counts = await new NoteUses(storage).counts();
		const listed: ListedNote[] = (
			await new Notes(fs).list(root, service.config)
		).map((note) => ({
			...note,
			uses: counts.get(relative(root, note.path)) ?? 0,
		}));
		// Array.sort is stable, so notes read equally often keep filename order.
		return Response.json(
			listed.sort((first, second) => second.uses - first.uses),
		);
	};

	readonly readNote = async (request: Request): Promise<Response> => {
		const { service, fs } = this.project;
		const path = new URL(request.url).searchParams.get("path");
		const note = await new Notes(fs).read(
			service.git.root,
			path ?? "",
			service.config,
		);
		if (note === null) {
			fail("not_found", "That project note no longer exists.");
		}
		return Response.json(note);
	};
}

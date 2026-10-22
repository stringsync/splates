import { relative } from "node:path";
import { fail } from "../exit";
import type { Project } from "../server/shared";
import { APPLIED } from "./applied";
import { type ListedNote, Notes } from "./notes";
import { NoteRemoval, NoteSave, NoteSaves } from "./saves";
import { NoteUses } from "./uses";

/** Read the project's landed notes from its main checkout, and land the page's changes to them. */
export class NotesRoutes {
	readonly #saves: NoteSaves;

	constructor(private readonly project: Project) {
		this.#saves = new NoteSaves({
			...project,
			git: project.service.git,
			config: project.service.config,
		});
	}

	readonly listNotes = async (): Promise<Response> => {
		const { service, fs, storage } = this.project;
		const root = service.git.root;
		const counts = await new NoteUses(storage).counts();
		const { recommended, followed } = await this.#judged();
		const listed: ListedNote[] = (
			await new Notes(fs).list(root, service.config)
		).map((note) => ({
			...note,
			uses: counts.get(relative(root, note.path)) ?? 0,
			recommended: recommended.get(relative(root, note.path)) ?? 0,
			followed: followed.get(relative(root, note.path)) ?? 0,
		}));
		// Array.sort is stable, so notes read equally often keep filename order.
		return Response.json(
			listed.sort((first, second) => second.uses - first.uses),
		);
	};

	/**
	 * Per note, the messages it was attached to as a pointer (never in a
	 * holdout) and the turns whose judge found it applied.
	 */
	async #judged(): Promise<{
		recommended: Map<string, number>;
		followed: Map<string, number>;
	}> {
		const recommended = new Map<string, number>();
		const followed = new Map<string, number>();
		const bump = (counts: Map<string, number>, path: string) =>
			counts.set(path, (counts.get(path) ?? 0) + 1);
		const events = await this.project.journal.recent().catch(() => []);
		for (const event of events) {
			if (event.action === "notes attached" && !event.holdout) {
				for (const note of event.notes ?? []) {
					if (note.tier !== null) {
						bump(recommended, note.path);
					}
				}
			} else if (
				event.action === "note applied" &&
				event.path !== undefined &&
				(event.probability ?? 0) >= APPLIED
			) {
				bump(followed, event.path);
			}
		}
		return { recommended, followed };
	}

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
		return Response.json({ ...note, blob: await this.#saves.blob(note.path) });
	};

	readonly saveNote = async (request: Request): Promise<Response> => {
		const parsed = NoteSave.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			fail("usage", "a note save needs its file, description and body");
		}
		return Response.json(await this.#saves.save(parsed.data));
	};

	readonly removeNote = async (request: Request): Promise<Response> => {
		const parsed = NoteRemoval.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success) {
			fail("usage", "a note removal needs the note's path");
		}
		return Response.json(await this.#saves.remove(parsed.data));
	};
}

import type {
	ElsewhereBoards,
	ElsewhereFollower,
	ElsewhereOpen,
	ElsewhereTask,
} from "./elsewhere";

/** The boards of a machine with no other splates project: it finds none, and names a project by its directory. */
export class NoopElsewhereBoards implements ElsewhereBoards {
	async root(_slug: string): Promise<string | null> {
		return null;
	}

	async slug(root: string): Promise<string> {
		return root.split("/").filter(Boolean).at(-1) ?? root;
	}

	async find(_root: string, _id: number): Promise<ElsewhereTask | null> {
		return null;
	}

	async following(_root: string): Promise<ElsewhereFollower[]> {
		return [];
	}

	async openTasks(_root: string): Promise<ElsewhereOpen[]> {
		return [];
	}
}

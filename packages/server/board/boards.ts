/**
 * A board groups a project's lanes, as in Trello: a lane belongs to exactly
 * one board, and the board is organizational only. Tasks, links and lane
 * numbers do not change with it.
 */
export interface BoardRecord {
	id: number;
	name: string;
	/** Where it comes among the project's boards, 1 the first. */
	position: number;
	/** Put away: kept, but off the switcher. */
	archived: boolean;
}

/** The board every lane starts on; the first board of a project that never made another. */
export const DEFAULT_BOARD = 1;

/** What the migrated default board is called. */
export const DEFAULT_BOARD_NAME = "Default";

/**
 * The boards as stored, in order, each with its position. The default board
 * is always there, and the first when nothing is stored: a project from
 * before boards has one board holding every lane.
 */
export function boardsOf(stored: unknown): BoardRecord[] {
	const found: Omit<BoardRecord, "position">[] = [];
	if (Array.isArray(stored)) {
		for (const each of stored) {
			if (
				Number.isInteger(each?.id) &&
				typeof each?.name === "string" &&
				!found.some((board) => board.id === each.id)
			) {
				found.push({
					id: each.id,
					name: each.name,
					archived: each.archived === true,
				});
			}
		}
	}
	if (!found.some((board) => board.id === DEFAULT_BOARD)) {
		found.unshift({
			id: DEFAULT_BOARD,
			name: DEFAULT_BOARD_NAME,
			archived: false,
		});
	}
	return found.map((board, i) => ({ ...board, position: i + 1 }));
}

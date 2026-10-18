import { createContext, useContext } from "react";
import { type Refuse, useRefusal, type useRefusals } from "./refusal";

/**
 * Refusals by conversation, so one said under a row outlives the row leaving
 * the list and coming back, as an archive refused after the row went does.
 */
export const RowRefusals = createContext<ReturnType<
	typeof useRefusals<string>
> | null>(null);

/**
 * The refusal said under conversation `id`'s row, kept in `RowRefusals`
 * when it is given, and by the row itself otherwise.
 */
export function useRowRefusal(id: string): {
	refusal: string | null;
	refuse: Refuse;
} {
	const own = useRefusal();
	const rows = useContext(RowRefusals);
	if (rows === null) {
		return own;
	}
	return {
		refusal: rows.refusals.get(id) ?? null,
		refuse: (title, error) => rows.refuse(id, title, error),
	};
}

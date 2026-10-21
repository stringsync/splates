import { useEffect, useState } from "react";
import { evalBatches } from "./api";
import { PAGES } from "./page-route";

let known: Promise<boolean> | null = null;

/**
 * Whether the server has saved eval runs to browse, which only one running
 * from a splates checkout does: asked once, and false until it answers.
 */
export function useEvalsAvailable(): boolean {
	const [available, setAvailable] = useState(false);
	useEffect(() => {
		known ??= evalBatches().then(
			(batches) => batches !== null,
			() => false,
		);
		let current = true;
		void known.then((yes) => current && setAvailable(yes));
		return () => {
			current = false;
		};
	}, []);
	return available;
}

/** The pages in the nav: Evals only where there are saved runs to browse. */
export function useNavPages(): typeof PAGES {
	const evals = useEvalsAvailable();
	return PAGES.filter(({ value }) => value !== "evals" || evals);
}

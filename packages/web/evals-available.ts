import { useEffect, useState } from "react";
import { evalBatches, scoped } from "./api";
import { PAGES } from "./page-route";

const known = new Map<string, Promise<boolean>>();

/**
 * Whether the project this page shows has saved eval runs to browse: one
 * whose config names `evals.results`, or any on a server run from a splates
 * checkout. Asked once a project, and false until it answers.
 */
export function useEvalsAvailable(): boolean {
	const [available, setAvailable] = useState(false);
	useEffect(() => {
		const key = scoped("/api/evals");
		let asked = known.get(key);
		if (asked === undefined) {
			asked = evalBatches().then(
				(batches) => batches !== null,
				() => false,
			);
			known.set(key, asked);
		}
		let current = true;
		void asked.then((yes) => current && setAvailable(yes));
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

import type { FinishedTask } from "@splates/server/tasks";
import { createContext, type ReactNode, useEffect, useState } from "react";
import { answered, scoped } from "./api";

/** Saved tasks remain referenceable after their worktrees leave. */
export const FinishedReferences = createContext<readonly FinishedTask[]>([]);

export function FinishedReferencesProvider({
	moved,
	children,
}: {
	moved: string;
	children: ReactNode;
}) {
	const [tasks, setTasks] = useState<FinishedTask[]>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh when the project or live task list changes
	useEffect(() => {
		let current = true;
		setTasks([]);
		answered(scoped("/api/finished"))
			.then(async (response) => {
				if (!response.ok) {
					return;
				}
				const read: FinishedTask[] = await response.json();
				if (current) {
					setTasks(read);
				}
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [moved]);
	return <FinishedReferences value={tasks}>{children}</FinishedReferences>;
}

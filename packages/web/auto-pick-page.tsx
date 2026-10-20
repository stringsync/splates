import type { TaskRecord } from "@stringsync/splates-server/board/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { type JSX, useState } from "react";
import { AutoPickLog, AutoPickMark } from "./auto-pick-log";
import { RulesEditor } from "./auto-pick-rules";
import { RulesEditorView } from "./auto-pick-rules-editor";
import { autoPickRuns } from "./auto-pick-runs";
import { TopBar } from "./top-bar";

/**
 * The Auto pick page: its log of picks, then the routing rules a pick
 * follows, each offering the picks it made. The log's "Edit rule" opens a
 * rule marked.
 */
export function AutoPickPage({
	mark,
	tasks,
	todos,
	opens,
}: {
	/** The rule to set the page on, by its place from 0, or null. */
	mark: number | null;
	tasks: readonly Details[];
	todos: readonly TaskRecord[];
	opens: { todo: (id: number) => void; task: (task: string) => void };
}): JSX.Element {
	const [editor] = useState(() => new RulesEditor());
	// The rule whose picks the log lists; null for all of them.
	const [only, setOnly] = useState<number | null>(null);
	const [logOpen, setLogOpen] = useState(false);
	const runs = autoPickRuns(tasks, todos);
	const counts = runs.reduce<number[]>((all, run) => {
		all[run.picked.rule] = (all[run.picked.rule] ?? 0) + 1;
		return all;
	}, []);
	return (
		<section aria-label="Auto pick" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Auto pick" />
			<div className="flex items-center gap-3">
				<AutoPickMark className="size-8" />
				<p className="text-muted-foreground text-sm">
					On a task started with no agent named, the first rule that matches
					what the judge took it for picks the agent.
				</p>
			</div>
			<details
				open={logOpen}
				onToggle={(event) => setLogOpen(event.currentTarget.open)}
				className="flex flex-col gap-2"
			>
				<summary className="cursor-pointer text-sm">
					Log of picks ({runs.length})
					{only !== null && ` · rule ${only + 1} only`}
				</summary>
				<div className="flex flex-col gap-2 pt-2">
					{only !== null && (
						<button
							type="button"
							className="self-start text-muted-foreground text-xs underline"
							onClick={() => setOnly(null)}
						>
							Show every rule's picks
						</button>
					)}
					<AutoPickLog tasks={tasks} todos={todos} opens={opens} only={only} />
				</div>
			</details>
			<RulesEditorView
				editor={editor}
				mark={mark}
				picks={counts}
				onLog={(rule) => {
					setOnly(rule);
					setLogOpen(true);
				}}
			/>
		</section>
	);
}

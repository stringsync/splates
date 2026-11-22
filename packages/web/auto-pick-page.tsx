import type { TaskRecord } from "@splates/server/board/browser";
import type { Details } from "@splates/server/tasks";
import { useReactive } from "core/react";
import { ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { AutoPickAvoided } from "./auto-pick-avoided";
import { AutoPickLog, AutoPickMark } from "./auto-pick-log";
import { AutoPickOverrides } from "./auto-pick-overrides";
import { cellKeyLabel, pickedCell, RulesEditor } from "./auto-pick-rules";
import { RulesEditorView } from "./auto-pick-rules-editor";
import { autoPickRuns } from "./auto-pick-runs";
import { guardNavigation } from "./navigation-guard";
import { TopBar } from "./top-bar";

/**
 * The Auto pick page: edit its routes and lineups and see what they picked.
 * Pass `mark` to open the routes on a cell, as the log's Edit route does.
 */
export function AutoPickPage({
	mark,
	tasks,
	todos,
	opens,
}: {
	/** The cell to set the routes on, `bugfix.deep`, or null. */
	mark: string | null;
	tasks: readonly Details[];
	todos: readonly TaskRecord[];
	opens: { todo: (id: number) => void; task: (task: string) => void };
}): JSX.Element {
	const [editor] = useState(() => new RulesEditor());
	// Leaving with edits unsaved asks first, here and on a reload.
	const [leaving, setLeaving] = useState<(() => void) | null>(null);
	const pending = useReactive(editor, (each) => each.dirty || each.saving, [
		"changed",
	]);
	useEffect(
		() =>
			guardNavigation((proceed) => {
				if (!editor.dirty && !editor.saving) {
					return true;
				}
				setLeaving(() => proceed);
				return false;
			}),
		[editor],
	);
	useEffect(() => {
		if (!pending) {
			return;
		}
		const ask = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", ask);
		return () => window.removeEventListener("beforeunload", ask);
	}, [pending]);
	// The cell whose picks the log lists, `bugfix.deep`; null for all of them.
	const [only, setOnly] = useState<string | null>(null);
	const [logOpen, setLogOpen] = useState(false);
	const runs = autoPickRuns(tasks, todos);
	const counts = runs.reduce<Record<string, number>>((all, run) => {
		const cell = pickedCell(run.picked);
		all[cell] = (all[cell] ?? 0) + 1;
		return all;
	}, {});
	return (
		<>
			<section aria-label="Auto pick" className="flex min-w-0 flex-col gap-6">
				<TopBar title="Auto pick" />
				<div className="flex items-center gap-3">
					<AutoPickMark className="size-8" />
					<p className="text-muted-foreground text-sm">
						On a task started with no agent named, the judge sorts it by kind
						and difficulty, and the lineup that pair routes to picks the agent.
					</p>
				</div>
				<AutoPickAvoided />
				<Collapsible
					open={logOpen}
					onOpenChange={setLogOpen}
					className="flex flex-col gap-2"
				>
					<CollapsibleTrigger
						render={<Button variant="ghost" className="group self-start" />}
					>
						<ChevronRightIcon
							aria-hidden
							data-icon="inline-start"
							className="transition-transform group-aria-expanded:rotate-90"
						/>
						Log of picks ({runs.length})
						{only !== null && ` · ${cellKeyLabel(only)} only`}
					</CollapsibleTrigger>
					<CollapsibleContent className="flex flex-col gap-2 pt-2">
						{only !== null && (
							<button
								type="button"
								className="self-start text-muted-foreground text-xs underline"
								onClick={() => setOnly(null)}
							>
								Show every pick
							</button>
						)}
						<AutoPickLog
							tasks={tasks}
							todos={todos}
							opens={opens}
							only={only}
						/>
					</CollapsibleContent>
				</Collapsible>
				<RulesEditorView
					editor={editor}
					mark={mark}
					counts={counts}
					onLog={(cell) => {
						setOnly(cell);
						setLogOpen(true);
					}}
				/>
				<AutoPickOverrides
					onCell={(cell) => {
						setOnly(cell);
						setLogOpen(true);
					}}
				/>
			</section>
			<Dialog
				open={leaving !== null}
				onOpenChange={(open) => {
					if (!open) {
						setLeaving(null);
					}
				}}
			>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Leave without saving?</DialogTitle>
						<DialogDescription>
							{editor.saving
								? "Your Auto pick changes have not finished saving. Leave anyway?"
								: "Your Auto pick changes are not saved. Leaving drops them."}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Keep editing
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								const proceed = leaving;
								setLeaving(null);
								if (!editor.saving) {
									editor.discard();
								}
								proceed?.();
							}}
						>
							Leave without saving
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

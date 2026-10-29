import type { TaskRecord } from "@stringsync/splates-server/board/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { AutoPickLog, AutoPickMark } from "./auto-pick-log";
import { AutoPickOverrides } from "./auto-pick-overrides";
import { RulesEditor } from "./auto-pick-rules";
import { RulesEditorView } from "./auto-pick-rules-editor";
import { autoPickRuns } from "./auto-pick-runs";
import { BackButton } from "./back-button";
import { guardNavigation } from "./navigation-guard";
import { TopBar } from "./top-bar";

/**
 * Edit Auto pick's routing rules and inspect what they picked. Open it from
 * the Auto pick card on Automations; the log's "Edit rule" marks a rule here.
 */
export function AutoPickPage({
	mark,
	tasks,
	todos,
	opens,
	onBack,
}: {
	/** The rule to set the page on, by its place from 0, or null. */
	mark: number | null;
	tasks: readonly Details[];
	todos: readonly TaskRecord[];
	opens: { todo: (id: number) => void; task: (task: string) => void };
	/** Goes back to the Automations page. */
	onBack: () => void;
}): JSX.Element {
	const [editor] = useState(() => new RulesEditor());
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
	// The rule whose picks the log lists; null for all of them.
	const [only, setOnly] = useState<number | null>(null);
	const [logOpen, setLogOpen] = useState(false);
	const runs = autoPickRuns(tasks, todos);
	const counts = runs.reduce<number[]>((all, run) => {
		all[run.picked.rule] = (all[run.picked.rule] ?? 0) + 1;
		return all;
	}, []);
	return (
		<>
			<section aria-label="Auto pick" className="flex min-w-0 flex-col gap-6">
				<TopBar
					leading={<BackButton parent="Automations" onBack={onBack} />}
					title="Auto pick"
				/>
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
						<AutoPickLog
							tasks={tasks}
							todos={todos}
							opens={opens}
							only={only}
						/>
					</div>
				</details>
				<AutoPickOverrides
					onRule={(rule) => {
						setOnly(rule);
						setLogOpen(true);
					}}
				/>
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
						<DialogTitle>Leave Auto pick?</DialogTitle>
						<DialogDescription>
							Your config changes have not finished saving. Leave anyway?
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
								proceed?.();
							}}
						>
							Leave page
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

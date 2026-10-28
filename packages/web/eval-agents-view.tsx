import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect } from "react";
import { PickChips } from "./auto-pick-pick-chips";
import type { EvalAgentsEditor } from "./eval-agents";
import { pendingRow, useShowPending } from "./pending";

/**
 * Pick the agents evals run on, each at a model and thinking level. Edits
 * save as you make them and the list dims until the server has them. Starts
 * nothing.
 */
export function EvalAgentsView({
	editor,
}: {
	editor: EvalAgentsEditor;
}): JSX.Element {
	const { picks, problem, loaded, saving } = useReactive(
		editor,
		(each) => ({
			picks: each.picks,
			problem: each.problem,
			loaded: each.loaded,
			saving: each.saving,
		}),
		["changed"],
	);
	const shown = useShowPending(saving);
	useEffect(() => void editor.load(), [editor]);
	return (
		<section
			aria-label="eval agents"
			{...pendingRow(saving, shown, "flex flex-col gap-2")}
		>
			<h2 className="font-medium text-sm">Agents</h2>
			<p className="text-muted-foreground text-xs">
				The agents an eval runs on, each at the model and thinking level shown.
				Saving them starts nothing.
			</p>
			{problem !== null && (
				<p role="alert" className="text-destructive text-sm">
					{problem}
				</p>
			)}
			{loaded && <PickChips list={editor} picks={picks} />}
		</section>
	);
}

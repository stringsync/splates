import { useReactive } from "core/react";
import { type JSX, useEffect } from "react";
import { PickChips } from "./auto-pick-pick-chips";
import type { EvalAgentsEditor } from "./eval-agents";
import { EvalSection } from "./eval-section";
import { pendingRow, useShowPending } from "./pending";

const ABOUT =
	"The agents an eval runs on, each at the model and thinking level shown. Saving them starts nothing.";

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
		<div {...pendingRow(saving, shown, "flex flex-col")}>
			<EvalSection label="eval agents" title="Agents" about={ABOUT}>
				{problem !== null && (
					<p role="alert" className="text-destructive text-sm">
						{problem}
					</p>
				)}
				<div className="rounded-xl border bg-card px-4 py-2 shadow-xs">
					{loaded && <PickChips list={editor} picks={picks} indent="" />}
				</div>
			</EvalSection>
		</div>
	);
}

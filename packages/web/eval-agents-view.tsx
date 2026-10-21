import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect } from "react";
import { PickChips } from "./auto-pick-pick-chips";
import type { EvalAgentsEditor } from "./eval-agents";

/**
 * The agents evals run on, as the chips Auto pick's rules use: each a pick
 * of agent, model and thinking level, saved as it is edited. Starts nothing.
 */
export function EvalAgentsView({
	editor,
}: {
	editor: EvalAgentsEditor;
}): JSX.Element {
	const { picks, problem, loaded } = useReactive(
		editor,
		(each) => ({
			picks: each.picks,
			problem: each.problem,
			loaded: each.loaded,
		}),
		["changed"],
	);
	useEffect(() => void editor.load(), [editor]);
	return (
		<section aria-label="eval agents" className="flex flex-col gap-2">
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

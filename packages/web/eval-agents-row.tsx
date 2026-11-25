import { useReactive } from "core/react";
import { ChevronRightIcon, SettingsIcon } from "lucide-react";
import { type JSX, useEffect } from "react";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "#web/components/ui/dialog.tsx";
import type { EvalAgentsEditor } from "./eval-agents";
import { EvalAgentsView } from "./eval-agents-view";

/**
 * A quiet row on the Evals page that opens the saved eval agents, the same
 * list the evals card edits, with a line on how many are saved.
 */
export function EvalAgentsRow({
	editor,
}: {
	editor: EvalAgentsEditor;
}): JSX.Element {
	const { picks, loaded } = useReactive(
		editor,
		(each) => ({ picks: each.picks, loaded: each.loaded }),
		["changed"],
	);
	useEffect(() => void editor.load(), [editor]);
	return (
		<Dialog>
			<DialogTrigger
				render={
					<button
						type="button"
						className="flex min-h-11 w-full items-center gap-2 rounded-lg border bg-card px-3 text-left text-sm hover:bg-accent/50"
					/>
				}
			>
				<SettingsIcon aria-hidden className="size-4 text-muted-foreground" />
				<span className="shrink-0 whitespace-nowrap">Eval agents</span>
				{loaded && (
					<span className="truncate text-muted-foreground text-xs">
						{picks.length === 0
							? "none saved"
							: `${picks.length} saved · ${picks.map((each) => each.agent).join(", ")}`}
					</span>
				)}
				<ChevronRightIcon
					aria-hidden
					className="ml-auto size-3.5 shrink-0 text-muted-foreground"
				/>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogTitle>Saved eval agents</DialogTitle>
				<EvalAgentsView editor={editor} />
			</DialogContent>
		</Dialog>
	);
}

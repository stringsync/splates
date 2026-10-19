import { type JSX, useState } from "react";
import { AutoPickMark } from "./auto-pick-page";
import { RulesEditor } from "./auto-pick-rules";
import { RulesEditorView } from "./auto-pick-rules-editor";

/**
 * Auto pick on the Automations page, where its routing rules are edited:
 * the rules a pick follows, one of which the log's "Edit rule" opens marked.
 */
export function AutoPickRules({ mark }: { mark: number | null }): JSX.Element {
	const [editor] = useState(() => new RulesEditor());
	return (
		<section aria-label="Auto pick" className="flex min-w-0 flex-col gap-3">
			<div className="flex items-center gap-3">
				<AutoPickMark className="size-8" />
				<div className="flex min-w-0 flex-col">
					<h2 className="font-medium text-sm">Auto pick</h2>
					<p className="text-muted-foreground text-xs">
						On a task started with no agent named, the first rule that matches
						what the judge took it for picks the agent. Its log is under the
						groomer in the sidebar.
					</p>
				</div>
			</div>
			<RulesEditorView editor={editor} mark={mark} />
		</section>
	);
}

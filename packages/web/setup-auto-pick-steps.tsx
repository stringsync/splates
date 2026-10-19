import type { TaskRecord } from "@stringsync/splates-server/board";
import { createContext, type JSX, useContext, useState } from "react";
import type { RulesEditor } from "./auto-pick-rules";
import { RulesEditorView } from "./auto-pick-rules-editor";
import { TrialRun } from "./auto-pick-trial";
import { TrialView } from "./auto-pick-trial-view";
import { Markdown } from "./markdown";
import type { BrowserSteps } from "./setup-journey";
import type { StepBodies } from "./setup-steps";

/** The rules editor the Auto pick journey keeps across its pages, for the rules step's body. */
export const RulesEditorContext = createContext<RulesEditor | null>(null);

/** Auto pick's pages a walk through the journey stops on even when done: the editor, and the try. */
export const AUTO_PICK_STOPS = ["auto-pick-rules", "auto-pick-try"];

/** What the rules step does in this browser: saves what the editor holds, when it changed. */
export function autoPickBrowserSteps(editor: RulesEditor): BrowserSteps {
	return { "auto-pick-rules": () => editor.saveIfDirty() };
}

/** The rules editor's page, and the page that tries the rules on a task. */
export const AUTO_PICK_STEPS: StepBodies = {
	"auto-pick-rules": ({ step }) => <RulesStep user={step.user} />,
	"auto-pick-try": ({ todos }) => <TryStep todos={todos} />,
};

function RulesStep({ user }: { user: string }): JSX.Element {
	const editor = useContext(RulesEditorContext);
	return (
		<>
			<p className="text-muted-foreground text-sm">
				<Markdown text={user} inline />
			</p>
			{editor !== null && <RulesEditorView editor={editor} />}
		</>
	);
}

function TryStep({ todos }: { todos: readonly TaskRecord[] }): JSX.Element {
	const [run] = useState(() => new TrialRun());
	return <TrialView run={run} todos={todos} />;
}

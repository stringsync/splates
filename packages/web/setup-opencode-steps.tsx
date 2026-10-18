import type { ConversationState } from "@stringsync/splates-server/conversations";
import { Loader2Icon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { send } from "./api";
import { SetupContext } from "./setup-state";
import type { JourneyEndProps, StepBodies } from "./setup-steps";

/** None: each OpenCode page is drawn from its step's fields alone. */
export const OPENCODE_STEPS: StepBodies = {};

/**
 * OpenCode's done page: start a conversation on the saved main model, which
 * checks the models again in this project first, or quietly take OpenCode
 * off the roster.
 */
export function OpenCodeEnd({
	feed,
	onOpen,
	onLeave,
}: JourneyEndProps): JSX.Element {
	const { refresh } = useContext(SetupContext);
	const [busy, setBusy] = useState<"start" | "off" | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const run = async (which: "start" | "off"): Promise<void> => {
		setBusy(which);
		setProblem(null);
		try {
			if (which === "start") {
				const state = (await send("/api/setup/opencode/conversation", {
					method: "POST",
				})) as ConversationState;
				feed?.put(state);
				onOpen(state.id);
			} else {
				await send("/api/setup/opencode/disable", { method: "POST" });
				refresh();
				onLeave();
			}
		} catch (error) {
			setProblem(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};
	return (
		<>
			{feed !== null && (
				<Button disabled={busy !== null} onClick={() => void run("start")}>
					{busy === "start" && <Loader2Icon className="animate-spin" />}
					Start an OpenCode conversation
				</Button>
			)}
			<Button
				variant="link"
				className="h-auto p-0 text-muted-foreground"
				disabled={busy !== null}
				onClick={() => void run("off")}
			>
				Turn OpenCode off
			</Button>
			{problem !== null && (
				<p role="alert" className="basis-full text-destructive text-sm">
					{problem}
				</p>
			)}
		</>
	);
}

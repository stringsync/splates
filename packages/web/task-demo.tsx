import { PlayIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { DialogClose } from "#web/components/ui/dialog.tsx";
import { Dispatching } from "./dispatching";

/**
 * Demo: starts a conversation whose agent demos `task` with its change in
 * and opens it, closing the dialog. None while the page holds no
 * conversations.
 */
export function DemoButton({ task }: { task: string }): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	return (
		<DialogClose
			render={
				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						void context.dispatch.demo(task, "after").then(context.open);
					}}
				/>
			}
		>
			<PlayIcon />
			Demo
		</DialogClose>
	);
}

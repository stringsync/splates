import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import type { Terminals } from "./terminals";

/**
 * Closes a terminal from its X, hanging up on its shell, or asks first in
 * `confirm` while the shell runs a job in front, like a dev server, which
 * closing stops; a shell at its prompt goes at once. `leave` runs just before
 * it goes, to take down whatever shows it, so that does not start another;
 * render `confirm` beside whatever calls `close`.
 */
export function useCloseTerminal(terminals: Terminals): {
	close: (key: string, leave?: () => void) => void;
	confirm: JSX.Element;
} {
	const [asking, setAsking] = useState<{
		key: string;
		command: string;
		leave?: () => void;
	} | null>(null);
	const go = (key: string, leave?: () => void) => {
		leave?.();
		terminals.close(key);
	};
	const close = (key: string, leave?: () => void) =>
		void terminals.front(key).then((command) => {
			if (command === null) {
				go(key, leave);
			} else {
				setAsking({ key, command, leave });
			}
		});
	const confirm = (
		<Dialog
			open={asking !== null}
			onOpenChange={(open) => {
				if (!open) {
					setAsking(null);
				}
			}}
		>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>
						Close {asking === null ? "" : terminals.nameOf(asking.key)}?
					</DialogTitle>
					<DialogDescription>
						It is still running{" "}
						<code className="font-mono">{asking?.command}</code>. Closing stops
						it.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						variant="destructive"
						onClick={() => {
							if (asking !== null) {
								go(asking.key, asking.leave);
							}
							setAsking(null);
						}}
					>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
	return { close, confirm };
}

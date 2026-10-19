import type { Needing } from "@stringsync/splates-server/plans/browser";
import { useReactive } from "@webappwiz/react";
import { type ReactNode, useContext } from "react";
import { useCloseTerminal } from "./close-terminal";
import { terminalAddress } from "./conversation-address";
import { CommandRow, TerminalRow } from "./list-rows";
import { NestedPanesContext } from "./side-panes";
import { OpenTerminalPage } from "./terminal";
import type { Terminals } from "./terminals";

/**
 * What the sidebar nests under a conversation's row, muted as a subagent
 * is: its terminal while its shell is up, and each command its agent left
 * running, each opening in the pane beside the page. With them, the main
 * tree's own terminals, and the close that asks first while one runs a job.
 */
export function useBeneath(
	terminals: Terminals,
	/** The conversation shown, by its address, or null. */
	open: string | null,
	onOpen: (id: string | null) => void,
): {
	mains: string[];
	beneath: (row: Needing) => ReactNode[];
	closing: ReturnType<typeof useCloseTerminal>;
} {
	const { mains, up } = useReactive(
		terminals,
		(terminals) => ({
			mains: terminals.mains,
			up: terminals.up().join(" "),
			// Unread, but a rename shows at once.
			names: terminals.names,
		}),
		["changed"],
	);
	const panes = useContext(NestedPanesContext);
	const openPage = useContext(OpenTerminalPage);
	const shells = new Set(up.split(" "));
	const closing = useCloseTerminal(terminals);
	const beneath = ({ conversation }: Needing): ReactNode[] => {
		if (conversation === null || panes === null) {
			return [];
		}
		const { id } = conversation;
		const { showing } = panes;
		const shown = open === id ? showing : null;
		return [
			shells.has(id) && (
				<li key="terminal">
					<TerminalRow
						name={terminals.nameOf(id)}
						nested
						current={shown?.kind === "terminal" || open === terminalAddress(id)}
						onOpen={() => (openPage === null ? onOpen(id) : openPage(id))}
						onClose={() =>
							closing.close(id, () => {
								// Its pane or page, left up, would start another shell.
								if (open === terminalAddress(id)) {
									onOpen(id);
								}
								if (open === id || open === terminalAddress(id)) {
									terminals.hide();
								}
							})
						}
						onRename={(name) => terminals.rename(id, name)}
					/>
				</li>
			),
			...conversation.background
				.filter((each) => each.state === "running")
				.map((each) => (
					<li key={`background ${each.id}`}>
						<CommandRow
							background={each}
							current={
								shown?.kind === "background" && shown.background === each.id
							}
							onOpen={() => {
								onOpen(id);
								panes.watch(id, each.id);
							}}
						/>
					</li>
				)),
		].filter(Boolean);
	};
	return { mains, beneath, closing };
}

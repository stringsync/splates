import { useReactive } from "@webappwiz/react";
import { SquareTerminalIcon, TerminalIcon, XIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import type { Needing } from "../needs";
import { useCloseTerminal } from "./close-terminal";
import { NestedPanesContext } from "./side-panes";
import { OpenTerminalPage } from "./terminal";
import type { Terminals } from "./terminals";
import { BarButton } from "./top-bar";

/**
 * The inbox's shells: the main tree's own terminals, and what sits under a
 * conversation's row, as in the sidebar: its terminal while its shell is up
 * and each command its agent left running, each opening the conversation with
 * it on the screen.
 */
export function useShells(
	terminals: Terminals,
	onOpen: (id: string) => void,
): {
	/** The main tree's own terminals' keys, oldest first. */
	mains: string[];
	/** The rows under `row`'s, at `depth`. */
	beneath: (row: Needing, depth: number) => ReactNode[];
	/** Hangs up on terminal `key`, asking first while it runs a job. */
	close: (key: string) => void;
	/** The ask, to render in the inbox. */
	confirm: JSX.Element;
} {
	const { mains, up } = useReactive(
		terminals,
		(terminals) => ({
			mains: terminals.mains,
			up: terminals.up().join(" "),
			names: terminals.names,
		}),
		["changed"],
	);
	const panes = useContext(NestedPanesContext);
	const openPage = useContext(OpenTerminalPage);
	const shells = new Set(up.split(" "));
	const closing = useCloseTerminal(terminals);
	const beneath = ({ conversation }: Needing, depth: number): ReactNode[] => {
		if (conversation === null || panes === null) {
			return [];
		}
		const { id } = conversation;
		const name = terminals.nameOf(id);
		return [
			shells.has(id) && (
				<li key="terminal" className="flex items-center pr-2">
					<NestedRow
						icon={<SquareTerminalIcon />}
						name={name}
						text="Shell up"
						depth={depth}
						onOpen={() => {
							if (openPage === null) {
								onOpen(id);
								panes.showTerminal(id);
							} else {
								openPage(id);
							}
						}}
					/>
					<BarButton label={`Close ${name}`} onClick={() => closing.close(id)}>
						<XIcon />
					</BarButton>
				</li>
			),
			...conversation.background
				.filter((each) => each.state === "running")
				.map((each) => (
					<li key={`background ${each.id}`} className="flex items-center pr-4">
						<NestedRow
							icon={<TerminalIcon />}
							name={each.name}
							text={each.command ?? "Running"}
							depth={depth}
							onOpen={() => {
								onOpen(id);
								panes.watch(id, each.id);
							}}
						/>
						<span
							role="img"
							aria-label="running"
							className="size-2 shrink-0 animate-pulse rounded-full bg-success"
						/>
					</li>
				)),
		].filter(Boolean);
	};
	return {
		mains,
		beneath,
		close: (key) => closing.close(key),
		confirm: closing.confirm,
	};
}

/**
 * A conversation's terminal or a command its agent left running, indented
 * under it as a subagent is, muted as one is.
 */
function NestedRow({
	icon,
	name,
	text,
	depth,
	onOpen,
}: {
	icon: ReactNode;
	name: string;
	/** What it says under its name. */
	text: string;
	depth: number;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 text-left active:bg-muted"
			style={{ paddingLeft: `${1 + 3.25 * depth}rem` }}
		>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-4 [&_svg]:text-foreground/80">
				{icon}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-medium text-[15px] text-muted-foreground italic">
					{name}
				</span>
				<span className="truncate text-muted-foreground text-sm">{text}</span>
			</span>
		</button>
	);
}

/**
 * The main tree's terminals, opened from the new conversation's picker, each
 * a row to go back to it, with an X that hangs up its shell; nothing when
 * none is open.
 */
export function TerminalGroup({
	mains,
	nameOf,
	onOpen,
	onClose,
}: {
	/** Their keys, `terminal/<n>`, oldest first. */
	mains: string[];
	nameOf: (key: string) => string;
	onOpen: (key: string) => void;
	onClose: (key: string) => void;
}): ReactNode {
	if (mains.length === 0) {
		return null;
	}
	return (
		<section aria-label="Terminals" className="pt-4">
			<h2 className="px-4 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Terminals · {mains.length}
			</h2>
			<ul>
				{mains.map((key) => {
					const name = nameOf(key);
					return (
						<li key={key} className="flex items-center pr-2">
							<button
								type="button"
								onClick={() => onOpen(key)}
								className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left active:bg-muted"
							>
								<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
									<SquareTerminalIcon className="size-5 text-foreground/80" />
								</span>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="truncate font-medium text-[15px]">
										{name}
									</span>
									<span className="truncate text-muted-foreground text-sm">
										Main tree
									</span>
								</span>
							</button>
							<BarButton label={`Close ${name}`} onClick={() => onClose(key)}>
								<XIcon />
							</BarButton>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

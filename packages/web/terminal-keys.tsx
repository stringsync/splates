import { useReactive } from "@webappwiz/react";
import {
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CornerDownLeftIcon,
} from "lucide-react";
import type { JSX, PointerEvent, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import type { TerminalKey, TerminalSession } from "./terminal-session";

/** The keys of `KeyBar`, in order: a name to read it by, and what it shows. */
const KEYS: { key: TerminalKey; label: string; face: ReactNode }[] = [
	{ key: "escape", label: "Escape", face: "Esc" },
	{ key: "tab", label: "Tab", face: "Tab" },
	{ key: "ctrl-c", label: "Control C", face: "^C" },
	{ key: "ctrl-d", label: "Control D", face: "^D" },
	{ key: "left", label: "Left", face: <ArrowLeftIcon /> },
	{ key: "up", label: "Up", face: <ArrowUpIcon /> },
	{ key: "down", label: "Down", face: <ArrowDownIcon /> },
	{ key: "right", label: "Right", face: <ArrowRightIcon /> },
	{ key: "enter", label: "Enter", face: <CornerDownLeftIcon /> },
];

/**
 * A row of the keys a phone's keyboard lacks, to put under `session`'s
 * terminal: Ctrl, held for the next letter typed, then Escape, Tab, ^C, ^D,
 * the arrows and Enter.
 */
export function KeyBar({ session }: { session: TerminalSession }): JSX.Element {
	const { control } = useReactive(
		session,
		(session) => ({ control: session.control }),
		["changed"],
	);
	// A tap leaves the shell its focus, so the keyboard stays up.
	const keep = (event: PointerEvent) => event.preventDefault();
	return (
		<div
			role="toolbar"
			aria-label="terminal keys"
			className="flex shrink-0 gap-1 overflow-x-auto"
		>
			<Button
				size="sm"
				variant={control ? "default" : "outline"}
				aria-pressed={control}
				aria-label="Control"
				onPointerDown={keep}
				onClick={() => session.setControl(!control)}
			>
				Ctrl
			</Button>
			{KEYS.map(({ key, label, face }) => (
				<Button
					key={key}
					size="sm"
					variant="outline"
					aria-label={label}
					onPointerDown={keep}
					onClick={() => session.press(key)}
				>
					{face}
				</Button>
			))}
		</div>
	);
}

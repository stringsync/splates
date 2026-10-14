import { EllipsisVerticalIcon, PowerIcon, SettingsIcon } from "lucide-react";
import type { JSX } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { useShortcutLabel } from "#dev/hooks/use-shortcut.ts";
import { CheckpointItem, useCheckpoint } from "./checkpoint";
import { FullscreenItem } from "./fullscreen";
import { type Update, UpdateDot, update } from "./release";

/**
 * The menu beside the project's name, holding what the page can do as a
 * whole: Checkpoint, where the agents of `arbor dev` run; Fullscreen;
 * Settings; and last, apart, Restart, opening the Checkpoint dialog to
 * checkpoint, restart and resume whenever the person likes. Dotted, and its
 * Restart too, once a restart would update.
 */
export function PageMenu({
	release,
	behind,
	conversations,
	onSettings,
}: Update & {
	/** Whether `arbor dev` runs agents, which Checkpoint is for. */
	conversations: boolean;
	onSettings: () => void;
}): JSX.Element {
	const { open } = useCheckpoint();
	const why = update(release, behind);
	const settingsKey = useShortcutLabel("shortcuts.settings");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={why === null ? "More" : "More: restart to update"}
				className="-mr-1.5 ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<span className="relative flex">
					<EllipsisVerticalIcon className="size-4" />
					{why !== null && <UpdateDot />}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				{conversations && <CheckpointItem />}
				<FullscreenItem />
				<DropdownMenuItem onClick={onSettings}>
					<SettingsIcon />
					Settings
					{settingsKey !== null && (
						<DropdownMenuShortcut aria-hidden>
							{settingsKey}
						</DropdownMenuShortcut>
					)}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					// Not a bare Restart, which the terminal's button for its shell is.
					aria-label={why === null ? "Restart arbor dev" : "Restart to update"}
					title={why ?? undefined}
					onClick={() => open("resume")}
				>
					<span className="relative flex">
						<PowerIcon />
						{why !== null && <UpdateDot ring="ring-popover" />}
					</span>
					{why === null ? "Restart" : "Restart to update"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

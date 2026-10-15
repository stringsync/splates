import {
	EllipsisVerticalIcon,
	LogOutIcon,
	RefreshCwIcon,
	SettingsIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { useShortcutLabel } from "#dev/hooks/use-shortcut.ts";
import type { MachineReading } from "../machine";
import { identity } from "./api";
import { CheckpointItem } from "./checkpoint";
import { FullscreenItem } from "./fullscreen";
import { MachineStats } from "./machine";
import { type Update, UpdateDot, update } from "./release";

/**
 * The menu beside the project's name, holding what the page can do as a
 * whole, under who Cloudflare Access signed in, if anyone, and Sign out, and
 * how hard the machine is working: Power, to checkpoint, restart, shut down
 * or any of them together; Fullscreen; Reload, for an app on a home screen,
 * which has no browser's reload button; and Settings. Dotted, and its Power
 * too, once a restart would update.
 */
export function PageMenu({
	machine,
	release,
	behind,
	onSettings,
}: Update & {
	/** How hard the machine is working, or null before it has said. */
	machine: MachineReading | null;
	onSettings: () => void;
}): JSX.Element {
	const why = update(release, behind);
	const settingsKey = useShortcutLabel("shortcuts.settings");
	// Asked once here rather than as the menu opens, so it never pops in.
	const email = useSignedIn();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={why === null ? "More" : "More: restart to update"}
				// A finger's worth on a touch screen, overhanging the row rather
				// than growing it, with the icon still flush with the edge.
				className="-mr-1.5 pointer-coarse:-mr-2.5 pointer-coarse:-my-1.5 ml-auto flex size-7 pointer-coarse:size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<span className="relative flex">
					<EllipsisVerticalIcon className="size-4 pointer-coarse:size-5" />
					{why !== null && <UpdateDot />}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				{email !== null && (
					<>
						<DropdownMenuGroup>
							<DropdownMenuLabel
								title={`Signed in as ${email}`}
								className="break-all font-normal"
							>
								{email}
							</DropdownMenuLabel>
							<DropdownMenuItem onClick={() => location.assign(SIGN_OUT)}>
								<LogOutIcon />
								Sign out
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
					</>
				)}
				{machine !== null && (
					<>
						<MachineStats reading={machine} className="px-1.5 py-1" />
						<DropdownMenuSeparator />
					</>
				)}
				<CheckpointItem update={why} />
				<FullscreenItem />
				<DropdownMenuItem onClick={() => location.reload()}>
					<RefreshCwIcon />
					Reload page
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onSettings}>
					<SettingsIcon />
					Settings
					{settingsKey !== null && (
						<DropdownMenuShortcut aria-hidden>
							{settingsKey}
						</DropdownMenuShortcut>
					)}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Cloudflare Access's own sign-out, which ends the session on any host it guards. */
const SIGN_OUT = "/cdn-cgi/access/logout";

/**
 * Who Cloudflare Access signed in, when the page came through it; null on
 * this machine, where no one signs in.
 */
function useSignedIn(): string | null {
	const [email, setEmail] = useState<string | null>(null);
	useEffect(() => {
		identity().then(setEmail, () => {});
	}, []);
	return email;
}

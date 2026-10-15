import { LogOutIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "#dev/components/ui/dropdown-menu.tsx";
import { useShortcutLabel } from "#dev/hooks/use-shortcut.ts";
import type { MachineReading } from "../machine";
import type { Snapshot } from "../snapshot";
import { identity } from "./api";
import { CheckpointItem } from "./checkpoint";
import { FullscreenItem } from "./fullscreen";
import { MachineStats, useMachine } from "./machine";
import { type Update, update } from "./release";

/**
 * What the page can do as a whole, at the foot of every bar's kebab: who
 * Cloudflare Access signed in, if anyone, and Sign out, and how hard the
 * machine is working; Power, to checkpoint, restart, shut down or any of
 * them together; Fullscreen; Reload, for an app on a home screen, which has
 * no browser's reload button; and Settings. `dot` marks the kebab, and its
 * Power too, once a restart would update. The machine's reading, asked once
 * here, is for the server's badges too.
 */
export function usePageMenu({
	snapshot,
	outdated,
	offline,
	onSettings,
}: {
	snapshot: Snapshot | null;
	/** Why a newer arbor has the server refusing, or null. */
	outdated: string | null;
	offline: boolean;
	onSettings: () => void;
}): PageMenu {
	const machine = useMachine();
	const email = useSignedIn();
	const dot =
		(snapshot?.release != null || snapshot?.behind != null) &&
		outdated === null &&
		!offline;
	return {
		machine,
		dot,
		items: (
			<PageMenuItems
				email={email}
				machine={offline ? null : machine}
				release={dot ? (snapshot?.release ?? null) : null}
				behind={dot ? (snapshot?.behind ?? null) : null}
				onSettings={onSettings}
			/>
		),
	};
}

/** The page menu, as `usePageMenu` makes it. */
export interface PageMenu {
	/** How hard the machine is working, or null before it has said. */
	machine: MachineReading | null;
	items: ReactNode;
	/** Whether a restart would update arbor. */
	dot: boolean;
}

/** The page menu's items. */
function PageMenuItems({
	email,
	machine,
	release,
	behind,
	onSettings,
}: Update & {
	/** Who Cloudflare Access signed in, from `useSignedIn`. */
	email: string | null;
	machine: MachineReading | null;
	onSettings: () => void;
}): JSX.Element {
	const why = update(release, behind);
	const settingsKey = useShortcutLabel("shortcuts.settings");
	return (
		<>
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
					<DropdownMenuShortcut aria-hidden>{settingsKey}</DropdownMenuShortcut>
				)}
			</DropdownMenuItem>
		</>
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

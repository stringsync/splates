import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { Snapshot } from "@splates/server/tasks";
import { InboxIcon, SettingsIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { NavMenuItem } from "./nav-menu-item";
import { NavCountBadge, NavIcon, useNavStatuses } from "./nav-status";
import type { Move } from "./page-address";
import { navPage, PAGES, type Page } from "./page-route";

/**
 * The phone's menu of every page, project, and Settings: render it with `open`
 * and `onOpenChange` to slide it in from the left, `onGo` to go where it is
 * tapped, and `onSettings` to open Settings.
 */
export function Drawer({
	open,
	onOpenChange,
	header,
	page,
	conversation,
	waiting,
	snapshot,
	onGo,
	onSettings,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The server's header: its name and its status. */
	header: ReactNode;
	page: Page;
	/** The conversation open, by its address, or null. */
	conversation: string | null;
	/** The agents waiting on you. */
	waiting: number;
	snapshot: Snapshot | null;
	/** Goes to `page`, with `conversation` open there, as `how` leaves history. */
	onGo: (page: Page, conversation: string | null, how: Move) => void;
	onSettings: () => void;
}): JSX.Element {
	// The server's header up top, the inbox first, the project's pages,
	// Everywhere's, and Settings in the footer. The pages
	// it opens take each other's place in history above the inbox, even while
	// it loads, so back from any goes home, as Android's top-level ones do.

	const home = (page: Page, conversation: string | null) =>
		page === "conversations" && conversation === null;
	const go = (to: Page, open: string | null = null) => {
		// Home is pushed, so the move back to it goes back instead.
		onGo(
			to,
			open,
			home(page, conversation) || home(to, open) ? "push" : "replace",
		);
		onOpenChange(false);
	};
	const statuses = useNavStatuses(snapshot);
	const entry = ({ value, label, Icon }: (typeof PAGES)[number]) => {
		const status = statuses[value];
		return (
			<NavMenuItem
				key={value}
				size="lg"
				current={navPage(page) === value}
				onClick={() => go(value)}
				icon={<NavIcon icon={Icon} status={status?.icon} size="lg" />}
				label={label}
				badge={
					status?.badge === undefined ? undefined : (
						<NavCountBadge
							count={status.badge.count}
							tone={status.badge.tone}
							label={status.badge.label}
							size="lg"
						/>
					)
				}
			/>
		);
	};
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-xl outline-none transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
					<DialogPrimitive.Title className="sr-only">
						Pages
					</DialogPrimitive.Title>
					{header}
					<nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-2">
						<NavMenuItem
							size="lg"
							current={page === "conversations" && conversation === null}
							onClick={() => go("conversations")}
							icon={<InboxIcon />}
							label="Inbox"
							badge={
								waiting > 0 ? (
									<NavCountBadge count={waiting} tone="warning" size="lg" />
								) : undefined
							}
						/>
						<div className="px-3 pt-3 pb-1 font-medium text-muted-foreground text-xs">
							Workspace
						</div>
						{PAGES.filter(({ scope }) => scope === "project").map(entry)}
						{PAGES.filter(({ scope }) => scope === "everywhere").map(entry)}
					</nav>
					<div className="mt-auto shrink-0 border-t p-2">
						<NavMenuItem
							size="lg"
							onClick={() => {
								onOpenChange(false);
								onSettings();
							}}
							icon={<SettingsIcon aria-hidden />}
							label="Settings"
						/>
					</div>
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

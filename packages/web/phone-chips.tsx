import { InboxIcon, KanbanIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import type { Move } from "./page-address";
import { navPage, PAGES, type Page } from "./page-route";

const CHIPPED: Page[] = ["conversations", "todos", "tasks"];

/**
 * Chips that jump between the inbox, the board and the queue in one tap, and
 * show the page you are on if it is another. Pass `onGo` to open a page.
 */
export function PageChips({
	page,
	onGo,
}: {
	/** The page shown; the inbox is `conversations`. */
	page: Page;
	onGo: (page: Page, conversation: null, how: Move) => void;
}): JSX.Element {
	const at = navPage(page);
	const shown = [
		{ value: "conversations" as Page, label: "Inbox", Icon: InboxIcon },
		{ value: "todos" as Page, label: "Board", Icon: KanbanIcon },
		...PAGES.filter(({ value }) => value === "tasks"),
		// Another page, opened from the drawer, shows as the page you are on.
		...PAGES.filter(({ value }) => value === at && !CHIPPED.includes(value)),
	];
	return (
		<nav
			aria-label="pages"
			className="flex gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none]"
		>
			{shown.map(({ value, label, Icon }) => {
				const current = value === at;
				return (
					<button
						key={value}
						type="button"
						aria-label={label}
						title={label}
						aria-current={current ? "page" : undefined}
						onClick={() => {
							if (!current) {
								onGo(
									value,
									null,
									at === "conversations" || value === "conversations"
										? "push"
										: "replace",
								);
							}
						}}
						className={cn(
							"flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs [&_svg]:size-3.5 [&_svg]:text-muted-foreground active:bg-muted",
							current &&
								"border-transparent bg-accent font-medium [&_svg]:text-primary",
						)}
					>
						<Icon />
						{label}
					</button>
				);
			})}
		</nav>
	);
}

import { InboxIcon, KanbanIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { useNavPages } from "./evals-available";
import type { Move } from "./page-address";
import { navPage, type Page } from "./page-route";

const CHIPPED: Page[] = ["conversations", "todos"];

/**
 * The row under a phone's inbox and page bars that moves between the inbox
 * and the board in one tap, and the page you are on if another; the rest are in the drawer. As the
 * drawer's do, they take each other's place in history above the inbox, so
 * back from either goes home.
 */
export function PageChips({
	page,
	onGo,
}: {
	/** The page shown; the inbox is `conversations`. */
	page: Page;
	onGo: (page: Page, conversation: null, how: Move) => void;
}): JSX.Element {
	const pages = useNavPages();
	const at = navPage(page);
	const shown = [
		{ value: "conversations" as Page, label: "Inbox", Icon: InboxIcon },
		{ value: "todos" as Page, label: "Board", Icon: KanbanIcon },
		// Another page, opened from the drawer, shows as the page you are on.
		...pages.filter(({ value }) => value === at && !CHIPPED.includes(value)),
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

import {
	CopyIcon,
	EllipsisIcon,
	ExternalLinkIcon,
	PackageIcon,
	XIcon,
} from "lucide-react";
import { type JSX, use } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { OpenerContext } from "./openers";
import type { ProjectChoice } from "./project-api";

/**
 * A project's menu in the project switcher: opens it in the editor Settings
 * names, copies its path, opens the plan to ship it, or forgets it.
 */
export function ProjectMenu({
	project,
	current,
	hidden,
	onCopyPath,
	onShip,
	onForget,
	pending = false,
}: {
	project: ProjectChoice;
	/** Whether the page shows it, so forgetting it goes back to the one before. */
	current: boolean;
	/** Whether its button hides until its row is hovered or picked. */
	hidden: boolean;
	onCopyPath: () => void;
	onShip: () => void;
	onForget: () => void;
	/** Forgetting it is on its way: held until the server answers. */
	pending?: boolean;
}): JSX.Element {
	const opener = use(OpenerContext);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`More for ${project.slug}`}
						title="More"
						className={cn(
							hidden &&
								"opacity-0 focus-visible:opacity-100 group-hover/project:opacity-100 data-popup-open:opacity-100",
						)}
					/>
				}
			>
				<EllipsisIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48">
				{!project.gone && (
					<DropdownMenuItem
						render={<a href={opener.url(project.root, null)} />}
					>
						<ExternalLinkIcon />
						Open in {opener.label}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={onCopyPath}>
					<CopyIcon />
					Copy path
				</DropdownMenuItem>
				{project.ships && (
					<DropdownMenuItem
						title="Shows what the ship would publish, downstream too, before anything runs"
						onClick={onShip}
					>
						<PackageIcon />
						Ship {project.slug}…
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					title={
						project.gone
							? "Its repository is gone"
							: current
								? "Going back to the project before it: adding it again brings it back"
								: "Adding it again brings it back"
					}
					disabled={pending}
					onClick={onForget}
				>
					<XIcon />
					Remove project {project.slug}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

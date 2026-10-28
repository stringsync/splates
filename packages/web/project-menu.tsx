import {
	PROJECT_COLORS,
	type ProjectColor,
} from "@stringsync/splates-server/projects/browser";
import {
	CopyIcon,
	EllipsisIcon,
	ExternalLinkIcon,
	PackageIcon,
	PaletteIcon,
	XIcon,
} from "lucide-react";
import { type JSX, use } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { OpenerContext } from "./openers";
import type { ProjectChoice } from "./project-api";
import { ProjectBadge } from "./project-badge";

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
	colorPending = false,
	onColor,
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
	colorPending?: boolean;
	onColor: (color: ProjectColor | null) => void;
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
				<DropdownMenuGroup>
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
					<DropdownMenuSub>
						<DropdownMenuSubTrigger disabled={colorPending}>
							<PaletteIcon />
							Appearance
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={project.color ?? "automatic"}
								onValueChange={(value) =>
									onColor(
										value === "automatic" ? null : (value as ProjectColor),
									)
								}
							>
								<DropdownMenuRadioItem value="automatic">
									<ProjectBadge name={project.slug} small />
									Automatic
								</DropdownMenuRadioItem>
								{Object.keys(PROJECT_COLORS).map((color) => (
									<DropdownMenuRadioItem key={color} value={color}>
										<ProjectBadge
											name={project.slug}
											color={color as ProjectColor}
											small
										/>
										{color[0]?.toUpperCase()}
										{color.slice(1)}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
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
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

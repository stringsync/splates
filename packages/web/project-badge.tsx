import {
	PROJECT_COLORS,
	type ProjectColor,
	projectColor,
} from "@stringsync/splates-server/projects/browser";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** Show a project’s initial on its saved or automatic color; `small` fits compact headers. */
export function ProjectBadge({
	name,
	color,
	small = false,
}: {
	name: string;
	color?: ProjectColor;
	small?: boolean;
}): JSX.Element {
	const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
	return (
		<span
			aria-hidden="true"
			data-project-badge={name}
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded font-semibold leading-none",
				small ? "size-4 text-[10px]" : "size-7 text-xs",
			)}
			style={{
				backgroundColor: PROJECT_COLORS[projectColor(name, color)],
				color: "#fff",
			}}
		>
			{initial}
		</span>
	);
}

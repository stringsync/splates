import { GitBranchIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { ReferenceChip, TaskChip } from "./reference-chip";

/**
 * `task` as a chip, and `base` after it when it merges onto one, as a line
 * that wraps between the chips rather than inside its words.
 */
export function TaskOnto({
	task,
	base,
	merged = false,
	className,
}: {
	task: string;
	base: string | null;
	/** Whether it reads "Merged <task> onto <base>", for a merge's card body. */
	merged?: boolean;
	className?: string;
}): JSX.Element {
	return (
		<span
			className={cn(
				"flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs",
				className,
			)}
		>
			{merged && <span className="whitespace-nowrap">Merged</span>}
			<TaskChip task={task} inline />
			{base !== null && (
				// "onto" wraps with the base, never left trailing alone.
				<span className="flex items-center gap-1.5 whitespace-nowrap">
					onto
					<ReferenceChip
						Icon={GitBranchIcon}
						kind=""
						name={base}
						title={base}
						inline
					/>
				</span>
			)}
		</span>
	);
}

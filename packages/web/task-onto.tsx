import { GitBranchIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { ReferenceChip, TaskChip } from "./reference-chip";

/** `task` as a chip, and `base` after it when it merges onto one. */
export function TaskOnto({
	task,
	base,
	verb = "",
	className,
}: {
	task: string;
	base: string | null;
	/** Said between the two, as "merged", before "onto". */
	verb?: string;
	className?: string;
}): JSX.Element {
	return (
		<span
			className={cn(
				"flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs",
				className,
			)}
		>
			<TaskChip task={task} inline />
			{base !== null && (
				<>
					<span>{verb === "" ? "onto" : `${verb} onto`}</span>
					<ReferenceChip
						Icon={GitBranchIcon}
						kind=""
						name={base}
						title={base}
						inline
					/>
				</>
			)}
		</span>
	);
}

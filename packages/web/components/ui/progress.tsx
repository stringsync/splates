import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "#web/lib/utils.ts";

function Progress({ className, ...props }: ProgressPrimitive.Root.Props) {
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn("w-full", className)}
			{...props}
		>
			<ProgressPrimitive.Track
				data-slot="progress-track"
				className="relative h-1 w-full overflow-hidden rounded-full bg-muted"
			>
				<ProgressPrimitive.Indicator
					data-slot="progress-indicator"
					className="h-full bg-primary transition-all"
				/>
			</ProgressPrimitive.Track>
		</ProgressPrimitive.Root>
	);
}

export { Progress };

import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** The release size as one row of buttons, always shown; dimmed until the project is ticked. */
export function ShipBumpPicker({
	slug,
	options,
	value,
	dimmed,
	disabled,
	onChange,
}: {
	slug: string;
	options: readonly string[];
	value: string;
	dimmed: boolean;
	disabled: boolean;
	onChange(bump: string): void;
}): JSX.Element {
	return (
		<fieldset
			aria-label={`${slug} version bump`}
			className={cn(
				"m-0 ml-11 inline-flex min-w-0 sm:ml-0 overflow-hidden rounded-lg border text-sm",
				dimmed && "opacity-40",
			)}
		>
			{options.map((option) => (
				<label
					key={option}
					className={cn(
						"cursor-pointer border-r px-3 py-1 last:border-r-0",
						option === value
							? "bg-primary text-primary-foreground"
							: "hover:bg-muted",
					)}
				>
					<input
						type="radio"
						className="sr-only"
						name={`${slug}-bump`}
						value={option}
						checked={option === value}
						disabled={disabled}
						onChange={() => onChange(option)}
					/>
					{option}
				</label>
			))}
		</fieldset>
	);
}

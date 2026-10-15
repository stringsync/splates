import { type JSX, useContext, useSyncExternalStore } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import { useMinute } from "./hooks/use-minute";
import { ShortcutSettings } from "./hooks/use-shortcut";
import { ago } from "./plan-limits";

/**
 * When a message was said, as how long ago (`4m ago`), moving each minute,
 * with the full date and time on hover.
 */
export function Stamp({
	at,
	className,
}: {
	/** An ISO timestamp. */
	at: string;
	className?: string;
}): JSX.Element {
	const now = useMinute();
	const when = new Date(at);
	const full = when.toLocaleString(undefined, {
		dateStyle: "full",
		timeStyle: "short",
	});
	return (
		<Tooltip>
			<TooltipTrigger
				render={<time dateTime={at} />}
				className={cn(
					"text-muted-foreground cursor-default text-xs tabular-nums outline-none focus-visible:underline",
					className,
				)}
			>
				{ago(when.getTime(), now)}
			</TooltipTrigger>
			<TooltipContent>{full}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Whether messages show their stamps, as the person last set it, and the
 * switch that turns them on and off.
 */
export function useStamps(): { shown: boolean; toggle: () => void } {
	const settings = useContext(ShortcutSettings);
	const shown = useSyncExternalStore(
		(changed) => settings?.events.on("changed", changed) ?? (() => {}),
		() => settings?.get("conversation.timestamps") ?? false,
	);
	return {
		shown,
		toggle: () => void settings?.set("conversation.timestamps", !shown),
	};
}

import { type LucideIcon, MoreHorizontalIcon } from "lucide-react";
import type { JSX, ReactNode, Ref } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { useInSheet } from "./phone-sheets";
import { Refusal } from "./refusal";

/** Semantic intent for a declarative `CardFooter` action. */
export type CardFooterActionTone =
	| "default"
	| "outline"
	| "success"
	| "destructive";

/** One declarative action rendered by `CardFooter`. */
export interface CardFooterAction {
	/** Visible label for the button or overflow menu item. */
	label: string;
	/** Optional leading icon rendered inside the button or menu item. */
	Icon?: LucideIcon;
	/** Visual intent: graphite default, outline, green success (Merge only), or subtle destructive. */
	tone?: CardFooterActionTone;
	/** Marks the primary CTA (expanded on the right in mobile sheets). Defaults to the last action. */
	primary?: boolean;
	disabled?: boolean;
	busy?: boolean;
	/** Optional accessible label override (e.g. for a copy-command button). */
	ariaLabel?: string;
	/** Optional tooltip title. */
	title?: string;
	onClick: () => void;
}

/** Props for `CardFooter`. */
export interface CardFooterProps {
	/** Leading note on desktop such as keyboard hints, reason text, or an inline confirmation prompt. */
	note?: ReactNode;
	/** Optional note shown above the button row inside mobile sheets (e.g. inline confirmation text). */
	sheetNote?: ReactNode;
	/** Optional refusal message shown below the action row. */
	refusal?: string | null;
	/** Actions rendered as compact desktop buttons or a pinned mobile sheet CTA bar. */
	actions: readonly CardFooterAction[];
	className?: string;
	ref?: Ref<HTMLElement>;
}

/**
 * Declarative action footer for conversation cards. Keeps a neutral surface
 * (`bg-muted/20` on desktop, `bg-background` pinned in mobile sheets) and
 * switches automatically between compact right-aligned `sm` buttons on desktop
 * and a pinned 44px mobile sheet bar (1 full-width primary CTA, 2 bordered
 * secondary + primary, or 3+ bordered `···` overflow menu + primary) based on
 * `useInSheet()`.
 */
export function CardFooter({
	note,
	sheetNote,
	refusal,
	actions,
	className,
	ref,
}: CardFooterProps): JSX.Element | null {
	const inSheet = useInSheet();
	if (
		actions.length === 0 &&
		note === undefined &&
		sheetNote === undefined &&
		!refusal
	) {
		return null;
	}
	const primary = actions.find((each) => each.primary) ?? actions.at(-1);
	if (inSheet) {
		const others =
			primary === undefined ? [] : actions.filter((each) => each !== primary);
		const secondary = others.length === 1 ? others[0] : undefined;
		return (
			<footer
				ref={ref}
				data-pinned
				className={cn(
					"sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t bg-background px-4 py-3",
					className,
				)}
			>
				{sheetNote !== undefined && (
					<div className="text-muted-foreground text-xs">{sheetNote}</div>
				)}
				{primary !== undefined && (
					<div className="flex items-center gap-3">
						{secondary !== undefined && (
							<Button
								type="button"
								variant="outline"
								aria-label={secondary.ariaLabel}
								title={secondary.title}
								disabled={secondary.disabled}
								aria-busy={secondary.busy || undefined}
								className="h-11 shrink-0 px-4 text-base"
								onClick={secondary.onClick}
							>
								{secondary.Icon !== undefined && (
									<secondary.Icon data-icon="inline-start" />
								)}
								{secondary.label}
							</Button>
						)}
						{others.length >= 2 && (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											type="button"
											variant="outline"
											aria-label="More actions"
											className="size-11 shrink-0 p-0"
										/>
									}
								>
									<MoreHorizontalIcon className="size-5" />
								</DropdownMenuTrigger>
								<DropdownMenuContent
									side="top"
									align="start"
									className="min-w-44"
								>
									{others.map((other) => (
										<DropdownMenuItem
											key={other.label}
											variant={
												other.tone === "destructive" ? "destructive" : "default"
											}
											aria-label={other.ariaLabel}
											disabled={other.disabled}
											onClick={other.onClick}
										>
											{other.Icon !== undefined && <other.Icon />}
											{other.label}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
						<Button
							type="button"
							variant={primaryVariant(primary)}
							aria-label={primary.ariaLabel}
							title={primary.title}
							disabled={primary.disabled}
							aria-busy={primary.busy || undefined}
							className={cn(
								"h-11 flex-1 text-base",
								primary.tone === "success" && SUCCESS_CTA,
							)}
							onClick={primary.onClick}
						>
							{primary.Icon !== undefined && (
								<primary.Icon data-icon="inline-start" />
							)}
							{primary.label}
						</Button>
					</div>
				)}
				<Refusal refusal={refusal} className="text-right" />
			</footer>
		);
	}
	return (
		<footer
			ref={ref}
			className={cn("flex flex-col gap-2 border-t px-4 py-2.5", className)}
		>
			<div className="flex flex-wrap items-center justify-end gap-2">
				{note !== undefined && (
					<span className="mr-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
						{note}
					</span>
				)}
				{actions.map((action) => (
					<Button
						key={action.label}
						type="button"
						size="sm"
						variant={desktopVariant(action, primary)}
						aria-label={action.ariaLabel}
						title={action.title}
						disabled={action.disabled}
						aria-busy={action.busy || undefined}
						className={cn(
							action === primary && action.tone === "success" && SUCCESS_CTA,
						)}
						onClick={action.onClick}
					>
						{action.Icon !== undefined && (
							<action.Icon data-icon="inline-start" />
						)}
						{action.label}
					</Button>
				))}
			</div>
			<Refusal refusal={refusal} className="text-right" />
		</footer>
	);
}

/** Merge CTA styling: green surface with white label and icon, matching `ReviewPanel`. */
const SUCCESS_CTA =
	"bg-success text-white hover:bg-success/90 active:bg-success/90 focus-visible:border-success focus-visible:ring-success/50";

function primaryVariant(
	action: CardFooterAction,
): "default" | "outline" | "destructive" {
	if (action.tone === "destructive") {
		return "destructive";
	}
	if (action.tone === "outline") {
		return "outline";
	}
	return "default";
}

function desktopVariant(
	action: CardFooterAction,
	primary: CardFooterAction | undefined,
): "default" | "outline" | "destructive" {
	if (action === primary) {
		return primaryVariant(action);
	}
	return "outline";
}

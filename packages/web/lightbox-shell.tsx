import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { type JSX, type ReactNode, useSyncExternalStore } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";

/** Below Tailwind's `sm`: a phone, where lightbox controls use 44–48px touch targets. */
export const NARROW = "(max-width: 639.98px)";

/** Whether the window is a phone's width, following it as it resizes. */
export function useNarrow(): boolean {
	return useSyncExternalStore(
		(changed) => {
			const query = matchMedia(NARROW);
			query.addEventListener("change", changed);
			return () => query.removeEventListener("change", changed);
		},
		() => matchMedia(NARROW).matches,
	);
}

/** Full-bleed dark backdrop shared by media viewing, markup, and HTML previews. */
export const LIGHTBOX_BACKDROP_CLASS =
	"fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0";

/** Full-screen dark viewer surface shared across all lightbox modes. */
export const LIGHTBOX_POPUP_CLASS =
	"fixed inset-x-0 top-0 z-50 flex h-dvh flex-col overflow-hidden bg-neutral-950 text-white outline-none sm:bg-neutral-950/92 duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

/** A ghost control sitting on the dark viewer chrome, in either theme. */
export const LIGHTBOX_ACTION =
	"text-white/90 hover:bg-white/15 hover:text-white";

/**
 * Prior-art 48px mobile touch target around a crisp 34px bordered square icon.
 * Pair with `className="size-8.5"` on the icon so buttonVariants leaves its size intact.
 */
export const LIGHTBOX_MOBILE_TOOL = cn(
	LIGHTBOX_ACTION,
	"size-12 border-0 bg-transparent p-0 hover:bg-transparent active:bg-transparent",
	"[&_svg]:box-border [&_svg]:rounded-[9px] [&_svg]:border [&_svg]:border-[#525457] [&_svg]:bg-[#282a2c] [&_svg]:p-[7px] hover:[&_svg]:bg-[#36393c] active:[&_svg]:bg-[#414345]",
);

/**
 * Unified top bar for every lightbox mode (images, recordings, markup, HTML
 * previews). On desktop, renders actions before Close and an optional centered
 * segmented control. On phones, keeps Close isolated at 48×48px in the
 * top-right (or hides it when a mode like markup provides its own Done pill).
 */
export function LightboxHeader({
	title,
	meta,
	center,
	actions,
	onClose,
	showClose = true,
}: {
	title: ReactNode;
	/** Optional badge or gallery counter beside the title. */
	meta?: ReactNode;
	/** Optional centered desktop controls (e.g. Fit width/all or markup tools). */
	center?: ReactNode;
	/** Right-aligned controls rendered immediately before Close. */
	actions?: ReactNode;
	/** Custom close handler; omits DialogPrimitive.Close when supplied. */
	onClose?: () => void;
	/** Whether to show the top-right Close button (default true). */
	showClose?: boolean;
}): JSX.Element {
	const narrow = useNarrow();
	const closeClass = narrow ? LIGHTBOX_MOBILE_TOOL : LIGHTBOX_ACTION;
	const closeIcon = <XIcon className={narrow ? "size-8.5" : undefined} />;
	return (
		<header
			className={cn(
				"relative z-10 flex shrink-0 items-center gap-2 border-white/10 border-b bg-neutral-950/95 pt-[env(safe-area-inset-top)]",
				narrow
					? cn("min-h-14 pl-3.5", showClose ? "pr-1.5" : "pr-3")
					: "min-h-12 px-3.5",
			)}
		>
			<div
				className={cn(
					"flex min-w-0 items-center gap-2",
					narrow ? "flex-1" : cn("pl-0.5", center ? "max-w-[34%]" : "flex-1"),
				)}
			>
				<span className="truncate font-medium text-sm text-white">{title}</span>
				{meta}
			</div>
			{!narrow && center && (
				<div className="pointer-events-none absolute inset-x-0 flex items-center justify-center">
					<div className="pointer-events-auto flex items-center">{center}</div>
				</div>
			)}
			<div className="ml-auto flex shrink-0 items-center gap-1">
				{actions}
				{showClose &&
					(onClose ? (
						<Button
							variant="ghost"
							size={narrow ? "icon" : "icon-sm"}
							aria-label="close"
							title="Close"
							onClick={onClose}
							className={closeClass}
						>
							{closeIcon}
						</Button>
					) : (
						<DialogPrimitive.Close
							render={
								<Button
									variant="ghost"
									size={narrow ? "icon" : "icon-sm"}
									aria-label="close"
									title="Close"
									className={closeClass}
								/>
							}
						>
							{closeIcon}
						</DialogPrimitive.Close>
					))}
			</div>
		</header>
	);
}

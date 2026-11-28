import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * Class list for a canonical navigation menu item shared by the desktop
 * sidebar (`default`, matching Settings sidebar typography) and mobile drawer
 * (`lg`, touch-sized).
 */
export function navMenuItemClass({
	size = "default",
	current = false,
	muted = false,
}: {
	size?: "default" | "lg";
	current?: boolean;
	muted?: boolean;
} = {}): string {
	return cn(
		"group/navrow flex w-full flex-none cursor-pointer items-center justify-start rounded-lg text-left font-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&>svg]:shrink-0 [&_[data-nav-icon]]:shrink-0",
		size === "lg"
			? "h-12 gap-3 px-3 text-base text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-accent dark:text-muted-foreground dark:hover:text-foreground [&>svg]:size-5 [&_[data-nav-icon]]:size-5"
			: "h-9 gap-2.5 px-2.5 py-2 text-muted-foreground text-sm hover:bg-muted/60 hover:text-foreground active:bg-foreground/[0.08] dark:text-muted-foreground dark:hover:text-foreground [&>svg]:size-4 [&_[data-nav-icon]]:size-4",
		muted && "text-muted-foreground",
		current &&
			"bg-accent font-medium text-foreground hover:bg-accent hover:text-foreground active:bg-accent dark:text-foreground",
		current &&
			size === "lg" &&
			"[&>svg]:text-primary [&_[data-nav-icon]]:text-primary",
	);
}

/**
 * Canonical navigation menu item with a leading icon, single truncated label,
 * and optional trailing badge or indicator.
 */
export function NavMenuItem({
	icon,
	label,
	badge,
	current = false,
	size = "default",
	muted = false,
	className,
	...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
	icon: ReactNode;
	label: string;
	badge?: ReactNode;
	current?: boolean;
	size?: "default" | "lg";
	muted?: boolean;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-current={current ? "page" : undefined}
			className={cn(navMenuItemClass({ size, current, muted }), className)}
			{...props}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{badge}
		</button>
	);
}

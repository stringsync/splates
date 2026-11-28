import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * The canonical page card surface: a crisp elevated container that steps off
 * `--background`. Pass `render` to render a semantic element such as `li`,
 * `article`, or `section`.
 */
function Card({
	className,
	render,
	...props
}: useRender.ComponentProps<"div">): JSX.Element {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs",
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "card",
		},
	});
}

const cardHeaderVariants = cva(
	"flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3",
	{
		variants: {
			variant: {
				default: "",
				muted: "bg-muted/50",
				warning: "bg-warning/[0.08]",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

/**
 * Optional ruled bar at the top of a card that carries its own sub-card
 * identity (for example a rig group, a credential request, or a role budget).
 * Page section titles belong outside the card in `PageSection`.
 */
function CardHeader({
	className,
	variant = "default",
	render,
	...props
}: useRender.ComponentProps<"div"> &
	VariantProps<typeof cardHeaderVariants>): JSX.Element {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(cardHeaderVariants({ variant }), className),
			},
			props,
		),
		render,
		state: {
			slot: "card-header",
			variant,
		},
	});
}

/** Standard padded body inside a `Card`. */
function CardContent({
	className,
	render,
	...props
}: useRender.ComponentProps<"div">): JSX.Element {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn("px-4 py-3", className),
			},
			props,
		),
		render,
		state: {
			slot: "card-content",
		},
	});
}

/**
 * Divided list inside a `Card`. Defaults to `ul`; pass `render={<ol />}` for
 * ordered items.
 */
function CardList({
	className,
	render,
	...props
}: useRender.ComponentProps<"ul">): JSX.Element {
	return useRender({
		defaultTagName: "ul",
		props: mergeProps<"ul">(
			{
				className: cn("divide-y", className),
			},
			props,
		),
		render,
		state: {
			slot: "card-list",
		},
	});
}

/** Optional ruled footer row at the bottom of a `Card`. */
function CardFooter({
	className,
	render,
	...props
}: useRender.ComponentProps<"div">): JSX.Element {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"flex flex-wrap items-center gap-2 border-t px-4 py-3",
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "card-footer",
		},
	});
}

export {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardList,
	cardHeaderVariants,
};

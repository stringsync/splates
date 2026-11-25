import {
	type JSX,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "#web/lib/utils.ts";
import type { PageArea } from "./page-areas";

/**
 * Renders the full-bleed atmospheric header band for a desktop page, aligning
 * the area icon, title, opaque pill, description, top-right controls, and
 * optional docked tabs inside one unified band.
 */
export function DesktopPageHeaderBand({
	area,
	title,
	badge,
	description,
	detail,
	status,
	tabs,
	controls,
	sidebarHidden = false,
	roomRef,
	titledRef,
	detailedRef,
	statedRef,
}: {
	area: PageArea;
	title: ReactNode;
	badge: ReactNode;
	description: ReactNode;
	detail?: ReactNode;
	status?: ReactNode;
	tabs?: ReactNode;
	controls: ReactNode;
	sidebarHidden?: boolean;
	roomRef: RefObject<HTMLDivElement | null>;
	titledRef: RefObject<HTMLDivElement | null>;
	detailedRef: RefObject<HTMLDivElement | null>;
	statedRef: RefObject<HTMLDivElement | null>;
}): JSX.Element {
	return (
		<>
			<div aria-hidden="true" className="page-header-glow" />
			<div aria-hidden="true" className="page-header-sheen" />
			<div className={cn("relative", sidebarHidden && "pl-(--top-bar-start)")}>
				<div
					className={cn(
						"w-full min-w-0",
						area.compact
							? "px-5 py-4"
							: cn("px-4 pt-[18px]", tabs ? "pb-0" : "pb-[18px]"),
					)}
				>
					<div
						ref={roomRef}
						className={cn(
							"relative flex min-w-0 justify-between gap-4",
							area.compact ? "items-center" : "items-start",
						)}
					>
						<div
							className={cn(
								"flex min-w-0 flex-1 gap-3.5",
								area.compact ? "items-center" : "items-start",
							)}
						>
							<div
								aria-hidden="true"
								className={cn(
									"page-header-icon flex shrink-0 items-center justify-center",
									area.compact
										? "size-[34px] rounded-[9px] [&_svg]:size-[17px]"
										: "size-10 rounded-[10px] [&_svg]:size-5",
								)}
							>
								<area.Icon />
							</div>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
									<div
										ref={titledRef}
										className="flex min-w-0 items-center gap-1.5"
									>
										{typeof title === "string" ? (
											<h2
												title={title}
												className={cn(
													"min-w-0 truncate font-semibold text-foreground leading-[1.2]",
													area.compact
														? "text-[15px] tracking-[-0.01em]"
														: "text-[21px] tracking-[-0.02em]",
												)}
											>
												{title}
											</h2>
										) : (
											title
										)}
									</div>
									{badge !== null && (
										<span
											className={cn(
												"page-header-pill inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 leading-tight",
												area.compact
													? "font-mono text-[10.5px]"
													: "font-medium text-[11px]",
											)}
										>
											{badge}
										</span>
									)}
									{Boolean(detail) && (
										<div
											ref={detailedRef}
											className="flex min-w-0 max-w-60 shrink-0 items-center text-muted-foreground"
										>
											{detail}
										</div>
									)}
									<div
										ref={statedRef}
										className="flex shrink-0 items-center gap-2 empty:hidden"
									>
										{status}
									</div>
								</div>
								{description !== null && (
									<FittingDescription
										className={
											area.compact
												? "text-[12.5px] leading-[1.35]"
												: "text-[13.5px] leading-[1.45]"
										}
									>
										{description}
									</FittingDescription>
								)}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-1">{controls}</div>
					</div>
					{tabs && <div className="mt-3.5">{tabs}</div>}
				</div>
			</div>
		</>
	);
}

/**
 * Renders the full-bleed atmospheric header band beneath the sticky project
 * bar on a phone, showing the area icon, title, opaque pill, description, and
 * optional docked tabs.
 */
export function PhonePageHeaderBand({
	area,
	title,
	badge,
	description,
	tabs,
}: {
	area: PageArea;
	title: ReactNode;
	badge: ReactNode;
	description: ReactNode;
	tabs?: ReactNode;
}): JSX.Element {
	return (
		<>
			<div aria-hidden="true" className="page-header-glow" />
			<div aria-hidden="true" className="page-header-sheen" />
			<div
				className={cn(
					"relative w-full min-w-0 px-4",
					area.compact ? "py-[15px]" : cn("pt-4", tabs ? "pb-0" : "pb-4"),
				)}
			>
				<div
					className={cn(
						"flex min-w-0 gap-3",
						area.compact ? "items-center" : "items-start",
					)}
				>
					<div
						aria-hidden="true"
						className={cn(
							"page-header-icon flex shrink-0 items-center justify-center",
							area.compact
								? "size-8 rounded-lg [&_svg]:size-4"
								: "size-9 rounded-[9px] [&_svg]:size-[18px]",
						)}
					>
						<area.Icon />
					</div>
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<div
							className={cn(
								"flex min-w-0 items-center gap-2",
								area.compact ? "justify-between" : "flex-wrap",
							)}
						>
							<div className="flex min-w-0 items-center gap-1.5">
								{typeof title === "string" ? (
									<h2
										title={title}
										className={cn(
											"min-w-0 truncate font-semibold text-foreground leading-[1.2]",
											area.compact
												? "text-[15px] tracking-[-0.01em]"
												: "text-[19px] tracking-[-0.02em]",
										)}
									>
										{title}
									</h2>
								) : (
									title
								)}
							</div>
							{badge !== null && (
								<span
									className={cn(
										"page-header-pill inline-flex shrink-0 items-center rounded-full px-2 py-0.5 leading-tight",
										area.compact
											? "font-mono text-[10px]"
											: "font-medium text-[10.5px]",
									)}
								>
									{badge}
								</span>
							)}
						</div>
						{description !== null && (
							<FittingDescription
								className={
									area.compact
										? "text-[12.5px] leading-[1.35]"
										: "text-[13px] leading-[1.4]"
								}
							>
								{description}
							</FittingDescription>
						)}
					</div>
				</div>
				{tabs && <div className="mt-3">{tabs}</div>}
			</div>
		</>
	);
}

/**
 * A band's description on one line, or not at all: when it is wider than the
 * room it has, it leaves the layout rather than truncate or wrap.
 */
function FittingDescription({
	className,
	children,
}: {
	className: string;
	children: ReactNode;
}): JSX.Element {
	const box = useRef<HTMLDivElement>(null);
	const text = useRef<HTMLParagraphElement>(null);
	const [fits, setFits] = useState(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the words change what has to fit.
	useLayoutEffect(() => {
		const outer = box.current;
		const inner = text.current;
		if (outer === null || inner === null) {
			return;
		}
		const measure = () => setFits(inner.offsetWidth <= outer.clientWidth);
		measure();
		if (typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(measure);
		observer.observe(outer);
		return () => observer.disconnect();
	}, [children]);
	return (
		<div ref={box} className="relative min-w-0">
			{/* Kept, unseen, when it does not fit, so it can be measured again. */}
			<p
				ref={text}
				className={cn(
					"page-header-desc m-0 w-max whitespace-nowrap",
					className,
					!fits && "invisible absolute top-0 left-0",
				)}
			>
				{children}
			</p>
		</div>
	);
}

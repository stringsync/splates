import { SparklesIcon } from "lucide-react";
import { type JSX, type SVGProps, useId } from "react";
import { cn } from "#web/lib/utils.ts";
import { ColoredMark, hasColors } from "./agent-icons";

/** What the Start menu calls the item that lets Auto pick the agent. */
export const AUTO_PICK_NAME = "Auto pick";

/**
 * Auto pick's mark, in place of an agent's, beside its name in a menu. Plain
 * like an agent's icon there; `colored` gives golden sparkles where an
 * agent's mark shows its maker's colors, in the blue-violet-pink gradient that
 * marks AI work across the page.
 */
export function AutoIcon({
	className,
	colored,
}: {
	className?: string;
	colored?: boolean;
}): JSX.Element {
	if (!colored) {
		return <SparklesIcon aria-hidden className={cn("size-4", className)} />;
	}
	return <ColoredSparkles className={cn("size-4", className)} />;
}

/** Auto pick's golden sparkles, in the gradient that marks AI work across the page. */
function ColoredSparkles(props: SVGProps<SVGSVGElement>): JSX.Element {
	const gradient = useId();
	return (
		<SparklesIcon
			aria-hidden
			stroke={`url(#${gradient})`}
			fill={`url(#${gradient})`}
			fillOpacity={0.25}
			{...props}
		>
			<defs>
				<linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor="#3b82f6" />
					<stop offset="50%" stopColor="#8b5cf6" />
					<stop offset="100%" stopColor="#ec4899" />
				</linearGradient>
			</defs>
		</SparklesIcon>
	);
}

/** How far apart, on the 24 box, the split mark's halves sit either side of its slash. */
const SPLIT_GAP = 1.5;

/**
 * Auto pick's mark once it has picked: its sparkles and the agent's colored
 * mark, split by a slash, so the composer says both that Auto pick chose and
 * whom; sparkles alone for an agent with no colors here.
 */
export function AutoAgentMark({
	agent,
	className,
}: {
	agent: string;
	className?: string;
}): JSX.Element {
	const clip = useId();
	if (!hasColors(agent)) {
		return <AutoIcon colored className={className} />;
	}
	const edge = 24 - SPLIT_GAP;
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			className={cn("size-4 shrink-0", className)}
		>
			<defs>
				<clipPath id={`${clip}auto`}>
					<polygon points={`0,0 ${edge},0 0,${edge}`} />
				</clipPath>
				<clipPath id={`${clip}agent`}>
					<polygon points={`24,${SPLIT_GAP} 24,24 ${SPLIT_GAP},24`} />
				</clipPath>
			</defs>
			<g clipPath={`url(#${clip}auto)`}>
				<ColoredSparkles width={24} height={24} />
			</g>
			<g clipPath={`url(#${clip}agent)`}>
				<ColoredMark agent={agent} />
			</g>
		</svg>
	);
}

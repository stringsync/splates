import PhotoSwipe from "photoswipe";
import { type JSX, useEffect, useRef, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/** How the image sits on screen: across the screen's width, or all of it in view. */
export type Fit = "width" | "all";

/** Lifted fit state so a caller's chrome (such as the lightbox top bar) can control tall-image fit. */
export interface FitControl {
	fit: Fit;
	setFit: (to: Fit) => void;
}

/**
 * An image that opens whole, to explore with pinch, drag, scroll and double
 * tap. A tall one offers Fit width and Fit all to switch between spanning the
 * screen's width and seeing all of it, opening at Fit width in a portrait
 * viewport and Fit all in a wider one. Mark an SVG `vector` so it opens
 * filling the screen rather than at its own, often small, size.
 */
export function ZoomableImage({
	src,
	alt,
	vector = false,
	onFitControl,
	className,
}: {
	src: string;
	alt: string;
	vector?: boolean;
	/** When supplied, hands the tall-image Fit toggle to the caller's chrome instead of floating it over the image. */
	onFitControl?: (control: FitControl | null) => void;
	className?: string;
}): JSX.Element {
	const box = useRef<HTMLDivElement>(null);
	const viewer = useRef<PhotoSwipe | null>(null);
	const fitControlRef = useRef(onFitControl);
	fitControlRef.current = onFitControl;
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	const [failed, setFailed] = useState(false);
	/** How a tall image sits, `null` for one that fits on screen as it is. */
	const [fit, setFit] = useState<Fit | null>(null);

	const applyFit = (to: Fit) => {
		const slide = viewer.current?.currSlide;
		if (!slide) {
			return;
		}
		slide.zoomTo(levelOf(slide.zoomLevels, to), undefined, 0);
		if (to === "width") {
			slide.panTo(slide.pan.x, slide.bounds.min.y);
		}
		setFit(to);
	};

	const applyFitRef = useRef(applyFit);
	applyFitRef.current = applyFit;

	useEffect(() => {
		const notify = fitControlRef.current;
		if (!notify) {
			return;
		}
		if (size && fit !== null) {
			notify({ fit, setFit: (to) => applyFitRef.current(to) });
		} else {
			notify(null);
		}
	}, [size, fit]);

	useEffect(() => () => fitControlRef.current?.(null), []);

	useEffect(() => {
		const host = box.current;
		if (!host || !size) {
			return;
		}
		const mobile = () => window.matchMedia("(max-width: 767px)").matches;
		const pswp = new PhotoSwipe({
			dataSource: [{ src, alt, ...size }],
			appendToEl: host,
			getViewportSizeFn: () => ({ x: host.clientWidth, y: host.clientHeight }),
			// Open on the whole image; double tap steps in at the tapped point and
			// a pinch moves freely between there and the maximum.
			initialZoomLevel: (zoom) => levelOf(zoom, defaultFit(zoom)),
			secondaryZoomLevel: (zoom) => Math.max(1, zoom.fit * 2.5),
			// PhotoSwipe springs a pinch released past this back to it, so on a phone
			// it sits well beyond where a pinch ends.
			maxZoomLevel: (zoom) =>
				mobile() ? Math.max(4, zoom.fill * 8) : Math.max(2, zoom.fill * 4),
			padding: { top: 0, right: 0, bottom: 0, left: 0 },
			bgOpacity: 0,
			showHideAnimationType: "none",
			trapFocus: false,
			returnFocus: false,
			escKey: false,
			arrowKeys: false,
			close: false,
			zoom: false,
			counter: false,
			arrowPrev: false,
			arrowNext: false,
			pinchToClose: false,
			closeOnVerticalDrag: false,
			clickToCloseNonZoomable: false,
			bgClickAction: false,
			tapAction: false,
			imageClickAction: "zoom",
			doubleTapAction: "zoom",
		});
		pswp.on("wheel", (event) => {
			const wheel = event.originalEvent;
			if (!wheel.metaKey || wheel.ctrlKey) {
				return;
			}
			event.preventDefault();
			const slide = pswp.currSlide;
			if (!slide?.isZoomable()) {
				return;
			}
			// Command-scroll follows the opposite direction to PhotoSwipe's
			// Control-scroll/pinch, with the same sensitivity for each wheel unit.
			let delta = wheel.deltaY * 0.002;
			if (wheel.deltaMode === 1) {
				delta = wheel.deltaY * 0.05;
			} else if (wheel.deltaMode === 2) {
				delta = wheel.deltaY;
			}
			slide.zoomTo(slide.currZoomLevel * 2 ** delta, {
				x: wheel.clientX,
				y: wheel.clientY,
			});
		});
		pswp.on("firstZoomPan", (event) => {
			const zoom = event.slide.zoomLevels;
			if (!isTall(zoom)) {
				setFit(null);
				return;
			}
			const initial = defaultFit(zoom);
			if (initial === "width") {
				// Start at its top, as a page is read.
				// PhotoSwipe's `min` pan is the image's top edge at the top of the screen.
				event.slide.pan.y = event.slide.bounds.min.y;
			}
			setFit(initial);
		});
		pswp.init();
		// Avoid a nested dialog: Base UI supplies the accessible name and focus trap.
		pswp.element?.removeAttribute("role");
		viewer.current = pswp;
		return () => {
			viewer.current = null;
			pswp.destroy();
		};
	}, [src, alt, size]);

	return (
		<div
			ref={box}
			className={cn(
				"splates-image-viewer relative w-full overflow-hidden",
				className,
			)}
		>
			{!size && (
				<img
					src={src}
					alt={alt}
					className="h-full w-full object-contain"
					onLoad={(event) => {
						const image = event.currentTarget;
						const { naturalWidth: width, naturalHeight: height } = image;
						const host = box.current;
						// PhotoSwipe never fits an image larger than its own size, and a
						// browser sizes an SVG with no width of its own to 300 pixels.
						const scale =
							vector && host && width > 0 && height > 0
								? Math.max(
										1,
										Math.min(
											host.clientWidth / width,
											host.clientHeight / height,
										),
									)
								: 1;
						setSize({ width: width * scale, height: height * scale });
					}}
					onError={() => setFailed(true)}
				/>
			)}
			{failed && (
				<p role="alert" className="p-4">
					The image could not be loaded. Try opening it in a new tab.
				</p>
			)}
			{onFitControl === undefined && size && fit !== null && (
				<div className="absolute right-[max(0.75rem,env(safe-area-inset-right))] bottom-3 z-10 flex overflow-hidden rounded-md border border-white/25 bg-black/60 text-xs">
					{(["width", "all"] as const).map((to) => (
						<button
							key={to}
							type="button"
							aria-pressed={fit === to}
							onClick={() => applyFit(to)}
							className={cn(
								"px-2.5 py-1.5 font-medium",
								fit === to ? "bg-white text-black" : "text-white",
							)}
						>
							{to === "width" ? "Fit width" : "Fit all"}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * How far to zoom `slide` to sit as `fit` says: `width` spans the screen's
 * width (never past the image's own size), `all` shows the whole image.
 */
function levelOf(
	zoom: {
		fit: number;
		panAreaSize: { x: number; y: number } | null;
		elementSize: { x: number } | null;
	},
	fit: Fit,
): number {
	if (fit === "all" || !zoom.panAreaSize || !zoom.elementSize) {
		return zoom.fit;
	}
	return Math.max(
		zoom.fit,
		Math.min(1, zoom.panAreaSize.x / zoom.elementSize.x),
	);
}

/**
 * Whether an image fit whole on screen would be much narrower than it can be,
 * as a tall full-page capture is, so the Fit width / Fit all toggle is useful.
 */
function isTall(zoom: Parameters<typeof levelOf>[0]): boolean {
	return levelOf(zoom, "width") > zoom.fit * 1.25;
}

/**
 * How an image opens: across the width when it is much taller than a portrait
 * viewport (like a phone), and whole in a wider landscape viewport so it is
 * not blown up past the screen.
 */
function defaultFit(zoom: Parameters<typeof levelOf>[0]): Fit {
	if (
		isTall(zoom) &&
		zoom.panAreaSize &&
		zoom.panAreaSize.x <= zoom.panAreaSize.y
	) {
		return "width";
	}
	return "all";
}

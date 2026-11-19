import PhotoSwipe from "photoswipe";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";

/**
 * An image that opens whole, to explore with pinch, drag and double tap, with
 * a button to fit it all on screen. Mark an SVG `vector` so it opens filling
 * the screen rather than at its own, often small, size.
 */
export function ZoomableImage({
	src,
	alt,
	vector = false,
	className,
}: {
	src: string;
	alt: string;
	vector?: boolean;
	className?: string;
}): JSX.Element {
	const box = useRef<HTMLDivElement>(null);
	const viewer = useRef<PhotoSwipe | null>(null);
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	const [failed, setFailed] = useState(false);

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
			initialZoomLevel: "fit",
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
			{size && (
				<Button
					variant="secondary"
					size="sm"
					className="absolute bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3rem)] right-[max(0.75rem,env(safe-area-inset-right))] z-10"
					onClick={() => {
						const slide = viewer.current?.currSlide;
						if (slide) {
							slide.zoomTo(slide.zoomLevels.fit);
						}
					}}
				>
					Fit image
				</Button>
			)}
		</div>
	);
}

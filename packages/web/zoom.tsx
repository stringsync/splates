import PhotoSwipe from "photoswipe";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";

/** An image to explore with pinch, drag and double tap, with a button to fit it all on screen. */
export function ZoomableImage({
	src,
	alt,
	className,
}: {
	src: string;
	alt: string;
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
			initialZoomLevel: (zoom) =>
				mobile()
					? Math.max(
							host.clientWidth / size.width,
							host.clientHeight / size.height,
						)
					: zoom.fit,
			secondaryZoomLevel: (zoom) =>
				mobile() ? zoom.fit : Math.max(1, zoom.fit * 2.5),
			maxZoomLevel: (zoom) => Math.max(2, zoom.fill * 4),
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
						setSize({ width: image.naturalWidth, height: image.naturalHeight });
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
					className="absolute bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3rem)] left-3 z-10"
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

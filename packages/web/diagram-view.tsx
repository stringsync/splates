import { type JSX, useEffect, useId, useMemo, useState } from "react";
import { ITEM, type Shown, useLightbox } from "./lightbox";

/** A D2 diagram drawn as SVG in the browser; its source shows as code while it loads or when it fails to compile. */
export function DiagramView({ source }: { source: string }): JSX.Element {
	const salt = useId().replace(/[^a-zA-Z0-9]/g, "");
	const [svg, setSvg] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		setSvg(null);
		(async () => {
			const { D2 } = await import("@terrastruct/d2");
			const d2 = new D2();
			const result = await d2.compile(source);
			const out = await d2.render(result.diagram, {
				...result.renderOptions,
				salt,
				noXMLTag: true,
			});
			if (live) {
				setSvg(out);
			}
		})().catch(() => {});
		return () => {
			live = false;
		};
	}, [source, salt]);
	const { open, lightbox } = useLightbox();
	// The lightbox loads an image from a URL, so the drawn SVG is served from a blob.
	const url = useMemo(
		() =>
			svg === null
				? null
				: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
		[svg],
	);
	useEffect(
		() => () => {
			if (url !== null) {
				URL.revokeObjectURL(url);
			}
		},
		[url],
	);
	if (svg === null || url === null) {
		return (
			<pre className="overflow-x-auto rounded-md border p-2 text-xs">
				<code>{source}</code>
			</pre>
		);
	}
	const shown: Shown = {
		url,
		alt: "diagram",
		video: false,
		name: "diagram.svg",
	};
	return (
		<>
			<button
				type="button"
				aria-label="diagram"
				className="block w-full cursor-zoom-in overflow-x-auto text-left [&>svg]:h-auto [&>svg]:max-w-full"
				{...{ [ITEM]: JSON.stringify(shown) }}
				onClick={(event) => open(event.currentTarget)}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG compiled from the card's own D2 source
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			{lightbox}
		</>
	);
}

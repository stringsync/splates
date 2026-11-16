import { type JSX, useEffect, useId, useState } from "react";

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
	if (svg === null) {
		return (
			<pre className="overflow-x-auto rounded-md border p-2 text-xs">
				<code>{source}</code>
			</pre>
		);
	}
	return (
		<div
			role="img"
			aria-label="diagram"
			className="overflow-x-auto [&>svg]:h-auto [&>svg]:max-w-full"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG compiled from the card's own D2 source
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}

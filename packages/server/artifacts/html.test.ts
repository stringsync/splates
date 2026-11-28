import { describe, expect, it } from "bun:test";
import {
	externalHtmlRefs,
	formatInlineArtifactRef,
	htmlTitleOf,
	isHtmlArtifactName,
	isValidHtml,
	parseInlineArtifactRef,
} from ".";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("HTML artifact helpers", () => {
	it("extracts and decodes the document title, or returns null when absent", () => {
		expect(
			htmlTitleOf(
				bytes(
					"<!doctype html><html><head><title>  Pricing &amp; Margin  </title></head></html>",
				),
			),
		).toBe("Pricing & Margin");
		expect(
			htmlTitleOf(bytes("<html><body><p>No title</p></body></html>")),
		).toBeNull();
		expect(htmlTitleOf(bytes("<title>   </title>"))).toBeNull();
	});

	it("validates UTF-8 HTML documents and rejects binary or plain non-HTML files", () => {
		expect(
			isValidHtml(bytes("<!doctype html><html><body>Hi</body></html>")),
		).toBe(true);
		expect(isValidHtml(bytes("<div>Fragment</div>"))).toBe(true);
		expect(isValidHtml(bytes("just plain text"))).toBe(false);
		expect(isValidHtml(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe(
			false,
		);
	});

	it("reports external scripts, stylesheets, and images while allowing inline and data URIs", () => {
		const html = bytes(`<!doctype html><html><head>
			<link rel="stylesheet" href="https://cdn.example.com/app.css">
			<link href="./local.css" rel="stylesheet">
			<link rel="icon" href="data:image/svg+xml,">
			<script src="https://cdn.example.com/chart.js"></script>
			<script>console.log("inline ok")</script>
		</head><body>
			<img src="data:image/png;base64,abc">
			<img src="/assets/logo.png">
		</body></html>`);
		expect(externalHtmlRefs(html)).toEqual([
			"https://cdn.example.com/chart.js",
			"https://cdn.example.com/app.css",
			"./local.css",
			"/assets/logo.png",
		]);
		expect(
			externalHtmlRefs(
				bytes("<!doctype html><style>body{}</style><script>1</script>"),
			),
		).toEqual([]);
	});

	it("recognizes HTML artifact filenames and round-trips inline artifact references", () => {
		expect(isHtmlArtifactName("report.html")).toBe(true);
		expect(isHtmlArtifactName("index.HTM")).toBe(true);
		expect(isHtmlArtifactName("shot.png")).toBe(false);

		const ref = formatInlineArtifactRef("my report.html", 2);
		expect(ref).toBe("#splates-artifact=my%20report.html/2");
		expect(parseInlineArtifactRef(ref)).toEqual({
			name: "my report.html",
			version: 2,
		});
		expect(parseInlineArtifactRef("/abs/path.png")).toBeNull();
		expect(parseInlineArtifactRef("#splates-artifact=bad/0")).toBeNull();
	});
});

// Bun imports any file as text with `with { type: "text" }`, but its types only
// declare the extensions it treats as text by default, and for `.html` and
// `.css` it declares something else entirely. The three files the dev page is
// served from are written as `.txt` for that reason: they are blobs a server
// hands to a browser, not modules anything here imports for their exports.
declare module "*.txt" {
	const text: string;
	export default text;
}

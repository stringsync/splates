// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "../../../setup";

// Loaded only once the DOM above is in place, and handed on from here so a test
// file need not load them itself. Bun loads a package's CommonJS while it links
// the static imports, before even this file's own `setup` import has run, and
// react-dom decides at load time whether the browser has `input` events:
// loaded too early, it concludes it does not, and no `onChange` ever fires.
export const { act, cleanup, fireEvent, render, waitFor, within } =
	await import("@testing-library/react");
export const { App } = await import("./app");
export const {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	getNearestEditorFromDOMNode,
} = await import("lexical");

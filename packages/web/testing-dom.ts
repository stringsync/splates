// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "./register-dom";

// Loaded only once the DOM above is in place, and handed on from here so a test
// file need not load them itself. Bun loads a package's CommonJS while it links
// the static imports, before even this file's own `setup` import has run, and
// react-dom decides at load time whether the browser has `input` events:
// loaded too early, it concludes it does not, and no `onChange` ever fires.
const library = await import("@testing-library/react");
export const { act, cleanup, fireEvent, render, waitFor, within } = library;
// A merge gate tests while other agents test and build, and there a page
// that shows within a second alone can take several: under load, waitFor's
// default of one second failed whole suites of App tests at once. Each test
// still has `splates dev test`'s 30 seconds.
library.configure({ asyncUtilTimeout: 10_000 });
export const { App } = await import("./app");
export const { ProjectApp } = await import("./project-app");
export const {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	getNearestEditorFromDOMNode,
} = await import("lexical");

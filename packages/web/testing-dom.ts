// Imported first, for the side effect: the DOM and testing-library must be in
// place before the page below loads react-dom.
import "./testing-library";

export {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";
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

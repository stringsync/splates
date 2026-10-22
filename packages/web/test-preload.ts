// Test-only: `splates dev test` preloads this into the page's own test run,
// apart from the server's, whose files must never see happy-dom's globals.
// That run keeps one global and module registry per worker across the files
// it hands it (`--no-isolate`), sparing each file the second or so it takes
// to load the DOM, React and the page afresh. So a file must leave nothing
// behind: testing-library cleans up after each test only in the first file
// that loads it, and the address and storage outlive a file too.
import "./register-dom";
import { afterEach } from "bun:test";

const { cleanup } = await import("@testing-library/react");
const address = location.href;

afterEach(() => {
	cleanup();
	history.replaceState(null, "", address);
	localStorage.clear();
	sessionStorage.clear();
});

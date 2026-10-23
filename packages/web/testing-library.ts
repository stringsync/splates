// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "./register-dom";

// Test-only: the page's tests take testing-library from here, never from
// `@testing-library/react` itself. Bun loads a package's CommonJS while it
// links the static imports, before even `./register-dom` has run, and
// react-dom decides at load time whether the browser has `input` events:
// loaded too early, it concludes it does not, and no `onChange` ever fires,
// in that file and in every file that runs after it in the same process.
const library = await import("@testing-library/react");
export const { act, cleanup, fireEvent, render, waitFor, within } = library;
// A merge gate tests while other agents test and build, and there a page
// that shows within a second alone can take several: under load, waitFor's
// default of one second failed whole suites of App tests at once. Each test
// still has `splates dev test`'s 30 seconds.
library.configure({ asyncUtilTimeout: 10_000 });

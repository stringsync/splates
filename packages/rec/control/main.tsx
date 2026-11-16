import { createRoot } from "react-dom/client";
import { App } from "./app";
import { Capture } from "./capture";

const capture = new Capture();
const root = document.getElementById("root");
if (!root) {
	throw new Error("the control page has no #root");
}
createRoot(root).render(<App capture={capture} />);

// Staged, nothing is recorded until Start; otherwise recording starts at once.
if (capture.state.phase === "starting") {
	capture.start();
}

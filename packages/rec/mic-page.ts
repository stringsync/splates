// Where the control server serves the mic page; a tab on it makes Chrome show its allow prompt.
export const MIC_PAGE = "/__rec/mic";

export const MIC_PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>rec mic</title>
<p id="m">Allow the microphone for rec…</p>
<script>
const say = (text) => {
	document.getElementById("m").textContent = text;
};
if (!navigator.mediaDevices) {
	say("This page has no microphone API (secure context: " + isSecureContext + ", origin: " + location.origin + ").");
} else {
	navigator.mediaDevices.getUserMedia({ audio: true }).then(
		(stream) => {
			for (const track of stream.getTracks()) track.stop();
			close();
		},
		(error) => {
			const reason = {
				NotAllowedError: "Chrome blocked or dismissed the permission: click the icon at the left of the address bar, allow the microphone, and reload. If macOS blocks Chrome, allow it in System Settings > Privacy & Security > Microphone.",
				NotFoundError: "Chrome found no microphone.",
				NotReadableError: "The microphone is in use or unreadable.",
			}[error.name] ?? "The microphone could not start.";
			say(reason + " (" + error.name + ", secure context: " + isSecureContext + ")");
		},
	);
}
</script>`;

// Where the control server serves the mic page; a tab on it makes Chrome show its allow prompt.
export const MIC_PAGE = "/__rec/mic";

export const MIC_PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>rec mic</title>
<p id="m">Allow the microphone for rec…</p>
<script>
navigator.mediaDevices.getUserMedia({ audio: true }).then(
	(stream) => {
		for (const track of stream.getTracks()) track.stop();
		close();
	},
	() => {
		document.getElementById("m").textContent =
			"The microphone is blocked: click the icon at the left of the address bar, allow it, and reload.";
	},
);
</script>`;

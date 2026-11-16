# core/dictate

Dictation: what someone says into the browser's mic, as text that arrives
while they are still speaking. The page records PCM16 and streams it over a
WebSocket to its server, which relays it to a speech-to-text model and sends
the text back as it is heard. The model's key stays on the server.

On the page, `core/dictate/browser`:

```ts
import { BufferedSink } from "core/dictate";
import { BrowserMicrophone, DictationSocket } from "core/dictate/browser";

// On the tap itself, before any await: a phone only opens the mic for a
// gesture, and iOS Safari leaves audio started later silent.
const sink = new BufferedSink();
const recording = new BrowserMicrophone().start(sink);
const socket = await DictationSocket.open("wss://example.com/api/dictation");
sink.attach(socket);
socket.events.on("heard", (text) => draft.show(text));
(await recording).events.on("tick", (level) => meter.set(level ?? 0));

// On stop:
(await recording).dispose();
const text = await socket.finish();
```

On the server, `core/dictate/server`, a `DictationRelay` per socket:

```ts
import { DictationRelay } from "core/dictate";
import { OpenAiTranscriber } from "core/dictate/server";

const transcriber = new OpenAiTranscriber(key, {
	prompt: "A developer dictating a prompt for a coding agent.",
	keywords: ["mono", "arbor"],
});

Bun.serve<DictationRelay>({
	fetch: (request, server) => {
		server.upgrade(request, { data: undefined as never });
	},
	websocket: {
		open: (socket) => {
			const peer = {
				send: (message: string) => socket.send(message),
				hangUp: () => socket.close(),
			};
			socket.data = new DictationRelay(peer, Promise.resolve(transcriber));
		},
		message: (socket, message) =>
			socket.data.receive(
				typeof message === "string" ? message : new Uint8Array(message),
			),
		close: (socket) => socket.data.dispose(),
	},
});
```

- A `Microphone` starts a `Recording` that sends its `AudioSink` a tenth of a
  second of PCM16 at `SAMPLE_RATE` at a time, and says how loud the input
  was every `TICK`, or null when no audio came, so a page can show that it
  hears and warn when it does not. It says `interrupted`, and why, when the
  page is hidden or a call takes the mic. `BrowserMicrophone` taps
  `getUserMedia` with an `AudioWorklet`, keeps the screen awake while it
  records, and resamples in `Pcm16Encoder`. Its `BrowserRecording` exposes the
  `stream` it opened, so a page can record the same mic with `MediaRecorder`
  rather than open it twice; the tracks stop on `dispose`.
- A `DictationLink` is one take on its way to the server, which
  `DictationSocket` is over a WebSocket. `finish` resolves with the final
  text, or rejects with a `DictationFailure`, whose `cred` names the key the
  server lacks when that is why.
- A `Transcriber` opens a `Transcription` per take, which takes audio and
  says the text so far as it hears it. `OpenAiTranscriber` is OpenAI's
  Realtime API with `gpt-live-transcribe`; its `prompt` and `keywords` are
  where the words an app spells its own way go. A transcriber that rejects
  with a `DictationFailure` tells the page which cred to ask for.
- `DictationMessage` is what the server says on the socket, as JSON.

`core/dictate/testing` has `FakeMicrophone`, `FakeDictationLink` and
`FakeTranscriber`, which hear the bytes a test sends as text.

## Cues

`Recording.cue("start")` and `cue("stop")` play a soft synthesized chime on the take's own `AudioContext`, so no file ships and a phone that unlocked audio on the tap plays them. The start cue drops the mic's samples for its length so it never reaches the transcript; the stop cue plays only once the mic is let go, waiting up to a second for a phone to bring the context back from moving its audio off recording, and keeps the context open until it ends.

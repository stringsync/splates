---
description: Attachments are named [Image n] and [File n] chips in the message in the order the agent receives them; a person can mark up an image before sending, and the flattened image plus numbered notes are what go
---

The composer writes an attachment into the text as a chip named by its
shelf and place (`attachmentName`, `shelfOf` in `attachment-chips.tsx`):
`[Image 2]` is the message's second image, `[File 1]` its first other file,
matching the order the agent receives them. Only PNG, JPEG, GIF and WebP
(`SEEN` in `conversation-feed.ts`) go to an agent as images; every other
file arrives as a link. Draft files survive a reload through IndexedDB.

Before sending, `useAnnotate()` (`annotate.tsx`) opens the lazy `Annotate`
dialog: a drag draws a box or an arrow, a click drops a pin, each mark is
numbered and takes a note, and marks may run into a margin past the image.
`Annotation` (`annotation.ts`) holds the image and `Mark`s, `flatten()`
makes a new `File` with the marks drawn in that replaces the original (a
`WeakMap` links it back so reopening resumes editing), and
`Annotation.notesFor` appends "Marks on [Image n]:" with the numbered notes
to the text. SVGs cannot be annotated.

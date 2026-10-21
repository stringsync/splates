---
description: What the page keeps in the browser (settings, drafts, folds, a copy of the last listing) under splates.* keys, versus what belongs to a conversation on the server (pin, marks, title, archive)
---

Browser-only state sits under a `splates.` prefix. localStorage:
`splates.settings` (theme, accent, shortcuts; the `Settings` class), drafts
(`splates.draft.<key>` with `draftAt` and `draftOpen`), the last-started-on-
Auto flag, the sidebar's folded folders, task folds, terminal layout and
names. IndexedDB: draft attachments (`splates.drafts`, since localStorage
holds only text) and `splates.copies`, the last listing and snapshot that
`PageCopy` stamps with the build so another build ignores it, which lets a
reopened page draw before the server answers. sessionStorage: the tab id
and per-tab project places. `index.html` copies old `arbor.*` keys once.

State that belongs to a conversation lives on the server through
`conversation-api.ts`: pin (`PUT /api/conversations/<id>/pinned`), read and
unread marks, title, archive. Nothing per conversation is kept in the
browser, so every device agrees.

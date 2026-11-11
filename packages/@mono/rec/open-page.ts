/** The page rec's window shows for a moment while the side panel opens: dark and quiet, so the handoff does not flash. */
export const OPEN_PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<title>rec</title>
<style>
html,body{height:100%;margin:0;background:#0b0b0d;color:#f4f4f5;font:500 15px system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;gap:12px}
i{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:p 1.2s ease-in-out infinite}
@keyframes p{50%{opacity:.25;transform:scale(.8)}}
</style>
<i></i><span>rec</span>
`;

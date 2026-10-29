# Copy Paste Typer

Types your text into places that block pasting, using real keystrokes. Two tools in one repo:

| | Chrome extension | Local typer (Windows) |
|---|---|---|
| Works in | Pages in Chrome / Edge | Any window: browsers, desktop apps, remote sessions |
| Input | Highlight text on a page, or paste into the popup | Paste into a page on `localhost:8765` |
| Start | "Type in 5s" button, popup, or **Alt+Q** | "Type in 5 seconds" button or the hotkey (**Alt+Q**) |
| Needs | Nothing to install beyond loading it | [Node.js](https://nodejs.org) and Windows |
| Together | Detects the local typer when it runs and sends typing through it, so highlights can be typed into any app | Optional: everything works without the extension |

## Chrome extension

### Install

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this repository's folder.

### Use it

1. **Highlight** the text or code you want typed, on any page. A **Type in 5s** button appears next to the highlight.
2. The highlight automatically becomes the text to type (code is detected and switches to *code editor* mode).
3. Click **Type in 5s**, then switch to the page you want typed into and click inside the field. A countdown shows on the page and on the extension icon.
4. When it reaches 0 the text is typed into the active tab.

Stop at any time with **Esc**, **Alt+Q**, or the popup's **Stop** button. The popup also lets you paste text by hand, change the speed, and turn the highlight button off.

Highlights are read from normal page text, text boxes, and the Monaco, Ace and CodeMirror editors.

### Typing into other apps (optional)

On its own the extension can only type inside the browser. If you also run the **local typer** (below), the extension connects to it and the same **Type in 5s** button types into **any Windows app**: switch to the app during the countdown and click into its field.

- It is optional. Without the local typer nothing changes: typing stays in the browser.
- It connects by itself: when you start `start.bat` it opens `http://localhost:8765`, and the extension picks up that run's access token from the page. If your default browser isn't the one with the extension, open `http://localhost:8765` in it once (the popup has a link). The token changes every time the typer restarts.
- The popup shows whether it is connected, and **Type into → This browser tab only** switches it off.
- Only that page can hand the token over, and the typer rejects every request that doesn't carry it, so other websites and extensions can't drive it.
- The typer's default port is 8765. If you change `PORT`, the extension won't find it.

### Modes

- **Letter by letter**: every character, exactly as it is. For plain fields.
- **Code editor (line by line)**: types each line, then clears the editor's auto-indent and auto-closed brackets and quotes so the result matches the original. Click at the end of an **empty** editor first.

Chrome shows a "debugging this browser" bar while typing. That is expected: the extension types through the debugger API so the keystrokes are real.

## Local typer (Windows)

```
local-typer\start.bat
```

Opens `http://localhost:8765`. Paste your text, pick a mode and speed, click into the target app, then press **Alt+Q** (or click **Type in 5 seconds**). Press the hotkey again to stop.

- Change the hotkey or port with environment variables: `HOTKEY=Ctrl+Alt+T PORT=9000 node server.js`.
- No dependencies and no `npm install`. `local-typer/package.json` only pins the folder to CommonJS so a stray `package.json` in a parent folder can't break it.
- Typing stops with an error if the active window changes mid-run, so keystrokes never land in the wrong window.
- Windows only, and it can't type into windows running as administrator unless the typer is too.

## Tips if characters go missing

- Raise the delay (40-60 ms is a good start).
- Use *code editor* mode in code editors, *plain text* everywhere else.
- Start from an empty editor with the cursor at the end.
- Close any old `start.bat` window before starting a new one.

## Layout

```
manifest.json, background.js, content.js,
page-bridge.js, popup.html, popup.js   Chrome extension
local-typer/                           Windows typer (server.js, helper.ps1, index.html, start.bat)
```

Use this on your own machine and in places where typing text this way is allowed.

# Copy Paste Typer

Types your text into places that block pasting, using real keystrokes. Two tools in one repo:

| | Chrome extension | Local typer (Windows) |
|---|---|---|
| Works in | Pages in Chrome / Edge | Any window: browsers, desktop apps, remote sessions |
| Input | Highlight text on a page, or paste into the popup | Paste into a page on `localhost:8765` |
| Start | "Type in 5s" button, popup, or **Alt+Q** | "Type in 5 seconds" button or the hotkey (**Alt+Q**) |
| Needs | Nothing to install beyond loading it | [Node.js](https://nodejs.org) and Windows |

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

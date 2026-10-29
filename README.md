# Copy Paste Typer

Types your text into places that block pasting, using real keystrokes. Two tools in one repo:

| | Chrome extension | Local typer (Windows) |
|---|---|---|
| Works in | Pages in Chrome / Edge | Any window: browsers, desktop apps, remote sessions |
| Input | Highlight text on a page (starts a 5s timer), or paste into the popup | Paste into a page on `localhost:8765` |
| Start | Automatic on highlight (with the typer), "Type in 5s" button, popup | "Type in 5 seconds" button or the hotkey (**Alt+Q**) |
| Needs | Nothing to install beyond loading it | [Node.js](https://nodejs.org) and Windows |
| Together | Detects the local typer when it runs and sends typing through it, so highlights can be typed into any app | Optional: everything works without the extension |

## Chrome extension

### Install

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this repository's folder.

### Use it (with the local typer running)

1. Start `local-typer\start.bat` once and leave its window open.
2. **Highlight** the text or code you want typed, on any page (a browser editor like Monaco, Ace or CodeMirror works too).
3. A countdown banner appears: **5, 4, 3...** Switch to **any app** (Notepad, an IDE, a terminal, another browser) and click where the text should go.
4. When it reaches 0 the text is typed there. Code is detected and typed in *code editor* mode.

Cancel with **Cancel** on the banner, **Esc**, or the typer's **Alt+Q** hotkey. The popup lets you paste text by hand, change the speed, and turn the highlight reaction or the automatic timer off.

### Without the local typer

The extension still works on its own, but only inside the browser. Highlighting shows a **Type in 5s** button instead of starting by itself; click it, switch to another tab, click into the field, and it types into that tab when the countdown ends. To type into other apps you need the local typer.

### How the extension and the local typer connect

- Nothing to pair. The extension has a fixed ID (set by the `key` in `manifest.json`) and the typer trusts requests from exactly that ID. Websites and other extensions can't fake it, and the typer refuses everyone else without its access token.
- It is optional in both directions: the typer works without the extension, and the extension works without the typer. The popup shows whether it is connected, and **Type into â†’ This browser tab only** switches the link off.
- The typer's default port is 8765. If you change `PORT`, the extension won't find it.
- If you loaded an older version of the extension before, remove it at `chrome://extensions` and **Load unpacked** again: the fixed ID changes the extension's identity once.

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

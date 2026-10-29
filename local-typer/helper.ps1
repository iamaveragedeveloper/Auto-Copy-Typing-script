param([int]$Mods = 1, [int]$Vk = 81)

# Windows helper started by server.js. Registers a global hotkey and types text into
# whatever window has focus using SendInput. Talks to the server over stdin/stdout:
#   stdin : "TYPE <mode> <delay> <jitter 0|1> <startDelayMs> <base64 utf8 text>" | "STOP"
#   stdout: READY | HOTKEY | STARTED | PROGRESS <pct> | DONE | ERROR <message>

$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

public class HotWin : NativeWindow
{
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0312) TyperHelper.Out("HOTKEY");
        base.WndProc(ref m);
    }
}

public class TyperHelper
{
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint tid);
    [DllImport("user32.dll")] static extern short VkKeyScanEx(char ch, IntPtr hkl);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

    const ushort VK_BACK = 0x08, VK_TAB = 0x09, VK_RETURN = 0x0D, VK_SHIFT = 0x10;
    const ushort VK_END = 0x23, VK_DELETE = 0x2E;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;

    static StreamWriter outW;
    static volatile bool stop;
    static volatile bool typing;
    static IntPtr hkl;
    static Random rng = new Random();
    static int lastPct;

    public static void Out(string s)
    {
        lock (outW) { outW.WriteLine(s); }
    }

    public static void Run(int mods, int vk)
    {
        outW = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        outW.AutoFlush = true;

        HotWin win = new HotWin();
        win.CreateHandle(new CreateParams());
        // 0x4000 = MOD_NOREPEAT
        if (!RegisterHotKey(win.Handle, 1, (uint)mods | 0x4000, (uint)vk))
            Out("ERROR hotkey is already used by another program");
        else
            Out("READY");

        Thread reader = new Thread(ReadLoop);
        reader.IsBackground = true;
        reader.Start();

        Application.Run();
    }

    static void ReadLoop()
    {
        StreamReader r = new StreamReader(Console.OpenStandardInput(), Encoding.ASCII);
        string line;
        while ((line = r.ReadLine()) != null)
        {
            if (line == "STOP") { stop = true; continue; }
            if (!line.StartsWith("TYPE ")) continue;
            if (typing) { Out("ERROR already typing"); continue; }

            string[] p = line.Split(new char[] { ' ' }, 6);
            string mode = p[1];
            int delay = int.Parse(p[2]);
            bool jitter = p[3] == "1";
            int startDelay = int.Parse(p[4]);
            string text = Encoding.UTF8.GetString(Convert.FromBase64String(p[5]));

            typing = true;
            stop = false;
            Thread t = new Thread(delegate() { TypeAll(mode, delay, jitter, startDelay, text); });
            t.IsBackground = true;
            t.Start();
        }
        Environment.Exit(0); // server went away
    }

    static void TypeAll(string mode, int delay, bool jitter, int startDelay, string text)
    {
        Out("STARTED");
        try
        {
            Pause(startDelay, false);
            if (!stop) WaitForModifiersReleased();
            if (!stop)
            {
                hkl = GetKeyboardLayout(GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero));
                text = text.Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd('\n');
                lastPct = -1;
                if (mode == "code") TypeCode(text, delay, jitter);
                else TypeChars(text, delay, jitter);
            }
        }
        catch (Exception e)
        {
            Out("ERROR " + e.Message.Replace('\n', ' ').Replace('\r', ' '));
        }
        typing = false;
        Out("DONE");
    }

    static void WaitForModifiersReleased()
    {
        int[] keys = new int[] { 0x12, 0x11, 0x10, 0x5B, 0x5C };
        for (int waited = 0; waited < 4000 && !stop; waited += 25)
        {
            bool down = false;
            foreach (int k in keys) if ((GetAsyncKeyState(k) & 0x8000) != 0) down = true;
            if (!down) { Thread.Sleep(60); return; }
            Thread.Sleep(25);
        }
        if (!stop) throw new Exception("Release Alt/Ctrl/Shift after pressing the hotkey");
    }

    static void Pause(int ms, bool jitter)
    {
        if (jitter) ms = (int)(ms * (0.5 + rng.NextDouble()));
        while (ms > 0 && !stop)
        {
            int slice = Math.Min(ms, 50);
            Thread.Sleep(slice);
            ms -= slice;
        }
    }

    static void Progress(int i, int total)
    {
        int pct = (int)((i + 1) * 100L / total);
        if (pct != lastPct) { lastPct = pct; Out("PROGRESS " + pct); }
    }

    static void TypeChars(string text, int delay, bool jitter)
    {
        for (int i = 0; i < text.Length && !stop; i++)
        {
            SendString(text.Substring(i, 1));
            Progress(i, text.Length);
            Pause(delay, jitter);
        }
    }

    // Code editors auto-indent new lines and auto-close brackets. Type each line as a
    // burst, then undo both so the result matches the pasted text exactly.
    // Assumes the cursor is at the end of the document (an empty editor).
    static void TypeCode(string text, int delay, bool jitter)
    {
        string[] lines = text.Split('\n');
        for (int i = 0; i < lines.Length && !stop; i++)
        {
            string line = lines[i].Trim().Length == 0 ? "" : lines[i];
            TypeCodeLine(line, i == lines.Length - 1);
            Progress(i, lines.Length);
            Pause(delay * Math.Min(Math.Max(line.Length, 1), 12), jitter);
        }
    }

    static int Count(string s, string chars)
    {
        int n = 0;
        foreach (char c in s) if (chars.IndexOf(c) >= 0) n++;
        return n;
    }

    static int IndentWidth(string line)
    {
        int w = 0;
        foreach (char c in line)
        {
            if (c == ' ') w += 1;
            else if (c == '\t') w += 4;
            else break;
        }
        return w;
    }

    static void TypeCodeLine(string line, bool last)
    {
        if (line.Length > 0) { SendString(line); Thread.Sleep(30); }

        if (Count(line, "([{") > Count(line, ")]}"))
        {
            // the editor probably auto-inserted closers after the cursor; the source types its own later
            SendVk(VK_END, true, true);
            SendVk(VK_DELETE, false, true);
            Thread.Sleep(15);
        }

        if (last) return;

        if (line.Length > 0)
        {
            // a space closes any autocomplete popup, so Enter inserts a newline instead of accepting a suggestion
            SendString(" ");
            Thread.Sleep(15);
            SendVk(VK_BACK, false, false);
            Thread.Sleep(15);
        }
        SendVk(VK_RETURN, false, false);
        Thread.Sleep(25);

        int width = IndentWidth(line);
        if (width > 0 || Regex.IsMatch(line, @"[:{(\[]\s*$"))
        {
            // Shift+Tab outdents one level and does nothing on an unindented line
            int presses = Math.Min(30, (width + 1) / 2 + 2);
            for (int k = 0; k < presses; k++) { SendVk(VK_TAB, true, false); Thread.Sleep(5); }
        }
    }

    static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT i = new INPUT();
        i.type = 1;
        i.u.ki.wVk = vk;
        i.u.ki.wScan = scan;
        i.u.ki.dwFlags = flags;
        return i;
    }

    static void AddVk(List<INPUT> list, ushort vk, bool shift, bool extended)
    {
        uint ext = extended ? KEYEVENTF_EXTENDEDKEY : 0;
        ushort scan = (ushort)MapVirtualKey(vk, 0);
        if (shift) list.Add(Key(VK_SHIFT, (ushort)MapVirtualKey(VK_SHIFT, 0), 0));
        list.Add(Key(vk, scan, ext));
        list.Add(Key(vk, scan, ext | KEYEVENTF_KEYUP));
        if (shift) list.Add(Key(VK_SHIFT, (ushort)MapVirtualKey(VK_SHIFT, 0), KEYEVENTF_KEYUP));
    }

    static void AddChar(List<INPUT> list, char c)
    {
        if (c == '\n') { AddVk(list, VK_RETURN, false, false); return; }
        if (c == '\t') { AddVk(list, VK_TAB, false, false); return; }

        short v = VkKeyScanEx(c, hkl);
        if (c >= 32 && c < 127 && v != -1 && (((v >> 8) & 6) == 0))
        {
            bool shift = ((v >> 8) & 1) != 0;
            if (char.IsLetter(c) && Control.IsKeyLocked(Keys.CapsLock)) shift = !shift;
            AddVk(list, (ushort)(v & 0xFF), shift, false);
        }
        else
        {
            // no plain key for this character on the current layout: send it as a unicode character
            list.Add(Key(0, c, KEYEVENTF_UNICODE));
            list.Add(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
        }
    }

    static void Flush(List<INPUT> list)
    {
        const int chunk = 300;
        for (int i = 0; i < list.Count; i += chunk)
        {
            INPUT[] part = list.GetRange(i, Math.Min(chunk, list.Count - i)).ToArray();
            if (SendInput((uint)part.Length, part, Marshal.SizeOf(typeof(INPUT))) != (uint)part.Length)
                throw new Exception("Windows blocked the keystrokes (is the target app running as administrator?)");
        }
    }

    static void SendString(string s)
    {
        List<INPUT> list = new List<INPUT>();
        foreach (char c in s) AddChar(list, c);
        Flush(list);
    }

    static void SendVk(ushort vk, bool shift, bool extended)
    {
        List<INPUT> list = new List<INPUT>();
        AddVk(list, vk, shift, extended);
        Flush(list);
    }
}
'@

Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms
[TyperHelper]::Run($Mods, $Vk)

using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

internal static class FullscreenProbe
{
    private const uint GetRootWindow = 2;
    private const uint MonitorDefaultToNull = 0;
    private const int WindowStyleIndex = -16;
    private const int WindowCaption = 0x00C00000;
    private const int WindowResizeFrame = 0x00040000;
    private const int DwmVisibleBounds = 9;
    private const int DwmCloaked = 14;
    private const int EdgeTolerance = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public uint Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    private static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", ExactSpelling = true)]
    private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder name, int count);
    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", ExactSpelling = true)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("shcore.dll")]
    private static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect value, uint size);
    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out uint value, uint size);

    private static bool EnablePerMonitorDpi()
    {
        try
        {
            // Per-monitor v2 was introduced after Windows 10's first releases.
            if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero ||
                SetThreadDpiAwarenessContext(new IntPtr(-3)) != IntPtr.Zero) return true;
        }
        catch (EntryPointNotFoundException)
        {
            // Older Windows 10 builds have the process-level API.
        }
        return SetProcessDpiAwareness(2) >= 0;
    }

    private static bool Covers(Rect window, Rect display)
    {
        return window.Left <= display.Left + EdgeTolerance &&
            window.Top <= display.Top + EdgeTolerance &&
            window.Right >= display.Right - EdgeTolerance &&
            window.Bottom >= display.Bottom - EdgeTolerance;
    }

    private static bool IsShellSurface(IntPtr hwnd)
    {
        var name = new System.Text.StringBuilder(64);
        if (GetClassName(hwnd, name, name.Capacity) == 0) return true;
        switch (name.ToString())
        {
            case "Progman":
            case "WorkerW":
            case "Shell_TrayWnd":
            case "Shell_SecondaryTrayWnd":
            case "MultitaskingViewFrame":
            case "TaskSwitcherWnd":
                return true;
            default:
                return false;
        }
    }

    private static bool IsFullscreen(IntPtr pet, uint parentId)
    {
        IntPtr foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) return false;
        IntPtr window = GetAncestor(foreground, GetRootWindow);
        if (window == IntPtr.Zero || window == pet || window == GetDesktopWindow() ||
            window == GetShellWindow() || !IsWindowVisible(window) || IsIconic(window)) return false;

        uint ownerId;
        if (GetWindowThreadProcessId(window, out ownerId) == 0 || ownerId == parentId) return false;

        // Some browsers retain their maximized flag on entering fullscreen but
        // remove the normal frame. Inspect both rather than rejecting their F11.
        if (IsZoomed(window) && (GetWindowLong(window, WindowStyleIndex) & (WindowCaption | WindowResizeFrame)) != 0)
            return false;

        uint cloak;
        if (DwmGetWindowAttribute(window, DwmCloaked, out cloak, sizeof(uint)) >= 0 && cloak != 0) return false;

        // Compare physical Win32 coordinates on the pet's actual display. A
        // spanning foreground window can cover this display even if its largest
        // intersection is on a different monitor.
        IntPtr monitor = MonitorFromWindow(pet == IntPtr.Zero ? window : pet, MonitorDefaultToNull);
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf(typeof(MonitorInfo)) };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return false;

        Rect bounds;
        if (DwmGetWindowAttribute(window, DwmVisibleBounds, out bounds, (uint)Marshal.SizeOf(typeof(Rect))) < 0 &&
            !GetWindowRect(window, out bounds)) return false;
        return Covers(bounds, info.Monitor) && !IsShellSurface(window) && GetForegroundWindow() == foreground;
    }

    private static int Main(string[] args)
    {
        if (!EnablePerMonitorDpi()) return 1;
        if (args.Length == 1 && args[0] == "--check")
        {
            Console.WriteLine(IsFullscreen(IntPtr.Zero, 0) ? "1" : "0");
            return 0;
        }

        ulong handle;
        uint parentId;
        if (args.Length != 2 ||
            !ulong.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out handle) || handle == 0 ||
            !uint.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out parentId) || parentId == 0)
            return 2;

        IntPtr pet = new IntPtr(unchecked((long)handle));
        var stopped = new ManualResetEvent(false);
        var watchParent = new Thread(() =>
        {
            try
            {
                Stream input = Console.OpenStandardInput();
                while (input.ReadByte() >= 0) { }
            }
            catch (IOException)
            {
                // A closed pipe ends the probe just like EOF.
            }
            finally
            {
                stopped.Set();
            }
        });
        watchParent.IsBackground = true;
        watchParent.Start();

        try
        {
            while (!stopped.WaitOne(0) && IsWindow(pet))
            {
                Console.WriteLine(IsFullscreen(pet, parentId) ? "1" : "0");
                Console.Out.Flush();
                if (stopped.WaitOne(350)) break;
            }
        }
        catch (IOException)
        {
            // The application closed its output pipe.
        }
        return 0;
    }
}

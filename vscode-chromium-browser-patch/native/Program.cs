using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const long WsChild = 0x40000000L;
    private const long WsVisible = 0x10000000L;
    private const long WsPopup = 0x80000000L;
    private const long WsCaption = 0x00C00000L;
    private const long WsThickFrame = 0x00040000L;
    private const long WsMinimizeBox = 0x00020000L;
    private const long WsMaximizeBox = 0x00010000L;
    private const long WsSysMenu = 0x00080000L;
    private const uint SwpFrameChanged = 0x0020;
    private const uint SwpShowWindow = 0x0040;
    private const int SwHide = 0;
    private const int SwShow = 5;

    private static IntPtr _child;
    private static IntPtr _originalParent;
    private static nint _originalStyle;
    private static nint _originalExStyle;
    private static Rect _originalRect;

    public static async Task Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        string? line;
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            Response response;
            try
            {
                var command = JsonSerializer.Deserialize<NativeCommand>(line, JsonOptions)
                    ?? throw new InvalidOperationException("Empty command.");
                await Execute(command);
                response = new Response(command.Id, true, null);
                Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
                Console.Out.Flush();
                if (command.Command == "shutdown")
                {
                    return;
                }
            }
            catch (Exception exception)
            {
                var id = TryReadId(line);
                response = new Response(id, false, exception.Message);
                Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
                Console.Out.Flush();
            }
        }
        Detach();
    }

    private static async Task Execute(NativeCommand command)
    {
        switch (command.Command)
        {
            case "attach":
                if (_child == IntPtr.Zero || !IsWindow(_child))
                {
                    _child = await FindWindowByTitle(command.TitleToken
                        ?? throw new InvalidOperationException("titleToken is required."));
                    CaptureOriginalState();
                }
                var parent = ParseHandle(command.ParentHandle);
                if (parent == IntPtr.Zero || !IsWindow(parent))
                {
                    throw new InvalidOperationException("The VS Code parent window handle is invalid.");
                }
                Attach(parent);
                SetBounds(command);
                break;
            case "layout":
                EnsureChild();
                SetBounds(command);
                break;
            case "show":
                EnsureChild();
                ShowWindow(_child, SwShow);
                break;
            case "hide":
                if (_child != IntPtr.Zero && IsWindow(_child))
                {
                    ShowWindow(_child, SwHide);
                }
                break;
            case "focus":
                EnsureChild();
                ShowWindow(_child, SwShow);
                SetFocus(_child);
                break;
            case "detach":
                Detach();
                break;
            case "shutdown":
                Detach();
                break;
            default:
                throw new InvalidOperationException($"Unknown command: {command.Command}");
        }
    }

    private static void CaptureOriginalState()
    {
        _originalParent = GetParent(_child);
        _originalStyle = GetWindowLongPtr(_child, GwlStyle);
        _originalExStyle = GetWindowLongPtr(_child, GwlExStyle);
        GetWindowRect(_child, out _originalRect);
    }

    private static void Attach(IntPtr parent)
    {
        SetParent(_child, parent);
        var style = _originalStyle.ToInt64();
        style &= ~(WsPopup | WsCaption | WsThickFrame | WsMinimizeBox | WsMaximizeBox | WsSysMenu);
        style |= WsChild | WsVisible;
        SetWindowLongPtr(_child, GwlStyle, new IntPtr(style));
        SetWindowLongPtr(_child, GwlExStyle, IntPtr.Zero);
    }

    private static void SetBounds(NativeCommand command)
    {
        if (command.Width <= 0 || command.Height <= 0)
        {
            throw new InvalidOperationException("The target bounds are invalid.");
        }
        if (!SetWindowPos(
            _child,
            new IntPtr(-1),
            command.X,
            command.Y,
            command.Width,
            command.Height,
            SwpFrameChanged | SwpShowWindow))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    private static void Detach()
    {
        if (_child == IntPtr.Zero || !IsWindow(_child))
        {
            _child = IntPtr.Zero;
            return;
        }
        ShowWindow(_child, SwHide);
        SetParent(_child, _originalParent);
        SetWindowLongPtr(_child, GwlStyle, _originalStyle);
        SetWindowLongPtr(_child, GwlExStyle, _originalExStyle);
        SetWindowPos(
            _child,
            IntPtr.Zero,
            _originalRect.Left,
            _originalRect.Top,
            _originalRect.Right - _originalRect.Left,
            _originalRect.Bottom - _originalRect.Top,
            SwpFrameChanged | SwpShowWindow);
        _child = IntPtr.Zero;
    }

    private static async Task<IntPtr> FindWindowByTitle(string titleToken)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows((window, _) =>
            {
                if (!IsWindowVisible(window))
                {
                    return true;
                }
                var length = GetWindowTextLength(window);
                if (length == 0)
                {
                    return true;
                }
                var title = new StringBuilder(length + 1);
                GetWindowText(window, title, title.Capacity);
                if (title.ToString().Contains(titleToken, StringComparison.Ordinal))
                {
                    found = window;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            if (found != IntPtr.Zero)
            {
                return found;
            }
            await Task.Delay(100);
        }
        throw new TimeoutException("Could not find the Chromium window.");
    }

    private static IntPtr ParseHandle(string? value)
    {
        if (!ulong.TryParse(value, out var handle))
        {
            throw new InvalidOperationException("parentHandle is invalid.");
        }
        return new IntPtr(unchecked((long)handle));
    }

    private static int TryReadId(string line)
    {
        try
        {
            using var document = JsonDocument.Parse(line);
            return document.RootElement.TryGetProperty("id", out var id) ? id.GetInt32() : 0;
        }
        catch
        {
            return 0;
        }
    }

    private static void EnsureChild()
    {
        if (_child == IntPtr.Zero || !IsWindow(_child))
        {
            throw new InvalidOperationException("No Chromium window is attached.");
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private sealed record NativeCommand(
        int Id,
        string Command,
        string? ParentHandle,
        string? TitleToken,
        int X,
        int Y,
        int Width,
        int Height);

    private sealed record Response(int Id, bool Ok, string? Error);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr child);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rectangle);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLongPtr32(IntPtr window, int index);

    private static IntPtr GetWindowLongPtr(IntPtr window, int index) =>
        IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : GetWindowLongPtr32(window, index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr32(IntPtr window, int index, IntPtr value);

    private static IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value) =>
        IntPtr.Size == 8 ? SetWindowLongPtr64(window, index, value) : SetWindowLongPtr32(window, index, value);
}

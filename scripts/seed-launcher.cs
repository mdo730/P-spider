using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

// hpoi 种子抓取启动器：双击本 exe 即可。
// - 自带代理环境变量（Node 必须在启动前读到 NODE_USE_ENV_PROXY）
// - 单实例；崩溃自动续跑；输出同时到控制台与 hpoi-seed\_run.log
class SeedLauncher
{
    static string NodeExe()
    {
        string[] paths = {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe"
        };
        foreach (string p in paths)
        {
            if (File.Exists(p)) return p;
        }
        return "node.exe";
    }

    static int Main()
    {
        bool createdNew;
        using (Mutex mtx = new Mutex(true, "Global\\hpoi-seed-launcher", out createdNew))
        {
            if (!createdNew)
            {
                Console.WriteLine("[launcher] 已有实例在运行，按任意键退出...");
                Console.ReadKey();
                return 1;
            }
            return Run();
        }
    }

    static int Run()
    {
        try { Console.OutputEncoding = System.Text.Encoding.UTF8; } catch { }
        Environment.SetEnvironmentVariable("NODE_USE_ENV_PROXY", "1");
        Environment.SetEnvironmentVariable("HTTP_PROXY", "http://127.0.0.1:7897");
        Environment.SetEnvironmentVariable("HTTPS_PROXY", "http://127.0.0.1:7897");
        Environment.SetEnvironmentVariable("NO_PROXY", "127.0.0.1,localhost");

        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string logDir = Path.Combine(baseDir, "hpoi-seed");
        Directory.CreateDirectory(logDir);
        string log = Path.Combine(logDir, "_run.log");

        Console.WriteLine("============================================================");
        Console.WriteLine("  hpoi seed crawler (via Clash 127.0.0.1:7897) [--via-api]");
        Console.WriteLine("  dir : " + baseDir);
        Console.WriteLine("  log : " + log);
        Console.WriteLine("  stop: close this window");
        Console.WriteLine("============================================================");

        while (true)
        {
            ProcessStartInfo psi = new ProcessStartInfo(NodeExe());
            psi.WorkingDirectory = baseDir;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = System.Text.Encoding.UTF8;
            psi.StandardErrorEncoding = System.Text.Encoding.UTF8;
            psi.Arguments = "scripts\\build-hpoi-seed.mjs --via-api";

            int code;
            using (Process p = Process.Start(psi))
            using (FileStream fs = new FileStream(log, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
            using (StreamWriter w = new StreamWriter(fs))
            {
                w.AutoFlush = true;
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null) { Console.WriteLine(e.Data); w.WriteLine(e.Data); }
                };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null) { Console.Error.WriteLine(e.Data); w.WriteLine(e.Data); }
                };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                code = p.ExitCode;
            }

            if (code == 0) break;
            Console.WriteLine("[launcher] interrupted (exit " + code + "), resume in 10s ...");
            Thread.Sleep(10000);
        }

        Console.WriteLine("[launcher] done.");
        Console.WriteLine("Press any key to exit...");
        Console.ReadKey();
        return 0;
    }
}

import * as vscode from "vscode";

type Level = "error" | "warn" | "info" | "debug";
const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export class Logger {
  private channel: vscode.OutputChannel;
  private level: Level = "info";

  constructor(name = "CodeRipple") {
    this.channel = vscode.window.createOutputChannel(name);
    this.configure();
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("coderipple.logLevel")) this.configure();
    });
  }

  private configure(): void {
    const cfg = vscode.workspace.getConfiguration("coderipple");
    this.level = (cfg.get<string>("logLevel") as Level) ?? "info";
  }

  private write(level: Level, msg: string, ...args: unknown[]): void {
    if (ORDER[level] > ORDER[this.level]) return;
    const ts = new Date().toISOString();
    const extra = args.length ? " " + args.map((a) => safe(a)).join(" ") : "";
    this.channel.appendLine(`[${ts}] [${level.toUpperCase()}] ${msg}${extra}`);
  }

  error(msg: string, ...a: unknown[]): void {
    this.write("error", msg, ...a);
  }
  warn(msg: string, ...a: unknown[]): void {
    this.write("warn", msg, ...a);
  }
  info(msg: string, ...a: unknown[]): void {
    this.write("info", msg, ...a);
  }
  debug(msg: string, ...a: unknown[]): void {
    this.write("debug", msg, ...a);
  }

  show(): void {
    this.channel.show(true);
  }
  dispose(): void {
    this.channel.dispose();
  }
}

function safe(v: unknown): string {
  try {
    if (v instanceof Error) return `${v.message}\n${v.stack ?? ""}`;
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

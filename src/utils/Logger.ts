import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

export class Logger {
  private static readonly LOG_DIR = process.env.LOG_DIR || "./logs";
  private static readonly NODE_ENV = process.env.NODE_ENV || "development";
  private static readonly LOG_LEVEL = process.env.LOG_LEVEL || "info";
  private static readonly IS_LAMBDA =
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.AWS_EXECUTION_ENV);

  private static readonly LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  private static shouldLog(level: LogLevel): boolean {
    const currentLevel = this.LOG_LEVELS[this.LOG_LEVEL as LogLevel] ?? 1;
    const messageLevel = this.LOG_LEVELS[level];
    return messageLevel >= currentLevel;
  }

  private static formatLogEntry(entry: LogEntry): string {
    const { timestamp, level, message, context, error, stack } = entry;
    const levelStr = level.toUpperCase().padEnd(6);
    const contextStr = context ? ` | ${JSON.stringify(context)}` : "";
    const errorStr = error ? ` | Error: ${error}` : "";
    const stackStr = stack ? `\n${stack}` : "";

    return `[${timestamp}] ${levelStr} ${message}${contextStr}${errorStr}${stackStr}`;
  }

  private static ensureLogDir(): void {
    if (!fs.existsSync(this.LOG_DIR)) {
      fs.mkdirSync(this.LOG_DIR, { recursive: true });
    }
  }

  private static writeLog(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const entry: LogEntry = {
      timestamp,
      level,
      message,
      context,
      error: error?.message,
      stack: error?.stack
    };

    const formattedLog = this.formatLogEntry(entry);

    // Lambda and other containerized runtimes should log to stdout/stderr.
    if (this.NODE_ENV === "development" || this.IS_LAMBDA) {
      if (level === "error") {
        // eslint-disable-next-line no-console
        console.error(formattedLog);
      } else if (level === "warn") {
        // eslint-disable-next-line no-console
        console.warn(formattedLog);
      } else {
        // eslint-disable-next-line no-console
        console.log(formattedLog);
      }
    }

    if (this.IS_LAMBDA) {
      return;
    }

    // File output
    if (this.NODE_ENV !== "development" || level === "error") {
      try {
        this.ensureLogDir();
        const logFile = path.join(this.LOG_DIR, `${level}-${new Date().toISOString().split("T")[0]}.log`);

        fs.appendFileSync(logFile, formattedLog + "\n", "utf-8");
      } catch (writeError) {
        // eslint-disable-next-line no-console
        console.error(
          `[${timestamp}] ERROR  Failed to write log file | ${JSON.stringify({
            log_dir: this.LOG_DIR,
            write_error:
              writeError instanceof Error ? writeError.message : String(writeError),
          })}`
        );
        // eslint-disable-next-line no-console
        console.log(formattedLog);
      }
    }
  }

  public static debug(message: string, context?: Record<string, unknown>): void {
    this.writeLog("debug", message, context);
  }

  public static info(message: string, context?: Record<string, unknown>): void {
    this.writeLog("info", message, context);
  }

  public static warn(message: string, context?: Record<string, unknown>): void {
    this.writeLog("warn", message, context);
  }

  public static error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.writeLog("error", message, context, error);
  }

  public static http(method: string, path: string, statusCode: number, duration: number): void {
    this.info(`${method} ${path} ${statusCode}`, { duration_ms: duration });
  }
}

type LogFields = Record<string, unknown>;

function line(level: string, message: string, fields?: LogFields): string {
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  return `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${message}${suffix}`;
}

export const logger = {
  info(message: string, fields?: LogFields): void {
    console.log(line("info", message, fields));
  },
  warn(message: string, fields?: LogFields): void {
    console.warn(line("warn", message, fields));
  },
  error(message: string, fields?: LogFields): void {
    console.error(line("error", message, fields));
  },
};

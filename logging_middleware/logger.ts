import axios from "axios";

const BASE_URL = "http://4.224.186.213/evaluation-service";

export type Stack = "backend" | "frontend";
export type Level = "debug" | "info" | "warn" | "error" | "fatal";

type BackendPackage =
  | "cache"
  | "controller"
  | "cron_job"
  | "db"
  | "domain"
  | "handler"
  | "repository"
  | "route"
  | "service";

type SharedPackage = "auth" | "config" | "middleware" | "utils";

export type LogPackage = BackendPackage | SharedPackage;

function getAuthToken(): string | undefined {
  const token = process.env.AUTH_TOKEN?.trim();
  return token ? token : undefined;
}

export async function Log(
  stack: Stack,
  level: Level,
  pkg: LogPackage,
  message: string
): Promise<void> {
  const token = getAuthToken();

  if (!token) {
    console.error(`[LOG SKIPPED] AUTH_TOKEN is not set | ${level.toUpperCase()} | ${pkg} | ${message}`);
    return;
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/logs`,
      { stack, level, package: pkg, message },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log(
      `[LOG OK] ${level.toUpperCase()} | ${pkg} | ${message} → logID: ${response.data.logID}`
    );
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[LOG FAILED] ${detail}`);
  }
}

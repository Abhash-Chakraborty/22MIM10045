import axios from "axios";
import fs from "node:fs";
import path from "node:path";

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

function loadRootEnv(): void {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadRootEnv();

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

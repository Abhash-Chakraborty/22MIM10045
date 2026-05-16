import axios from "axios";
import { Log } from "../logging_middleware/logger";

const BASE_URL = "http://4.224.186.213/evaluation-service";

export interface Depot {
  ID: number;
  MechanicHours: number;
}

export interface Vehicle {
  TaskID: string;
  Duration: number;
  Impact: number;
}

export interface ScheduleResult {
  depotID: number;
  mechanicHours: number;
  selectedTasks: string[];
  totalImpact: number;
  totalDuration: number;
}

function requireAuthToken(): string {
  const token = process.env.AUTH_TOKEN?.trim();
  if (!token) {
    throw new Error("AUTH_TOKEN is required. Set it before running the scheduler.");
  }
  return token;
}

export function knapsack(
  vehicles: Vehicle[],
  budget: number
): { selected: string[]; impact: number; duration: number } {
  if (!Number.isInteger(budget) || budget < 0) {
    throw new Error("Mechanic-hour budget must be a non-negative integer.");
  }

  const orderedVehicles = [...vehicles].sort((left, right) =>
    left.TaskID.localeCompare(right.TaskID)
  );
  const itemCount = orderedVehicles.length;
  const dp: number[][] = Array.from({ length: itemCount + 1 }, () =>
    new Array(budget + 1).fill(0)
  );

  for (let itemIndex = 1; itemIndex <= itemCount; itemIndex++) {
    const { Duration, Impact } = orderedVehicles[itemIndex - 1];

    for (let capacity = 0; capacity <= budget; capacity++) {
      dp[itemIndex][capacity] = dp[itemIndex - 1][capacity];

      if (Duration <= capacity) {
        dp[itemIndex][capacity] = Math.max(
          dp[itemIndex][capacity],
          dp[itemIndex - 1][capacity - Duration] + Impact
        );
      }
    }
  }

  const selected: string[] = [];
  let remainingCapacity = budget;

  for (let itemIndex = itemCount; itemIndex >= 1; itemIndex--) {
    if (dp[itemIndex][remainingCapacity] !== dp[itemIndex - 1][remainingCapacity]) {
      const vehicle = orderedVehicles[itemIndex - 1];
      selected.push(vehicle.TaskID);
      remainingCapacity -= vehicle.Duration;
    }
  }

  selected.reverse();

  return {
    selected,
    impact: dp[itemCount][budget],
    duration: budget - remainingCapacity,
  };
}

async function fetchDepots(token: string): Promise<Depot[]> {
  await Log("backend", "info", "service", "Fetching depots from evaluation API");
  const response = await axios.get(`${BASE_URL}/depots`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const depots = response.data.depots as Depot[];
  await Log("backend", "info", "service", `Fetched ${depots.length} depots`);
  return depots;
}

async function fetchVehicles(token: string): Promise<Vehicle[]> {
  await Log("backend", "info", "service", "Fetching vehicles from evaluation API");
  const response = await axios.get(`${BASE_URL}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const vehicles = response.data.vehicles as Vehicle[];
  await Log("backend", "info", "service", `Fetched ${vehicles.length} vehicles`);
  return vehicles;
}

export async function runScheduler(): Promise<ScheduleResult[]> {
  await Log("backend", "info", "handler", "Vehicle maintenance scheduler started");
  const token = requireAuthToken();

  let depots: Depot[];
  let vehicles: Vehicle[];

  try {
    [depots, vehicles] = await Promise.all([fetchDepots(token), fetchVehicles(token)]);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    await Log("backend", "fatal", "handler", `Failed to fetch scheduler data: ${detail}`);
    throw error;
  }

  const results: ScheduleResult[] = [];

  for (const depot of [...depots].sort((left, right) => left.ID - right.ID)) {
    await Log(
      "backend",
      "debug",
      "domain",
      `Running knapsack for depot ${depot.ID}, budget=${depot.MechanicHours}h`
    );

    const { selected, impact, duration } = knapsack(vehicles, depot.MechanicHours);
    const result: ScheduleResult = {
      depotID: depot.ID,
      mechanicHours: depot.MechanicHours,
      selectedTasks: selected,
      totalImpact: impact,
      totalDuration: duration,
    };

    results.push(result);

    await Log(
      "backend",
      "info",
      "domain",
      `Depot ${depot.ID}: selected ${selected.length} tasks, impact=${impact}, duration=${duration}/${depot.MechanicHours}h`
    );
  }

  await Log("backend", "info", "handler", `Scheduler complete — processed ${depots.length} depots`);
  return results;
}

async function main(): Promise<void> {
  try {
    const results = await runScheduler();
    console.log("\n=== SCHEDULER RESULTS ===");
    console.log(JSON.stringify(results, null, 2));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Scheduler failed: ${detail}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

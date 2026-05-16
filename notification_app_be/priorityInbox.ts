import axios from "axios";
import { Log } from "../logging_middleware/logger";

const BASE_URL = "http://4.224.186.213/evaluation-service";

export interface Notification {
  ID: string;
  Type: "Placement" | "Result" | "Event";
  Message: string;
  Timestamp: string;
}

export interface ScoredNotification extends Notification {
  score: number;
}

const TYPE_WEIGHT: Record<Notification["Type"], number> = {
  Placement: 100,
  Result: 50,
  Event: 10,
};

function requireAuthToken(): string {
  const token = process.env.AUTH_TOKEN?.trim();
  if (!token) {
    throw new Error("AUTH_TOKEN is required. Set it before running the priority inbox.");
  }
  return token;
}

export function recencyScore(timestamp: string, now = Date.now()): number {
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const ageHours = Math.max(0, now - parsed) / (1000 * 60 * 60);
  return Math.max(0, 100 - Math.log1p(ageHours) * 10);
}

export function computeScore(notification: Notification, now = Date.now()): number {
  return TYPE_WEIGHT[notification.Type] + recencyScore(notification.Timestamp, now);
}

function comparePriority(left: ScoredNotification, right: ScoredNotification): number {
  if (left.score !== right.score) {
    return left.score - right.score;
  }

  const leftTimestamp = new Date(left.Timestamp).getTime();
  const rightTimestamp = new Date(right.Timestamp).getTime();
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  return right.ID.localeCompare(left.ID);
}

class MinHeap<T> {
  private readonly heap: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  size(): number {
    return this.heap.length;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  push(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }

    const min = this.heap[0];
    const last = this.heap.pop()!;

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }

    return min;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[parent], this.heap[index]) <= 0) {
        break;
      }
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;

      if (left < this.heap.length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }

      if (
        right < this.heap.length &&
        this.compare(this.heap[right], this.heap[smallest]) < 0
      ) {
        smallest = right;
      }

      if (smallest === index) {
        break;
      }

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

function normalizeTopN(topN: number): number {
  if (!Number.isInteger(topN) || topN < 1) {
    return 10;
  }
  return topN;
}

export function getTopN(
  notifications: Notification[],
  requestedTopN: number,
  now = Date.now()
): ScoredNotification[] {
  const topN = normalizeTopN(requestedTopN);
  const heap = new MinHeap<ScoredNotification>(comparePriority);

  for (const notification of notifications) {
    const scored: ScoredNotification = {
      ...notification,
      score: computeScore(notification, now),
    };

    if (heap.size() < topN) {
      heap.push(scored);
      continue;
    }

    const lowest = heap.peek();
    if (lowest && comparePriority(scored, lowest) > 0) {
      heap.pop();
      heap.push(scored);
    }
  }

  const result: ScoredNotification[] = [];
  while (heap.size() > 0) {
    result.push(heap.pop()!);
  }

  return result.sort((left, right) => comparePriority(right, left));
}

export async function runPriorityInbox(requestedTopN = 10): Promise<ScoredNotification[]> {
  const topN = normalizeTopN(requestedTopN);
  await Log("backend", "info", "handler", `Priority inbox started — fetching top ${topN} notifications`);
  const token = requireAuthToken();

  let notifications: Notification[];

  try {
    const response = await axios.get(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    notifications = response.data.notifications as Notification[];
    await Log("backend", "info", "service", `Fetched ${notifications.length} total notifications`);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    await Log("backend", "fatal", "handler", `Failed to fetch notifications: ${detail}`);
    throw error;
  }

  const topNotifications = getTopN(notifications, topN);
  await Log("backend", "info", "domain", `Computed top ${topN} by weight+recency scoring`);
  await Log(
    "backend",
    "info",
    "handler",
    `Priority inbox complete — returned ${topNotifications.length} notifications`
  );
  return topNotifications;
}

async function main(): Promise<void> {
  const requestedTopN = Number.parseInt(process.argv[2] ?? "10", 10);

  try {
    const topNotifications = await runPriorityInbox(requestedTopN);

    console.log(`\n=== TOP ${topNotifications.length} PRIORITY NOTIFICATIONS ===\n`);
    topNotifications.forEach((notification, index) => {
      console.log(
        `${index + 1}. [${notification.Type.padEnd(9)}] score=${notification.score.toFixed(2)} | ${notification.Timestamp} | ${notification.Message}`
      );
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Priority inbox failed: ${detail}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

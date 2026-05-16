import assert from "node:assert/strict";
import { getTopN, recencyScore, type Notification } from "./priorityInbox";

const now = new Date("2026-05-16T12:00:00.000Z").getTime();
const notifications: Notification[] = [
  {
    ID: "event-1",
    Type: "Event",
    Message: "Club fair",
    Timestamp: "2026-05-16T11:00:00.000Z",
  },
  {
    ID: "placement-1",
    Type: "Placement",
    Message: "Drive opens",
    Timestamp: "2026-05-15T12:00:00.000Z",
  },
  {
    ID: "result-1",
    Type: "Result",
    Message: "Semester result",
    Timestamp: "2026-05-16T10:00:00.000Z",
  },
];

assert.deepEqual(
  getTopN(notifications, 2, now).map((notification) => notification.ID),
  ["placement-1", "result-1"]
);

assert.deepEqual(getTopN([], 10, now), []);

assert.deepEqual(
  getTopN(
    [
      {
        ID: "b",
        Type: "Result",
        Message: "Same score",
        Timestamp: "2026-05-16T10:00:00.000Z",
      },
      {
        ID: "a",
        Type: "Result",
        Message: "Same score",
        Timestamp: "2026-05-16T10:00:00.000Z",
      },
    ],
    5,
    now
  ).map((notification) => notification.ID),
  ["a", "b"]
);

assert.equal(recencyScore("not-a-date", now), 0);
assert.equal(getTopN(notifications, 99, now).length, 3);
assert.equal(getTopN(notifications, 0, now).length, 3);

console.log("priority inbox tests passed");

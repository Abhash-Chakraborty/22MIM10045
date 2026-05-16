import assert from "node:assert/strict";
import { knapsack } from "./scheduler";

const vehicles = [
  { TaskID: "A", Duration: 2, Impact: 6 },
  { TaskID: "B", Duration: 2, Impact: 6 },
  { TaskID: "C", Duration: 3, Impact: 7 },
];

assert.deepEqual(knapsack(vehicles, 4), {
  selected: ["A", "B"],
  impact: 12,
  duration: 4,
});

assert.deepEqual(knapsack(vehicles, 0), {
  selected: [],
  impact: 0,
  duration: 0,
});

assert.deepEqual(
  knapsack(
    [
      { TaskID: "Z", Duration: 1, Impact: 5 },
      { TaskID: "A", Duration: 1, Impact: 5 },
    ],
    1
  ),
  {
    selected: ["A"],
    impact: 5,
    duration: 1,
  }
);

assert.throws(() => knapsack(vehicles, -1), /non-negative integer/);

console.log("scheduler tests passed");

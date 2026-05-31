import type { Priority, Task } from "./types.js";

const RANK: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2
};

/** Lower rank sorts first (high priority before low). */
export function comparePriority(a: Priority, b: Priority): number {
  return RANK[a] - RANK[b];
}

/** Return a new array sorted by priority (high → low), then by creation time. */
export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const byPriority = comparePriority(a.priority, b.priority);
    if (byPriority !== 0) return byPriority;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

import { TaskStore } from "./task-store.js";

export { TaskStore } from "./task-store.js";
export { sortByPriority, comparePriority } from "./priority.js";
export type { Task, NewTask, Priority } from "./types.js";

// Tiny demo so `pnpm demo` (or `tsx src/index.ts`) prints something useful.
if (import.meta.url === `file://${process.argv[1]}`) {
  const store = new TaskStore();
  store.add({ title: "Write the walkthrough", priority: "high" });
  store.add({ title: "Refactor the priority sort", priority: "low" });
  store.add({ title: "Add a CLI", priority: "medium" });
  store.complete(2);

  console.log("Pending tasks (highest priority first):");
  for (const task of store.pending()) {
    console.log(`  [${task.priority}] ${task.title}`);
  }
}

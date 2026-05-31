import type { NewTask, Task } from "./types.js";
import { sortByPriority } from "./priority.js";

/** A minimal in-memory task store with stable, sequential ids. */
export class TaskStore {
  private tasks = new Map<number, Task>();
  private nextId = 1;

  add(input: NewTask): Task {
    const task: Task = {
      id: this.nextId++,
      title: input.title,
      priority: input.priority ?? "medium",
      done: false,
      createdAt: new Date().toISOString()
    };
    this.tasks.set(task.id, task);
    return task;
  }

  complete(id: number): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.done = true;
    return task;
  }

  remove(id: number): boolean {
    return this.tasks.delete(id);
  }

  /** Open tasks, highest priority first. */
  pending(): Task[] {
    return sortByPriority([...this.tasks.values()].filter((t) => !t.done));
  }

  all(): Task[] {
    return sortByPriority([...this.tasks.values()]);
  }
}

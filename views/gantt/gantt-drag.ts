import type { Task } from "../../shared/contract.js";

export type GanttBarDragMode = "move" | "resize-start" | "resize-end";

export interface GanttDragDateRange {
  start: string;
  end: string;
  days: readonly string[];
}

export interface GanttTaskDates {
  startDate: string;
  dueDate: string;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateValue(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function dayDifference(from: string, to: string): number | null {
  const first = dateValue(from);
  const second = dateValue(to);
  if (first === null || second === null) return null;
  return Math.round((second - first) / DAY_MS);
}

function isoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Create an inclusive date range by dragging across empty timeline days. */
export function ganttDatesFromCreate(
  task: Task,
  range: GanttDragDateRange,
  startIndex: number,
  endIndex: number,
): GanttTaskDates | null {
  if (task.startDate !== null || task.dueDate !== null) return null;
  const first = Math.min(startIndex, endIndex);
  const last = Math.max(startIndex, endIndex);
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(last) ||
    first < 0 ||
    last >= range.days.length
  ) {
    return null;
  }
  return { startDate: range.days[first]!, dueDate: range.days[last]! };
}

/** Convert a whole-day drag delta into an inclusive task date range. */
export function ganttDatesFromDrag(
  task: Task,
  range: GanttDragDateRange,
  mode: GanttBarDragMode,
  deltaDays: number,
): GanttTaskDates | null {
  const rangeDuration = dayDifference(range.start, range.end);
  if (range.days.length === 0 || rangeDuration === null || rangeDuration < 0) {
    return null;
  }
  if (task.startDate === null || task.dueDate === null) return null;

  const start = dateValue(task.startDate);
  const due = dateValue(task.dueDate);
  if (start === null || due === null || due < start) return null;
  if (!Number.isFinite(deltaDays)) return null;
  const delta = Math.trunc(deltaDays);

  if (mode === "move") {
    return {
      startDate: isoDate(start + delta * DAY_MS),
      dueDate: isoDate(due + delta * DAY_MS),
    };
  }

  if (mode === "resize-start") {
    return {
      startDate: isoDate(Math.min(start + delta * DAY_MS, due)),
      dueDate: task.dueDate,
    };
  }

  return {
    startDate: task.startDate,
    dueDate: isoDate(Math.max(due + delta * DAY_MS, start)),
  };
}

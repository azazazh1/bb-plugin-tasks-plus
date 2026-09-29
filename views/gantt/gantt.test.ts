import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import {
  filterGanttTasks,
  flattenGanttRows,
  ganttBar,
  expandGanttDateRange,
  ganttDateRange,
  ganttPaddedDateRange,
  ganttProjectBar,
  ganttDefaultDateRange,
  groupGanttTasks,
} from "./index.js";
import { ganttDatesFromCreate, ganttDatesFromDrag } from "./gantt-drag.js";

const IDS = [
  "01HZZZZZZZZZZZZZZZZZZZZZ01",
  "01HZZZZZZZZZZZZZZZZZZZZZ02",
  "01HZZZZZZZZZZZZZZZZZZZZZ03",
  "01HZZZZZZZZZZZZZZZZZZZZZ04",
] as const;

function task(
  number: number,
  overrides: Partial<Task> = {},
): Task {
  return {
    id: IDS[number - 1]!,
    projectId: IDS[0]!,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    startDate: null,
    dueDate: null,
    parentTaskId: null,
    position: number,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

describe("Gantt calculations", () => {
  it("filters tasks by status while treating an empty selection as all statuses", () => {
    const tasks = [
      task(1, { status: "todo" }),
      task(2, { status: "done" }),
      task(3, { status: "clarification" }),
    ];

    expect(
      filterGanttTasks(tasks, ["done", "clarification"]).map((item) => item.key),
    ).toEqual(["TSK-2", "TSK-3"]);
    expect(filterGanttTasks(tasks, [])).toEqual(tasks);
    expect(filterGanttTasks(tasks, [], true)).toEqual(tasks);
    expect(
      filterGanttTasks(tasks, ["done"], true).map((item) => item.key),
    ).toEqual(["TSK-1", "TSK-3"]);
  });
  it("groups all-project tasks in project order and keeps unknown projects", () => {
    const projectA = { id: IDS[0]!, name: "Alpha", prefix: "AAA", nextTaskNumber: 2, color: "blue", folderId: null, linkedBbProjectId: null, createdAt: "2026-08-01T00:00:00.000Z" };
    const projectB = { id: IDS[1]!, name: "Beta", prefix: "BBB", nextTaskNumber: 2, color: "green", folderId: null, linkedBbProjectId: null, createdAt: "2026-08-01T00:00:00.000Z" };
    const groups = groupGanttTasks(
      [
        task(2, { projectId: IDS[1]! }),
        task(1, { projectId: IDS[0]! }),
        task(3, { projectId: IDS[2]! }),
      ],
      [projectB, projectA],
      null,
    );
    expect(groups.map((group) => [group.projectId, group.tasks.length])).toEqual([
      [IDS[1], 1],
      [IDS[0], 1],
      [IDS[2], 1],
    ]);
    expect(groups[2]!.project).toBeUndefined();
  });

  it("provides a stable calendar for drawing the first schedule", () => {
    const range = ganttDefaultDateRange(new Date("2026-08-15T12:00:00.000Z"));
    expect(range.days).toHaveLength(91);
    expect(range.start).toBe("2026-08-01");
    expect(range.end).toBe("2026-10-30");
  });

  it("expands the timeline by whole days without changing existing dates", () => {
    const range = {
      start: "2026-08-03",
      end: "2026-08-05",
      days: ["2026-08-03", "2026-08-04", "2026-08-05"],
    };
    expect(expandGanttDateRange(range, 2, 3)).toMatchObject({
      start: "2026-08-01",
      end: "2026-08-08",
      days: [
        "2026-08-01",
        "2026-08-02",
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
      ],
    });
  });

  it("pads a scheduled range for scrolling and drawing", () => {
    const range = ganttPaddedDateRange(
      [task(1, { startDate: "2026-08-03", dueDate: "2026-08-05" })],
      2,
    )!;
    expect(range.start).toBe("2026-08-01");
    expect(range.end).toBe("2026-08-07");
  });

  it("uses the inclusive range of scheduled tasks", () => {
    const range = ganttDateRange([
      task(1, { startDate: "2026-08-03", dueDate: "2026-08-05" }),
      task(2, { startDate: "2026-08-06", dueDate: "2026-08-08" }),
      task(3, { dueDate: "2026-08-10" }),
    ]);
    expect(range).toMatchObject({
      start: "2026-08-03",
      end: "2026-08-08",
      days: [
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
      ],
    });
  });

  it("places a task at its start day and gives a one-day task a non-zero bar", () => {
    const range = ganttDateRange([
      task(1, { startDate: "2026-08-03", dueDate: "2026-08-08" }),
    ])!;
    expect(ganttBar(task(1, { startDate: "2026-08-05", dueDate: "2026-08-05" }), range)).toMatchObject({
      left: expect.closeTo(33.33333333333333, 10),
      width: expect.closeTo(16.666666666666664, 10),
      startIndex: 2,
      duration: 1,
    });
  });

  it("does not create a bar until both dates are set", () => {
    const range = ganttDateRange([
      task(1, { startDate: "2026-08-03", dueDate: "2026-08-05" }),
    ])!;
    expect(ganttBar(task(2, { dueDate: "2026-08-05" }), range)).toBeNull();
    expect(ganttDateRange([task(2, { startDate: "2026-08-03" })])).toBeNull();
  });

  it("creates a one-day or multi-day span in either drag direction", () => {
    const item = task(1);
    const range = {
      start: "2026-08-03",
      end: "2026-08-08",
      days: [
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
      ],
    };
    expect(ganttDatesFromCreate(item, range, 1, 4)).toEqual({
      startDate: "2026-08-04",
      dueDate: "2026-08-07",
    });
    expect(ganttDatesFromCreate(item, range, 4, 1)).toEqual({
      startDate: "2026-08-04",
      dueDate: "2026-08-07",
    });
    expect(ganttDatesFromCreate(task(1, { startDate: "2026-08-04" }), range, 1, 2)).toBeNull();
  });

  it("moves a task while preserving its inclusive duration", () => {
    const item = task(1, { startDate: "2026-08-03", dueDate: "2026-08-05" });
    const range = ganttDateRange([item])!;
    expect(ganttDatesFromDrag(item, range, "move", 3)).toEqual({
      startDate: "2026-08-06",
      dueDate: "2026-08-08",
    });
  });

  it("resizes either edge without allowing the dates to cross", () => {
    const item = task(1, { startDate: "2026-08-03", dueDate: "2026-08-05" });
    const range = ganttDateRange([item])!;
    expect(ganttDatesFromDrag(item, range, "resize-start", 10)).toEqual({
      startDate: "2026-08-05",
      dueDate: "2026-08-05",
    });
    expect(ganttDatesFromDrag(item, range, "resize-end", -10)).toEqual({
      startDate: "2026-08-03",
      dueDate: "2026-08-03",
    });
  });

  it("keeps a one-day task valid when resizing beyond its only day", () => {
    const item = task(1, { startDate: "2026-08-03", dueDate: "2026-08-03" });
    const range = ganttDateRange([item])!;
    expect(ganttDatesFromDrag(item, range, "resize-start", 2)).toEqual({
      startDate: "2026-08-03",
      dueDate: "2026-08-03",
    });
    expect(ganttDatesFromDrag(item, range, "resize-end", -2)).toEqual({
      startDate: "2026-08-03",
      dueDate: "2026-08-03",
    });
  });

  it("returns null for unscheduled or invalid ranges", () => {
    const item = task(1, { startDate: "2026-08-03" });
    expect(
      ganttDatesFromDrag(
        item,
        { start: "2026-08-03", end: "2026-08-03", days: ["2026-08-03"] },
        "move",
        1,
      ),
    ).toBeNull();
    expect(
      ganttDatesFromDrag(
        task(1, { startDate: "2026-08-05", dueDate: "2026-08-03" }),
        { start: "2026-08-03", end: "2026-08-05", days: ["2026-08-03", "2026-08-04", "2026-08-05"] },
        "move",
        1,
      ),
    ).toBeNull();
    expect(
      ganttDatesFromDrag(
        task(1, { startDate: "2026-08-03", dueDate: "2026-08-03" }),
        { start: "2026-08-05", end: "2026-08-03", days: [] },
        "move",
        1,
      ),
    ).toBeNull();
  });

  it("uses the same validated bounds for task and project bars", () => {
    const item = task(1, { startDate: "2026-08-03", dueDate: "2026-08-08" });
    const range = ganttDateRange([item])!;
    expect(ganttProjectBar([item], range)).toEqual(ganttBar(item, range));
  });

  it("keeps project and task bars aligned after a task grows beyond its old range", () => {
    const before = task(1, { startDate: "2026-08-03", dueDate: "2026-08-05" });
    const beforeRange = ganttDateRange([before])!;
    const expanded = {
      ...before,
      startDate: "2026-08-03",
      dueDate: "2026-08-08",
    };
    const expandedRange = ganttDateRange([expanded])!;

    expect(ganttProjectBar([expanded], expandedRange)).toEqual(
      ganttBar(expanded, expandedRange),
    );
    expect(expandedRange.end).not.toBe(beforeRange.end);
  });

  it("keeps a valid preview bar outside the committed range", () => {
    const committed = task(1, { startDate: "2026-08-03", dueDate: "2026-08-05" });
    const preview = {
      ...committed,
      startDate: "2026-08-06",
      dueDate: "2026-08-08",
    };
    const range = ganttDateRange([committed])!;

    expect(ganttBar(preview, range)).toMatchObject({
      left: expect.closeTo(100, 10),
      width: expect.closeTo(100, 10),
    });
    expect(ganttProjectBar([preview], range)).toEqual(ganttBar(preview, range));
  });

  it("ignores invalid scheduled data for both the range and project bar", () => {
    const invalid = task(1, { startDate: "2026-08-10", dueDate: "2026-08-03" });
    const valid = task(2, { startDate: "2026-08-05", dueDate: "2026-08-07" });
    const range = ganttDateRange([invalid, valid])!;
    expect(range).toMatchObject({ start: "2026-08-05", end: "2026-08-07" });
    expect(ganttProjectBar([invalid, valid], range)).toEqual(ganttBar(valid, range));
  });

  it("flattens parent tasks before their nested children", () => {
    const rows = flattenGanttRows([
      task(2, { parentTaskId: IDS[0] }),
      task(1),
      task(4, { parentTaskId: IDS[0] }),
      task(3, { parentTaskId: IDS[0] }),
    ]);
    expect(rows.map((row) => [row.task.key, row.depth])).toEqual([
      ["TSK-1", 0],
      ["TSK-2", 1],
      ["TSK-4", 1],
      ["TSK-3", 1],
    ]);
  });
});

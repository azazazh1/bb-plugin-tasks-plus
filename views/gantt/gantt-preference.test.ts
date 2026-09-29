// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GANTT_PREFERENCE,
  GANTT_MAX_TASK_COLUMN_WIDTH,
  GANTT_MIN_TASK_COLUMN_WIDTH,
  GANTT_PREFERENCE_STORAGE_KEY,
  clampTaskColumnWidth,
  loadGanttPreference,
  sanitizeGanttPreference,
  storeGanttPreference,
} from "./gantt-preference.js";

describe("Gantt preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses defaults and clamps an invalid saved width", () => {
    expect(sanitizeGanttPreference(null)).toEqual(DEFAULT_GANTT_PREFERENCE);
    expect(
      sanitizeGanttPreference({
        taskColumnWidth: GANTT_MAX_TASK_COLUMN_WIDTH + 100,
        titleMode: "wrap",
      }),
    ).toEqual({
      taskColumnWidth: GANTT_MAX_TASK_COLUMN_WIDTH,
      titleMode: "wrap",
    });
    expect(clampTaskColumnWidth(GANTT_MIN_TASK_COLUMN_WIDTH - 1)).toBe(
      GANTT_MIN_TASK_COLUMN_WIDTH,
    );
  });

  it("persists preferences per project", () => {
    storeGanttPreference("project-a", {
      taskColumnWidth: 420,
      titleMode: "wrap",
    });
    storeGanttPreference("project-b", DEFAULT_GANTT_PREFERENCE);

    expect(loadGanttPreference("project-a")).toEqual({
      taskColumnWidth: 420,
      titleMode: "wrap",
    });
    expect(loadGanttPreference("project-b")).toEqual(DEFAULT_GANTT_PREFERENCE);
    expect(
      JSON.parse(window.localStorage.getItem(GANTT_PREFERENCE_STORAGE_KEY)!),
    ).toMatchObject({
      version: 1,
      projects: {
        "project-a": { taskColumnWidth: 420, titleMode: "wrap" },
      },
    });
  });

  it("falls back safely for malformed storage", () => {
    window.localStorage.setItem(GANTT_PREFERENCE_STORAGE_KEY, "{bad");
    expect(loadGanttPreference("project-a")).toEqual(DEFAULT_GANTT_PREFERENCE);
  });
});

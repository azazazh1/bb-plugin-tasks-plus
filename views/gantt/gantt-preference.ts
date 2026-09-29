export type GanttTitleMode = "truncate" | "wrap";

export interface GanttPreference {
  taskColumnWidth: number;
  titleMode: GanttTitleMode;
}

export const GANTT_PREFERENCE_STORAGE_KEY = "bb-tasks-plus:gantt-preferences";
export const GANTT_PREFERENCE_VERSION = 1 as const;
export const DEFAULT_GANTT_PREFERENCE: GanttPreference = {
  taskColumnWidth: 256,
  titleMode: "truncate",
};
export const GANTT_MIN_TASK_COLUMN_WIDTH = 180;
export const GANTT_MAX_TASK_COLUMN_WIDTH = 640;

interface ParsedStorage {
  projects: Record<string, unknown>;
  isFutureVersion: boolean;
}

interface StoredDocumentV1 {
  version: typeof GANTT_PREFERENCE_VERSION;
  projects: Record<string, unknown>;
}

function asTitleMode(value: unknown): GanttTitleMode | null {
  return value === "truncate" || value === "wrap" ? value : null;
}

export function clampTaskColumnWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GANTT_PREFERENCE.taskColumnWidth;
  return Math.round(
    Math.min(GANTT_MAX_TASK_COLUMN_WIDTH, Math.max(GANTT_MIN_TASK_COLUMN_WIDTH, value)),
  );
}

export function sanitizeGanttPreference(raw: unknown): GanttPreference {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_GANTT_PREFERENCE };
  }
  const record = raw as Record<string, unknown>;
  const taskColumnWidth =
    typeof record.taskColumnWidth === "number"
      ? clampTaskColumnWidth(record.taskColumnWidth)
      : DEFAULT_GANTT_PREFERENCE.taskColumnWidth;
  return {
    taskColumnWidth,
    titleMode: asTitleMode(record.titleMode) ?? DEFAULT_GANTT_PREFERENCE.titleMode,
  };
}

function readStorage(): ParsedStorage | null {
  try {
    const raw = window.localStorage.getItem(GANTT_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.projects === null ||
      typeof record.projects !== "object" ||
      Array.isArray(record.projects)
    ) {
      return null;
    }
    const version =
      typeof record.version === "number" && Number.isFinite(record.version)
        ? record.version
        : null;
    if (version !== null && version < GANTT_PREFERENCE_VERSION) return null;
    return {
      projects: record.projects as Record<string, unknown>,
      isFutureVersion: version !== null && version > GANTT_PREFERENCE_VERSION,
    };
  } catch {
    return null;
  }
}

export function loadGanttPreference(projectId: string): GanttPreference {
  const document = readStorage();
  return sanitizeGanttPreference(document?.projects[projectId]);
}

export function storeGanttPreference(
  projectId: string,
  preference: GanttPreference,
): void {
  try {
    const existing = readStorage();
    if (existing?.isFutureVersion) return;
    const projects = { ...(existing?.projects ?? {}) };
    projects[projectId] = sanitizeGanttPreference(preference);
    const document: StoredDocumentV1 = {
      version: GANTT_PREFERENCE_VERSION,
      projects,
    };
    window.localStorage.setItem(
      GANTT_PREFERENCE_STORAGE_KEY,
      JSON.stringify(document),
    );
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
  }
}


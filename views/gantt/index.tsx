import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TASK_STATUSES,
  type Project,
  type Task,
  type TaskStatus,
} from "../../shared/contract.js";
import {
  listAllTasks,
  useProjects,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { StatusIcon } from "../list/icons.js";
import { STATUS_LABELS } from "../list/lib.js";
import { DelayedLoading } from "@bb/shared-ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  GANTT_MAX_TASK_COLUMN_WIDTH,
  GANTT_MIN_TASK_COLUMN_WIDTH,
  clampTaskColumnWidth,
  loadGanttPreference,
  storeGanttPreference,
  type GanttPreference,
  type GanttTitleMode,
} from "./gantt-preference.js";
import {
  ganttDatesFromCreate,
  ganttDatesFromDrag,
  type GanttBarDragMode,
  type GanttTaskDates,
} from "./gantt-drag.js";

const GANTT_DAY_WIDTH = 44;
const GANTT_INITIAL_PADDING_DAYS = 30;
const GANTT_EDGE_TRIGGER_DAYS = 14;
const GANTT_EXTENSION_DAYS = 90;

export interface GanttRow { task: Task; depth: number; }
export interface GanttDateRange { start: string; end: string; days: string[]; }
export interface GanttBar {
  left: number;
  width: number;
  startIndex: number;
  duration: number;
}

export function filterGanttTasks(
  tasks: readonly Task[],
  statuses: readonly TaskStatus[],
  exclude = false,
): Task[] {
  if (statuses.length === 0) return [...tasks];
  const selected = new Set(statuses);
  return tasks.filter((task) =>
    exclude ? !selected.has(task.status) : selected.has(task.status),
  );
}

export function flattenGanttRows(tasks: readonly Task[]): GanttRow[] {
  const known = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.parentTaskId === null || !known.has(task.parentTaskId)) continue;
    children.set(task.parentTaskId, [
      ...(children.get(task.parentTaskId) ?? []),
      task,
    ]);
  }
  const roots = tasks.filter(
    (task) => task.parentTaskId === null || !known.has(task.parentTaskId),
  );
  const rows: GanttRow[] = [];
  const visited = new Set<string>();
  const visit = (task: Task, depth: number, trail: Set<string>) => {
    if (visited.has(task.id) || trail.has(task.id)) return;
    visited.add(task.id);
    rows.push({ task, depth });
    const nextTrail = new Set(trail);
    nextTrail.add(task.id);
    for (const child of children.get(task.id) ?? []) {
      visit(child, depth + 1, nextTrail);
    }
  };
  for (const root of roots) visit(root, 0, new Set());
  for (const task of tasks) {
    if (!visited.has(task.id)) visit(task, 0, new Set());
  }
  return rows;
}

function dateValue(value: string): number | null {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? null : parsed;
}
function dayDifference(from: string, to: string): number | null {
  const first = dateValue(from);
  const second = dateValue(to);
  if (first === null || second === null) return null;
  return Math.round((second - first) / 86_400_000);
}
interface GanttTaskSpan {
  start: string;
  end: string;
}

function scheduledTaskSpan(task: Task): GanttTaskSpan | null {
  if (task.startDate === null || task.dueDate === null) return null;
  const duration = dayDifference(task.startDate, task.dueDate);
  if (duration === null || duration < 0) return null;
  return { start: task.startDate, end: task.dueDate };
}

function scheduledTaskSpans(tasks: readonly Task[]): GanttTaskSpan[] {
  return tasks.flatMap((task) => {
    const span = scheduledTaskSpan(task);
    return span === null ? [] : [span];
  });
}

function spanBounds(spans: readonly GanttTaskSpan[]): GanttTaskSpan | null {
  if (spans.length === 0) return null;
  return {
    start: spans.reduce(
      (value, span) => (span.start < value ? span.start : value),
      spans[0]!.start,
    ),
    end: spans.reduce(
      (value, span) => (span.end > value ? span.end : value),
      spans[0]!.end,
    ),
  };
}

function isoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function dateRangeFromBounds(start: string, end: string): GanttDateRange {
  const days = Array.from(
    { length: (dayDifference(start, end) ?? 0) + 1 },
    (_, index) => isoDate(dateValue(start)! + index * 86_400_000),
  );
  return { start, end, days };
}

function mergeGanttDateRanges(
  first: GanttDateRange,
  second: GanttDateRange,
): GanttDateRange {
  return dateRangeFromBounds(
    first.start < second.start ? first.start : second.start,
    first.end > second.end ? first.end : second.end,
  );
}

export function ganttDateRange(tasks: readonly Task[]): GanttDateRange | null {
  const bounds = spanBounds(scheduledTaskSpans(tasks));
  return bounds === null ? null : dateRangeFromBounds(bounds.start, bounds.end);
}

export function expandGanttDateRange(
  range: GanttDateRange,
  beforeDays: number,
  afterDays: number,
): GanttDateRange {
  const before = Math.max(0, Math.trunc(beforeDays));
  const after = Math.max(0, Math.trunc(afterDays));
  return dateRangeFromBounds(
    isoDate(dateValue(range.start)! - before * 86_400_000),
    isoDate(dateValue(range.end)! + after * 86_400_000),
  );
}

export function ganttPaddedDateRange(
  tasks: readonly Task[],
  paddingDays = GANTT_INITIAL_PADDING_DAYS,
): GanttDateRange | null {
  const range = ganttDateRange(tasks);
  return range === null
    ? null
    : expandGanttDateRange(range, paddingDays, paddingDays);
}

export function ganttDefaultDateRange(today = new Date()): GanttDateRange {
  const startValue =
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
    14 * 86_400_000;
  const days = Array.from({ length: 91 }, (_, index) =>
    isoDate(startValue + index * 86_400_000),
  );
  return { start: days[0]!, end: days[days.length - 1]!, days };
}

export function ganttBar(task: Task, range: GanttDateRange): GanttBar | null {
  const span = scheduledTaskSpan(task);
  if (span === null) return null;
  const startIndex = dayDifference(range.start, span.start);
  const duration = dayDifference(span.start, span.end);
  if (startIndex === null || duration === null || duration < 0) {
    return null;
  }
  return {
    left: (startIndex / range.days.length) * 100,
    width: ((duration + 1) / range.days.length) * 100,
    startIndex,
    duration: duration + 1,
  };
}

function GanttLoading() {
  return (
    <DelayedLoading>
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

function TaskColumnResizeHandle({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number, persist: boolean) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const currentWidth = useRef(width);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    currentWidth.current = width;
  }, [width]);

  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    onChange(currentWidth.current, true);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    start.current = null;
    setDragging(false);
  };

  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize task column"
      aria-valuemin={GANTT_MIN_TASK_COLUMN_WIDTH}
      aria-valuemax={GANTT_MAX_TASK_COLUMN_WIDTH}
      aria-valuenow={width}
      title="Drag to resize task column"
      className={cn(
        "absolute inset-y-0 right-0 z-10 flex w-3 translate-x-1/2 cursor-col-resize touch-none select-none items-center justify-center text-muted-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        dragging && "text-foreground",
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start.current = { x: event.clientX, width };
        currentWidth.current = width;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (start.current === null) return;
        const next = clampTaskColumnWidth(
          start.current.width + event.clientX - start.current.x,
        );
        currentWidth.current = next;
        onChange(next, false);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={(event) => {
        if (start.current !== null) finish(event);
      }}
      onKeyDown={(event) => {
        let next: number | null = null;
        if (event.key === "ArrowLeft") next = width - 16;
        if (event.key === "ArrowRight") next = width + 16;
        if (event.key === "Home") next = GANTT_MIN_TASK_COLUMN_WIDTH;
        if (event.key === "End") next = GANTT_MAX_TASK_COLUMN_WIDTH;
        if (next === null) return;
        event.preventDefault();
        onChange(clampTaskColumnWidth(next), true);
      }}
    >
      <span aria-hidden className="h-8 w-px bg-border" />
    </button>
  );
}

function GanttSettings({
  titleMode,
  onTitleModeChange,
}: {
  titleMode: GanttTitleMode;
  onTitleModeChange: (mode: GanttTitleMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Gantt display settings"
          title="Gantt display settings"
        >
          <Icon name="SlidersHorizontal" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-52"
        mobileTitle="Gantt display"
      >
        <DropdownMenuLabel>Task titles</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={titleMode === "truncate"}
          onCheckedChange={(checked) => {
            if (checked === true) onTitleModeChange("truncate");
          }}
        >
          Truncate
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={titleMode === "wrap"}
          onCheckedChange={(checked) => {
            if (checked === true) onTitleModeChange("wrap");
          }}
        >
          Wrap to multiple lines
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function GanttStatusFilter({
  statuses,
  exclude,
  onChange,
  onExcludeChange,
}: {
  statuses: readonly TaskStatus[];
  exclude: boolean;
  onChange: (statuses: TaskStatus[]) => void;
  onExcludeChange: (exclude: boolean) => void;
}) {
  const keepOpen = (event: Event) => event.preventDefault();
  const active = statuses.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs",
            active
              ? "border-border bg-secondary text-foreground"
              : "border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground",
          )}
          aria-label="Filter Gantt tasks by status"
          title="Filter tasks by status"
        >
          <StatusIcon status="todo" className="size-3" />
          Status
          {active ? (
            <span className="max-w-48 truncate font-medium">
              {exclude ? "Not " : ""}{statuses.map((status) => STATUS_LABELS[status]).join(", ")}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-48"
        mobileTitle="Filter by status"
      >
        <DropdownMenuLabel>Task status</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={exclude}
          disabled={!active}
          onSelect={keepOpen}
          onCheckedChange={(checked) => onExcludeChange(checked === true)}
        >
          Not
        </DropdownMenuCheckboxItem>
        {TASK_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={statuses.includes(status)}
            onSelect={keepOpen}
            onCheckedChange={(checked) => {
              const next = checked
                ? [...statuses, status]
                : statuses.filter((existing) => existing !== status);
              onChange([...new Set(next)]);
            }}
          >
            <span className="flex items-center gap-2">
              <StatusIcon status={status} className="size-3" />
              {STATUS_LABELS[status]}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


function Timeline({
  range,
  bar,
  task,
  disabled = false,
  onPreviewDates,
  onResetPreview,
  onCommitDates,
  projectBar = false,
}: {
  range: GanttDateRange;
  bar: GanttBar | null;
  task?: Task;
  disabled?: boolean;
  onPreviewDates?: (taskId: string, dates: GanttTaskDates) => void;
  onResetPreview?: (taskId: string) => void;
  onCommitDates?: (taskId: string, dates: GanttTaskDates) => void;
  projectBar?: boolean;
}) {
  const width = range.days.length * GANTT_DAY_WIDTH;
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    task: Task;
    range: GanttDateRange;
    mode: GanttBarDragMode | "create";
    startX: number;
    startIndex: number;
    dayWidth: number;
    deltaDays: number;
    initialDates: GanttTaskDates;
    dates: GanttTaskDates;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const releasePointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    setDragging(false);
    releasePointer(event);
    if (
      drag.mode === "create" ||
      (drag.deltaDays !== 0 &&
        (drag.initialDates.startDate !== drag.dates.startDate ||
          drag.initialDates.dueDate !== drag.dates.dueDate))
    ) {
      onCommitDates?.(drag.task.id, drag.dates);
    }
  };

  const cancelDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current === null) return;
    const taskId = dragRef.current.task.id;
    dragRef.current = null;
    setDragging(false);
    releasePointer(event);
    onResetPreview?.(taskId);
  };

  const startDrag = (
    mode: GanttBarDragMode,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (
      disabled ||
      task === undefined ||
      onPreviewDates === undefined ||
      onCommitDates === undefined ||
      bar === null
    ) {
      return;
    }
    const rect = timelineRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0) return;
    const dates = ganttDatesFromDrag(task, range, mode, 0);
    if (dates === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      task,
      range,
      mode,
      startX: event.clientX,
      startIndex: 0,
      dayWidth: rect.width / range.days.length,
      deltaDays: 0,
      initialDates: dates,
      dates,
    };
    setDragging(true);
  };

  const startCreate = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (
      disabled ||
      task === undefined ||
      task.startDate !== null ||
      task.dueDate !== null ||
      onPreviewDates === undefined ||
      onCommitDates === undefined
    ) {
      return;
    }
    const rect = timelineRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0) return;
    const dayWidth = rect.width / range.days.length;
    const startIndex = Math.max(
      0,
      Math.min(range.days.length - 1, Math.floor((event.clientX - rect.left) / dayWidth)),
    );
    const dates = ganttDatesFromCreate(task, range, startIndex, startIndex);
    if (dates === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      task,
      range,
      mode: "create",
      startX: event.clientX,
      startIndex,
      dayWidth,
      deltaDays: 0,
      initialDates: dates,
      dates,
    };
    setDragging(true);
    onPreviewDates(task.id, dates);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    const deltaDays = Math.round((event.clientX - drag.startX) / drag.dayWidth);
    if (deltaDays === drag.deltaDays) return;
    const dates =
      drag.mode === "create"
        ? ganttDatesFromCreate(
            drag.task,
            drag.range,
            drag.startIndex,
            drag.startIndex + deltaDays,
          )
        : ganttDatesFromDrag(drag.task, drag.range, drag.mode, deltaDays);
    if (dates === null) return;
    drag.deltaDays = deltaDays;
    drag.dates = dates;
    onPreviewDates?.(drag.task.id, dates);
  };

  const keyboardMove = (
    mode: GanttBarDragMode,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (disabled || task === undefined || bar === null) return;
    const delta =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
    if (delta === null) return;
    const dates = ganttDatesFromDrag(task, range, mode, delta);
    if (dates === null) return;
    event.preventDefault();
    event.stopPropagation();
    onPreviewDates?.(task.id, dates);
    onCommitDates?.(task.id, dates);
  };

  return (
    <div
      ref={timelineRef}
      className="relative shrink-0"
      style={{ width: `${width}px` }}
    >
      <div className="pointer-events-none absolute inset-0 flex">
        {range.days.map((day) => (
          <span
            key={day}
            aria-hidden
            className="h-full flex-1 border-l border-border-hairline last:border-r"
          />
        ))}
      </div>
      {task !== undefined && (bar === null || dragRef.current?.mode === "create") ? (
        <button
          type="button"
          className="absolute inset-0 z-10 touch-none select-none cursor-crosshair rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Create schedule for ${task.key}`}
          title="Drag across the calendar to set start and due dates"
          disabled={disabled}
          onPointerDown={startCreate}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={finishDrag}
        />
      ) : null}
      {bar ? (
        projectBar || task === undefined || dragRef.current?.mode === "create" ? (
          <div
            className="absolute top-1/2 h-5 -translate-y-1/2 rounded-sm bg-primary/70 shadow-2xs"
            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
            title={`${task?.startDate ?? range.start} – ${task?.dueDate ?? range.end}`}
          />
        ) : (
          <div
            className={cn(
              "absolute top-1/2 h-6 -translate-y-1/2",
              disabled && "opacity-60",
            )}
            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
            role="group"
            aria-label={`${task.key}: ${task.startDate} – ${task.dueDate}`}
          >
            <button
              type="button"
              className="absolute inset-0 touch-none select-none cursor-grab rounded-sm bg-primary shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              aria-label={`Move ${task.key}, ${task.startDate} – ${task.dueDate}`}
              disabled={disabled}
              onPointerDown={(event) => startDrag("move", event)}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={finishDrag}
              onKeyDown={(event) => keyboardMove("move", event)}
            />
            <button
              type="button"
              className="absolute inset-y-0 left-0 z-10 w-2 touch-none select-none -translate-x-1/2 cursor-ew-resize rounded-l-sm bg-primary-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Change start date of ${task.key}, currently ${task.startDate}`}
              disabled={disabled}
              onPointerDown={(event) => startDrag("resize-start", event)}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={finishDrag}
              onKeyDown={(event) => keyboardMove("resize-start", event)}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 z-10 w-2 touch-none select-none translate-x-1/2 cursor-ew-resize rounded-r-sm bg-primary-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Change due date of ${task.key}, currently ${task.dueDate}`}
              disabled={disabled}
              onPointerDown={(event) => startDrag("resize-end", event)}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={finishDrag}
              onKeyDown={(event) => keyboardMove("resize-end", event)}
            />
          </div>
        )
      ) : null}
    </div>
  );
}

function formatDay(day: string, index: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: index === 0 || date.getUTCDate() === 1 ? "short" : undefined,
    timeZone: "UTC",
  }).format(date);
}

function GanttHeader({
  range,
  taskColumnWidth,
  titleMode,
  statusFilter,
  excludeStatusFilter,
  onTaskColumnWidthChange,
  onTitleModeChange,
  onStatusFilterChange,
  onExcludeStatusFilterChange,
}: {
  range: GanttDateRange;
  taskColumnWidth: number;
  titleMode: GanttTitleMode;
  statusFilter: readonly TaskStatus[];
  excludeStatusFilter: boolean;
  onTaskColumnWidthChange: (width: number, persist: boolean) => void;
  onTitleModeChange: (mode: GanttTitleMode) => void;
  onStatusFilterChange: (statuses: TaskStatus[]) => void;
  onExcludeStatusFilterChange: (exclude: boolean) => void;
}) {
  const width = range.days.length * GANTT_DAY_WIDTH;
  return (
    <div className="sticky top-0 z-20 isolate flex border-b border-border-hairline bg-background text-2xs text-muted-foreground">
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center justify-between border-r border-border bg-background px-3.5 py-2 font-medium"
        style={{ width: taskColumnWidth }}
      >
        <span>Task</span>
        <GanttStatusFilter
          statuses={statusFilter}
          exclude={excludeStatusFilter}
          onChange={onStatusFilterChange}
          onExcludeChange={onExcludeStatusFilterChange}
        />
        <GanttSettings
          titleMode={titleMode}
          onTitleModeChange={onTitleModeChange}
        />
        <TaskColumnResizeHandle
          width={taskColumnWidth}
          onChange={onTaskColumnWidthChange}
        />
      </div>
      <div
        className="grid shrink-0"
        style={{
          width: `${width}px`,
          gridTemplateColumns: `repeat(${range.days.length}, ${GANTT_DAY_WIDTH}px)`,
        }}
      >
        {range.days.map((day, index) => (
          <div key={day} className="border-l border-border-hairline px-1 py-2 text-center tabular-nums">
            {formatDay(day, index)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectLabel({
  project,
  taskColumnWidth,
  collapsible = false,
  collapsed = false,
  taskCount,
  onToggle,
}: {
  project: Project | undefined;
  taskColumnWidth: number;
  collapsible?: boolean;
  collapsed?: boolean;
  taskCount?: number;
  onToggle?: () => void;
}) {
  const content = (
    <>
      {collapsible ? (
        <Icon
          name="ChevronDown"
          className={cn("size-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
        />
      ) : null}
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: project?.color }}
      />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
        {project?.name ?? "Project"}
      </span>
      {taskCount !== undefined ? (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {taskCount}
        </span>
      ) : null}
    </>
  );
  if (onToggle !== undefined) {
    return (
      <button
        type="button"
        className="sticky left-0 z-20 flex min-w-0 shrink-0 items-center gap-2 border-r border-border bg-background px-3.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ width: taskColumnWidth }}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${project?.name ?? "Project"}`}
        onClick={onToggle}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-border bg-background px-3.5"
      style={{ width: taskColumnWidth }}
    >
      {content}
    </div>
  );
}

export interface GanttProjectGroup {
  projectId: string;
  project: Project | undefined;
  tasks: Task[];
}

export function groupGanttTasks(
  tasks: readonly Task[],
  projects: readonly Project[],
  projectId: string | null,
): GanttProjectGroup[] {
  const scopedTasks =
    projectId === null
      ? tasks
      : tasks.filter((task) => task.projectId === projectId);
  const scopedProjects =
    projectId === null
      ? projects
      : projects.filter((project) => project.id === projectId);
  const taskMap = new Map<string, Task[]>();
  for (const task of scopedTasks) {
    taskMap.set(task.projectId, [...(taskMap.get(task.projectId) ?? []), task]);
  }
  const ids = [
    ...scopedProjects.map((project) => project.id),
    ...taskMap.keys(),
  ].filter((id, index, all) => all.indexOf(id) === index);
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  return ids.map((id) => ({
    projectId: id,
    project: projectMap.get(id),
    tasks: taskMap.get(id) ?? [],
  }));
}

export function ganttProjectBar(
  tasks: readonly Task[],
  range: GanttDateRange,
): GanttBar | null {
  const bounds = spanBounds(scheduledTaskSpans(tasks));
  if (bounds === null) return null;
  const startIndex = dayDifference(range.start, bounds.start);
  const duration = dayDifference(bounds.start, bounds.end);
  if (startIndex === null || duration === null || duration < 0) {
    return null;
  }
  return {
    left: (startIndex / range.days.length) * 100,
    width: ((duration + 1) / range.days.length) * 100,
    startIndex,
    duration: duration + 1,
  };
}

function TaskRow({
  row,
  range,
  taskColumnWidth,
  titleMode,
  saving,
  onPreviewDates,
  onResetPreview,
  onCommitDates,
  onOpen,
}: {
  row: GanttRow;
  range: GanttDateRange;
  taskColumnWidth: number;
  titleMode: GanttTitleMode;
  saving: boolean;
  onPreviewDates: (taskId: string, dates: GanttTaskDates) => void;
  onResetPreview: (taskId: string) => void;
  onCommitDates: (taskId: string, dates: GanttTaskDates) => void;
  onOpen: () => void;
}) {
  const bar = ganttBar(row.task, range);
  return (
    <div
      className={cn(
        "flex min-h-10 border-b border-border-hairline",
        titleMode === "wrap" && "items-stretch",
      )}
    >
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-background px-3.5"
        style={{ width: taskColumnWidth }}
      >
        <button
          type="button"
          aria-label={`Open ${row.task.key}: ${row.task.title}`}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          style={{ paddingLeft: `${row.depth * 16}px` }}
        >
          {row.depth > 0 ? <Icon name="CornerDownRight" className="size-3 shrink-0 text-muted-foreground" /> : null}
          <StatusIcon status={row.task.status} />
          <span
            className={cn(
              "min-w-0 flex-1 text-sm",
              titleMode === "truncate"
                ? "truncate"
                : "whitespace-normal break-words",
            )}
          >
            {row.task.title}
          </span>
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{row.task.key}</span>
        </button>
      </div>
      <Timeline
        range={range}
        bar={bar}
        task={row.task}
        disabled={saving}
        onPreviewDates={onPreviewDates}
        onResetPreview={onResetPreview}
        onCommitDates={onCommitDates}
      />
      {bar === null ? (
        <span className="sr-only">{row.task.key} has no bar; both start and due dates are required</span>
      ) : null}
    </div>
  );
}

export function GanttView({ projectId }: { projectId: string | null }) {
  const navigation = useTasksNavigation();
  const projects = useProjects();
  const rpc = useTasksRpc();
  const preferenceScopeId = projectId ?? "__all-projects__";
  const [preference, setPreference] = useState<GanttPreference>(() =>
    loadGanttPreference(preferenceScopeId),
  );
  const preferenceRef = useRef(preference);
  const [previewDates, setPreviewDates] = useState<Map<string, GanttTaskDates>>(
    () => new Map(),
  );
  const [savingTaskIds, setSavingTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [excludeStatusFilter, setExcludeStatusFilter] = useState(false);
  const timelineScopeKey =
    (projectId ?? "__all-projects__") + ":" +
    (excludeStatusFilter ? "exclude:" : "include:") +
    statusFilter.join(",");
  const [timelineState, setTimelineState] = useState<{
    scopeKey: string;
    range: GanttDateRange;
  } | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const renderedTimelineRef = useRef<{
    scopeKey: string;
    range: GanttDateRange | null;
  } | null>(null);
  const rangeExpansionRef = useRef<"left" | "right" | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const tasks = useTasksQuery(
    async (rpc) =>
      listAllTasks(rpc, projectId === null ? {} : { projectId }),
    ["tasks-plus:changed"],
    [projectId],
  );
  const visibleTasks = useMemo(
    () =>
      (tasks.data ?? []).map((task) => {
        const dates = previewDates.get(task.id);
        return dates === undefined ? task : { ...task, ...dates };
      }),
    [previewDates, tasks.data],
  );
  const filteredTasks = useMemo(
    () => filterGanttTasks(visibleTasks, statusFilter, excludeStatusFilter),
    [excludeStatusFilter, statusFilter, visibleTasks],
  );
  const projectGroups = useMemo(
    () => groupGanttTasks(filteredTasks, projects.data ?? [], projectId),
    [filteredTasks, projectId, projects.data],
  );
  const scopeProjects = useMemo(
    () =>
      projectId === null
        ? projects.data ?? []
        : (projects.data ?? []).filter((project) => project.id === projectId),
    [projectId, projects.data],
  );
  const rowsByProject = useMemo(
    () =>
      new Map(
        projectGroups.map((group) => [group.projectId, flattenGanttRows(group.tasks)]),
      ),
    [projectGroups],
  );
  const allRows = useMemo(
    () => projectGroups.flatMap((group) => rowsByProject.get(group.projectId) ?? []),
    [projectGroups, rowsByProject],
  );
  const initialTimelineRange = useMemo(() => {
    const committedTasks = filterGanttTasks(tasks.data ?? [], statusFilter, excludeStatusFilter);
    if (committedTasks.length === 0 && scopeProjects.length === 0) return null;
    return ganttPaddedDateRange(committedTasks) ?? ganttDefaultDateRange();
  }, [excludeStatusFilter, scopeProjects.length, statusFilter, tasks.data]);
  const range =
    initialTimelineRange === null
      ? null
      : timelineState?.scopeKey === timelineScopeKey
        ? mergeGanttDateRanges(timelineState.range, initialTimelineRange)
        : initialTimelineRange;

  useLayoutEffect(() => {
    const previous = renderedTimelineRef.current;
    renderedTimelineRef.current = { scopeKey: timelineScopeKey, range };
    if (
      previous === null ||
      previous.scopeKey !== timelineScopeKey ||
      previous.range === null ||
      range === null ||
      range.start >= previous.range.start
    ) {
      return;
    }
    const addedDays = dayDifference(range.start, previous.range.start);
    if (addedDays === null || addedDays <= 0) return;
    const element = timelineScrollRef.current;
    if (element !== null) {
      element.scrollLeft += addedDays * GANTT_DAY_WIDTH;
    }
  }, [range, timelineScopeKey]);

  useEffect(() => {
    if (initialTimelineRange === null) {
      setTimelineState(null);
      return;
    }
    setTimelineState((current) => {
      if (current?.scopeKey !== timelineScopeKey) {
        return { scopeKey: timelineScopeKey, range: initialTimelineRange };
      }
      const merged = mergeGanttDateRanges(current.range, initialTimelineRange);
      return merged.start === current.range.start && merged.end === current.range.end
        ? current
        : { scopeKey: timelineScopeKey, range: merged };
    });
  }, [initialTimelineRange, timelineScopeKey]);

  useEffect(() => {
    const serverTasks = tasks.data;
    if (serverTasks === undefined) return;
    setPreviewDates((current) => {
      let changed = false;
      const next = new Map(current);
      for (const task of serverTasks) {
        const preview = current.get(task.id);
        if (
          preview !== undefined &&
          preview.startDate === task.startDate &&
          preview.dueDate === task.dueDate
        ) {
          next.delete(task.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [tasks.data]);

  const expandTimeline = useCallback(
    (direction: "left" | "right") => {
      if (rangeExpansionRef.current !== null || initialTimelineRange === null) return;
      rangeExpansionRef.current = direction;
      setTimelineState((current) => {
        const activeRange =
          current?.scopeKey === timelineScopeKey
            ? current.range
            : initialTimelineRange;
        return {
          scopeKey: timelineScopeKey,
          range:
            direction === "left"
              ? expandGanttDateRange(activeRange, GANTT_EXTENSION_DAYS, 0)
              : expandGanttDateRange(activeRange, 0, GANTT_EXTENSION_DAYS),
        };
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          rangeExpansionRef.current = null;
        });
      });
    },
    [initialTimelineRange, timelineScopeKey],
  );

  const handleTimelineScroll = useCallback(() => {
    const element = timelineScrollRef.current;
    if (element === null || rangeExpansionRef.current !== null) return;
    const triggerDistance = GANTT_EDGE_TRIGGER_DAYS * GANTT_DAY_WIDTH;
    const remainingRight =
      element.scrollWidth - element.clientWidth - element.scrollLeft;
    if (element.scrollLeft <= triggerDistance) {
      expandTimeline("left");
    } else if (remainingRight <= triggerDistance) {
      expandTimeline("right");
    }
  }, [expandTimeline]);

  const previewTaskDates = useCallback(
    (taskId: string, dates: GanttTaskDates) => {
      setPreviewDates((current) => {
        const next = new Map(current);
        next.set(taskId, dates);
        return next;
      });
    },
    [],
  );
  const resetPreviewDates = useCallback((taskId: string) => {
    setPreviewDates((current) => {
      if (!current.has(taskId)) return current;
      const next = new Map(current);
      next.delete(taskId);
      return next;
    });
  }, []);
  const updateTaskDates = useCallback(
    (taskId: string, dates: GanttTaskDates) => {
      previewTaskDates(taskId, dates);
      setMutationError(null);
      setSavingTaskIds((current) => {
        const next = new Set(current);
        next.add(taskId);
        return next;
      });
      void rpc
        .call("updateTask", { taskId, startDate: dates.startDate, dueDate: dates.dueDate })
        .then(
          (result) => {
            if (result.ok) {
              tasks.refresh();
              return;
            }
            resetPreviewDates(taskId);
            setMutationError(result.error.message);
          },
          (error: unknown) => {
            resetPreviewDates(taskId);
            setMutationError(error instanceof Error ? error.message : String(error));
          },
        )
        .finally(() => {
          setSavingTaskIds((current) => {
            const next = new Set(current);
            next.delete(taskId);
            return next;
          });
        });
    },
    [previewTaskDates, resetPreviewDates, rpc, tasks.refresh],
  );

  useEffect(() => {
    const next = loadGanttPreference(preferenceScopeId);
    preferenceRef.current = next;
    setPreference(next);
    setCollapsedProjectIds(new Set());
  }, [preferenceScopeId]);

  const changePreference = (next: GanttPreference, persist: boolean) => {
    preferenceRef.current = next;
    setPreference(next);
    if (persist) storeGanttPreference(preferenceScopeId, next);
  };
  const changeTaskColumnWidth = (width: number, persist: boolean) => {
    changePreference(
      { ...preferenceRef.current, taskColumnWidth: clampTaskColumnWidth(width) },
      persist,
    );
  };
  const changeTitleMode = (titleMode: GanttTitleMode) => {
    changePreference({ ...preferenceRef.current, titleMode }, true);
  };
  const toggleProject = (groupId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };
  if (tasks.isLoading && tasks.data === undefined) return <GanttLoading />;
  if (tasks.error !== null && tasks.data === undefined) {
    return <div role="alert" className="p-4 text-sm text-destructive">Failed to load Gantt: {tasks.error}</div>;
  }
  if (range === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Icon name="Calendar" className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No tasks in this project</p>
        <p className="max-w-sm text-sm text-muted-foreground">Create a task to start drawing its schedule on the calendar.</p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" aria-label={projectId === null ? "All projects Gantt chart" : "Project Gantt chart"}>
      {mutationError !== null ? (
        <div role="alert" className="border-b border-destructive/40 bg-destructive/10 px-3.5 py-2 text-sm text-destructive">
          Could not save task dates: {mutationError}
        </div>
      ) : null}
      <div
        ref={timelineScrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={handleTimelineScroll}
      >
        <div className="w-max min-w-full">
        <GanttHeader
          range={range}
          taskColumnWidth={preference.taskColumnWidth}
          titleMode={preference.titleMode}
          statusFilter={statusFilter}
          excludeStatusFilter={excludeStatusFilter}
          onTaskColumnWidthChange={changeTaskColumnWidth}
          onTitleModeChange={changeTitleMode}
          onStatusFilterChange={setStatusFilter}
          onExcludeStatusFilterChange={setExcludeStatusFilter}
        />
        {projectGroups.map((group) => {
          const collapsed = projectId === null && collapsedProjectIds.has(group.projectId);
          const groupRows = rowsByProject.get(group.projectId) ?? [];
          return (
            <div key={group.projectId}>
              <div className="flex min-h-10 items-center border-b border-border bg-muted/20">
                <ProjectLabel
                  project={group.project}
                  taskColumnWidth={preference.taskColumnWidth}
                  collapsible={projectId === null}
                  collapsed={collapsed}
                  taskCount={projectId === null ? group.tasks.length : undefined}
                  onToggle={projectId === null ? () => toggleProject(group.projectId) : undefined}
                />
                <Timeline
                  range={range}
                  bar={ganttProjectBar(group.tasks, range)}
                  projectBar
                />
              </div>
              {!collapsed
                ? groupRows.map((row) => (
                    <TaskRow
                      key={row.task.id}
                      row={row}
                      range={range}
                      taskColumnWidth={preference.taskColumnWidth}
                      titleMode={preference.titleMode}
                      saving={savingTaskIds.has(row.task.id)}
                      onPreviewDates={previewTaskDates}
                      onResetPreview={resetPreviewDates}
                      onCommitDates={updateTaskDates}
                      onOpen={() => navigation.go({ kind: "task", taskKey: row.task.key })}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
        </div>
      <p className="px-3.5 py-2 text-2xs text-muted-foreground">
        {allRows.filter((row) => ganttBar(row.task, range) !== null).length} scheduled · {allRows.filter((row) => ganttBar(row.task, range) === null).length} without a bar · {projectGroups.length} {projectGroups.length === 1 ? "project" : "projects"}
      </p>
    </div>
  );
}

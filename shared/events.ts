import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  CommentsChangedEvent,
  ProjectsChangedEvent,
  TasksChangedEvent,
} from "./contract";

export function publishTasksChanged(
  bb: BbPluginApi,
  taskId: string,
  projectId: string,
): void {
  const payload: TasksChangedEvent = { taskId, projectId };
  bb.realtime.publish("tasks-plus:changed", payload);
}

export function publishProjectsChanged(
  bb: BbPluginApi,
  projectId: string | null,
): void {
  const payload: ProjectsChangedEvent = { projectId };
  bb.realtime.publish("tasks-plus:projects:changed", payload);
}

export function publishCommentsChanged(
  bb: BbPluginApi,
  taskId: string,
  notifiedCount?: number,
): void {
  const payload: CommentsChangedEvent = {
    taskId,
    ...(notifiedCount === undefined ? {} : { notifiedCount }),
  };
  bb.realtime.publish("tasks-plus:comments:changed", payload);
}

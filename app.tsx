import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TasksAppShell } from "./shell/app-shell.js";
import { TasksSidebarAccessory } from "./shell/sidebar-accessory.js";
import { TasksNavigationPanel } from "./shell/navigation-panel.js";
import { TaskDirectiveCard, TaskEmbedPanel } from "./views/embed/index.js";

export default definePluginApp((app) => {
  const fixedTabs = [
    {
      panelId: "tasks-plus",
      id: "navigation",
      title: "Navigation",
      icon: "ListView",
      component: TasksNavigationPanel,
      layout: "flush" as const,
    },
  ];
  const navPanel = {
    id: "tasks-plus",
    title: "Tasks Plus",
    icon: "ListTodo",
    path: "tasks-plus",
    component: TasksAppShell,
    experimental_sidebarAccessory: TasksSidebarAccessory,
    fixedTabs,
  };
  // BB 0.39 (SDK 0.4.8) still reads the pre-0.4.16 key. Keep it
  // non-enumerable so newer collectors accept the canonical fixedTabs field
  // without treating the compatibility alias as a stale registration key.
  Object.defineProperty(navPanel, "experimental_fixedTabs", {
    value: fixedTabs,
    enumerable: false,
  });
  app.slots.navPanel(navPanel);
  app.slots.threadPanelAction({
    id: "task-plus",
    title: "Task Plus",
    icon: "ListTodo",
    component: TaskEmbedPanel,
  });
  app.slots.messageDirective({ id: "task-plus", component: TaskDirectiveCard });
});

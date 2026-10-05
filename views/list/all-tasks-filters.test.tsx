// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { Task } from "../../shared/contract.js";

window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

const PROJECT_A = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const PROJECT_B = "01HZZZZZZZZZZZZZZZZZZZZZP2";

const projectA = {
  id: PROJECT_A,
  name: "Alpha Project",
  prefix: "ALP",
  nextTaskNumber: 5,
  color: "#3b82f6",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

const projectB = {
  id: PROJECT_B,
  name: "Beta Project",
  prefix: "BET",
  nextTaskNumber: 5,
  color: "#10b981",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

const taskA: Task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZTA1",
  projectId: PROJECT_A,
  number: 1,
  key: "ALP-1",
  title: "Alpha Task One",
  description: "Detailed description of Alpha Task",
  status: "todo",
  priority: "none",
  startDate: null,
  dueDate: null,
  parentTaskId: null,
  position: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
};

const taskB: Task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZTB1",
  projectId: PROJECT_B,
  number: 1,
  key: "BET-1",
  title: "Beta Task Special",
  description: "Detailed description of Beta Task",
  status: "todo",
  priority: "none",
  startDate: null,
  dueDate: null,
  parentTaskId: null,
  position: 2,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
};

function createRpc() {
  return {
    listProjects: () => ({ projects: [projectA, projectB] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listLabels: () => ({ labels: [] }),
    listTasks: () => ({ tasks: [taskA, taskB] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    listComments: () => ({ comments: [] }),
    listAttachments: () => ({ attachments: [] }),
  };
}

describe("All tasks project filter and task search", () => {
  it("renders search input and project filter chip on All tasks page", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, { rpc: createRpc() });

    await slot.findByText("Alpha Task One");
    await slot.findByText("Beta Task Special");

    expect(slot.getByPlaceholderText("Search tasks…")).toBeDefined();
    expect(slot.getByRole("button", { name: /Project/i })).toBeDefined();
  });

  it("filters tasks by search query across title, key, and description", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, { rpc: createRpc() });

    await slot.findByText("Alpha Task One");
    const searchInput = slot.getByPlaceholderText("Search tasks…");

    fireEvent.change(searchInput, { target: { value: "Special" } });

    await waitFor(() => {
      expect(slot.queryByText("Alpha Task One")).toBeNull();
      expect(slot.getByText("Beta Task Special")).toBeDefined();
    });

    const clearSearch = slot.getByLabelText("Clear search");
    fireEvent.click(clearSearch);

    await waitFor(() => {
      expect(slot.getByText("Alpha Task One")).toBeDefined();
      expect(slot.getByText("Beta Task Special")).toBeDefined();
    });
  });

  it("filters tasks by project using the Project chip", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, { rpc: createRpc() });

    await slot.findByText("Alpha Task One");
    await slot.findByText("Beta Task Special");

    const projectChip = slot.getByRole("button", { name: /Project/i });
    fireEvent.click(projectChip);

    const alphaOption = await slot.findByText("Alpha Project");
    fireEvent.click(alphaOption);

    await waitFor(() => {
      expect(slot.getByText("Alpha Task One")).toBeDefined();
      expect(slot.queryByText("Beta Task Special")).toBeNull();
    });
  });
});

# Tasks Plus

Tasks Plus is a Linear-style tracker inside bb for planning work, delegating it to
agents, and keeping the task record connected to the threads doing the work.
It provides projects and folders, task keys, statuses and priorities, labels,
subtasks, Markdown comments, attachments, agent presets, and a full CLI.

## Install

Install this standalone plugin from its local checkout:

```sh
bb plugin install path:/absolute/path/to/plugins/tasks-plus
```

The plugin adds its own Tasks Plus sidebar panel, the `bb tasks-plus` command, and an agent
skill that teaches workers how to report progress back to Tasks Plus.
Project prefixes are fixed when created; project editing changes the name and color only.

## Quick start

Install the plugin with `bb plugin install path:/absolute/path/to/plugins/tasks-plus`. Then use the `bb tasks-plus` CLI
to create a tracker project. Link it to the bb project where delegated agents
will run:

```sh
bb tasks-plus project create \
  --name "Product" \
  --prefix PROD \
  --link-bb-project proj_your_bb_project

bb tasks-plus create \
  --project PROD \
  --title "Ship task delegation" \
  --description "Implement the flow and run focused validation." \
  --priority high

bb tasks-plus list --project PROD
bb tasks-plus show PROD-1
bb tasks-plus preset list
bb tasks-plus delegate PROD-1 --preset "GPT-5.6 · high"
```

When the CLI runs inside a linked bb project, `create` and `list` infer the
tracker project, so `--project` can be omitted. Task keys are case-insensitive
at the CLI boundary. You can also delegate from a task's **Delegate** menu,
choose or create presets under **Manage → Presets**, and type `@` in the bb
composer to send a task mention to an agent.

The comment composer shows a **Notify last responding agent** switch. When the
task has an agent reply, leave it on to send the new comment to the thread that
authored the latest reply, resuming that thread when it is idle. Turn it off to
keep the comment in Tasks only. If no agent has replied, the disabled control
says so explicitly. Agents and scripts can use the same behavior with
`bb tasks-plus comment PROD-1 --body "New context" --notify`.
When run from a thread, the CLI preserves that agent thread and any explicit
`--author`; notification still targets the prior latest responder rather than
the newly recorded agent comment itself.

## CLI reference

Run `bb tasks-plus --help` or `bb tasks-plus <command> --help` for exact options. Add
`--json` to commands when another command or agent will consume the output.
File paths (`--file`, `--attach`, `--out`, `--description-file`, `--body-file`)
resolve on the invoking machine: inside an agent thread that is the thread's
machine, otherwise the server's machine; pass `--machine <id-or-name>` to
target another enrolled machine.

| Command                                                    | Purpose                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bb tasks-plus status`                                     | Show the installed Tasks plugin name and version.                                                                                          |
| `bb tasks-plus project create\|list\|show\|update\|delete` | Manage tracker projects, folders, colors, and bb-project links; project deletion is irreversible and requires `--yes`.                     |
| `bb tasks-plus folder create\|list\|update\|delete`        | Organize tracker projects into nested folders. Deleting a folder moves its projects and subfolders to the top level; no tasks are deleted. |
| `bb tasks-plus create`                                     | Create a task with description, priority, start and due dates, optional parent, and file attachments (repeatable `--attach <path>`).          |
| `bb tasks-plus list`                                       | Page/filter tasks by project, status, priority, label, active agents, or search text; supports `--sort`, `--limit`, and `--cursor`.        |
| `bb tasks-plus show <key-or-id>`                           | Show the complete task record, including comments, attachments, subtasks, and attached threads.                                            |
| `bb tasks-plus update <key-or-id>`                         | Update status, priority, title, description, start or due date, or labels.                                                                          |
| `bb tasks-plus delete <key-or-id> --yes`                   | Irreversibly delete a task and its comments, attachments, and agent links.                                                                 |
| `bb tasks-plus comment <key-or-id>`                        | Add a Markdown comment from inline text or a file; optionally notify the latest responding task agent.                                     |
| `bb tasks-plus attachment add\|get\|list\|remove`          | Add, fetch, list, or remove attachments. Referenced attachments require `remove --remove-references`.                                      |
| `bb tasks-plus preset list\|create\|update\|delete`        | Manage reusable agent execution presets.                                                                                                   |
| `bb tasks-plus delegate <key>`                             | Start and attach a new agent thread using a preset.                                                                                        |
| `bb tasks-plus attach <key-or-id>`                         | Attach the current bb thread to a task when it was not delegated from Tasks.                                                               |
| `bb tasks-plus detach <key-or-id>`                         | Detach the current bb thread (or `--thread <id>`) from a task, for example a dead predecessor after a respawn.                             |
| `bb tasks-plus threads <key>`                              | List the bb threads attached to a task: live threads first, newest first.                                                                  |
| `bb tasks-plus label create\|list\|delete`                 | Manage project-scoped labels.                                                                                                              |
| `bb tasks-plus seed-demo --yes`                            | Create sample folders, projects, labels, tasks, and comments for evaluation.                                                               |

Statuses are `backlog`, `todo`, `in_progress`, `clarification`, `in_review`,
`done`, and `canceled`. Priorities are `urgent`, `high`, `medium`, `low`, and `none`.

Task lists default to 100 rows and accept `--limit 1-500`. JSON output is
`{ tasks, nextCursor, limit }`; human output prints the continuation option
when another page exists. The cursor is opaque and tied to the filters, sort,
and current task-list revision. If tasks are added, removed, reordered, or
updated between requests—or label links/names, active task threads, or project
prefixes change—the old cursor is rejected. Restart from the first page rather
than traversing an inconsistent snapshot.

## Agents, delegation, and presets

Linking a Tasks project to a bb project enables delegation. Open a task, choose
**Delegate**, select a preset, and optionally add instructions. A preset
defines the provider, model, reasoning level, optional service tier, permission
mode, and reusable instructions. Presets are user-defined, so create the worker profiles your team
uses repeatedly before dispatching work.

Delegation creates a worker thread in the linked bb project, attaches that
thread to the task, and advances a `backlog` or `todo` task to `in_progress`.
The worker receives the task description, subtasks, attachments, recent
comments, preset instructions, and a report-back contract. Its installed Tasks
skill tells it to inspect the task, leave substantive milestone comments,
attach artifacts, and move completed work to `in_review`.

If work begins outside the Delegate action, the agent can associate its current
thread with `bb tasks-plus attach KEY`. The inverse is `bb tasks-plus detach KEY
[--thread <id>]`, and each thread card on the task page has a detach control;
use either to drop a thread that died or moved on to other work. The task
page and `bb tasks-plus threads` list live threads before completed or failed ones,
newest first.

## Task mentions

Type `@` in the bb composer and select **Tasks** to search by task key or title.
Sending the mention gives the agent the task's description, status, priority,
labels, subtasks, attachments, recent comments, attached threads, and CLI
action contract as context. Tasks linked to the current bb project rank first.

Inside a task description or comment, `@` also inserts a task pill. These
references are stored in Markdown as `[PROD-1](bbtaskplus://PROD-1)`, so they remain
portable in task content.

Mentioning a task key such as `PROD-1` in an agent request also activates the
Tasks Plus skill, which directs the worker to read and update the tracked task.

## Known limitations

- List filters are local UI state and are not persisted in the URL. Gantt is available inside a project; a task gets a bar only when both start and due dates are set. Dates can be entered in the create dialog, task properties, or with `--start`/`--due`; use `--no-start` or `--no-due` to clear them.

## Automatic dispatch

In **Manage → Presets**, choose a preset under **Automatic dispatch: Backlog →
To-do**. Every transition from Backlog to To-do starts that preset. A task
with an already active agent thread is skipped; transitions after the thread
finishes can start the preset again.

## Fast follow

- Batch task-list enrichment for comments and attached-thread state.
- Add notifications and an inbox for task activity.
- Add a command palette entry for Tasks Plus to cmd-K.

## Data isolation

Tasks Plus stores data in its own plugin database. It does not read or modify
the bundled Tasks database, so existing projects and tasks must be recreated or
imported separately before switching workflows.

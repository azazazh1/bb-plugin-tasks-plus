import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Preset,
  PresetPermissionMode,
  PresetReasoningLevel,
  PresetServiceTier,
} from "../../shared/contract.js";
import {
  PRESET_ENVIRONMENT_KINDS,
  PRESET_PERMISSION_MODES,
} from "../../shared/contract.js";
import type { TasksRpc } from "../../shell/data.js";
import { useTasksQuery } from "../../shell/data.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { Field } from "./shared.js";

export const PERMISSION_MODES = PRESET_PERMISSION_MODES;
type ReasoningLevel = PresetReasoningLevel;
type ServiceTier = PresetServiceTier;
export type PermissionMode = PresetPermissionMode;
type EnvironmentKind = (typeof PRESET_ENVIRONMENT_KINDS)[number];
type PickerRouting =
  | { kind: "host"; hostId: string }
  | { kind: "environment"; environmentId: string };
type ProviderModelPickerValue = {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  serviceTier?: ServiceTier;
};

function ProviderModelPicker({
  value,
  onChange,
  routing,
  className,
}: {
  value: ProviderModelPickerValue;
  onChange(value: ProviderModelPickerValue): void;
  routing?: PickerRouting;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const hostId = routing?.kind === "host" ? routing.hostId : null;
  const providersQuery = useTasksQuery(
    async (rpc) =>
      (await rpc.call("listExecutionProviders", { hostId })).providers,
    ["tasks-plus:projects:changed"],
    [hostId],
  );
  const providers = providersQuery.data ?? [];
  const availableProviders = providers.filter((provider) => provider.available);
  const selectedProvider =
    providers.find((provider) => provider.id === draft.providerId) ??
    availableProviders[0] ??
    providers[0] ??
    null;
  const providerId = selectedProvider?.id ?? "";
  const modelsQuery = useTasksQuery(
    async (rpc) =>
      providerId === ""
        ? { models: [], selectedOnlyModels: [], modelLoadError: null }
        : rpc.call("listExecutionModels", { providerId, hostId }),
    ["tasks-plus:projects:changed"],
    [providerId, hostId],
  );
  const models = useMemo(
    () =>
      modelsQuery.isLoading
        ? []
        : [
            ...(modelsQuery.data?.models ?? []),
            ...(modelsQuery.data?.selectedOnlyModels ?? []),
          ],
    [modelsQuery.data, modelsQuery.isLoading],
  );
  const selectedModel =
    models.find(
      (model) => model.model === draft.model || model.id === draft.model,
    ) ??
    models.find((model) => model.isDefault) ??
    models[0] ??
    null;
  const reasoningOptions =
    selectedModel?.supportedReasoningEfforts ??
    selectedProvider?.reasoningLevels.map((option) => ({
      reasoningEffort: option.id,
      description: option.label,
    })) ??
    [];
  const serviceTiers = selectedProvider?.serviceTiers ?? [];

  useEffect(() => {
    if (selectedProvider === null) return;
    setDraft((current) => {
      const providerChanged = current.providerId !== selectedProvider.id;
      const nextProviderId = selectedProvider.id;
      const nextModel = providerChanged ? "" : current.model;
      return current.providerId === nextProviderId && !providerChanged
        ? current
        : {
            ...current,
            providerId: nextProviderId,
            model: nextModel,
            reasoningLevel: providerChanged ? "medium" : current.reasoningLevel,
            serviceTier: providerChanged ? undefined : current.serviceTier,
          };
    });
  }, [selectedProvider]);

  useEffect(() => {
    if (selectedModel === null) return;
    setDraft((current) => {
      const modelChanged = current.model !== selectedModel.model;
      const supported = reasoningOptions.some(
        (option) => option.reasoningEffort === current.reasoningLevel,
      );
      const nextReasoning = supported
        ? current.reasoningLevel
        : selectedModel.defaultReasoningEffort;
      return modelChanged || !supported
        ? {
            ...current,
            model: selectedModel.model,
            reasoningLevel: nextReasoning,
          }
        : current;
    });
  }, [selectedModel, reasoningOptions]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const syncedSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (providerId === "" || selectedModel === null) return;
    const selectionKey = [
      providerId,
      selectedModel.model,
      draft.reasoningLevel,
      draft.serviceTier ?? "",
    ].join("\u001f");
    if (selectionKey === syncedSelectionRef.current) return;
    syncedSelectionRef.current = selectionKey;
    onChangeRef.current({
      ...draft,
      providerId,
      model: selectedModel.model,
    });
  }, [
    providerId,
    selectedModel?.model,
    draft.reasoningLevel,
    draft.serviceTier,
  ]);

  const updateProvider = (nextProviderId: string) => {
    const nextProvider = providers.find(
      (provider) => provider.id === nextProviderId,
    );
    if (!nextProvider) return;
    setDraft((current) => ({
      ...current,
      providerId: nextProvider.id,
      model: "",
      reasoningLevel: "medium",
      serviceTier: undefined,
    }));
  };

  return (
    <div
      data-testid="bb-provider-model-picker"
      data-routing-kind={routing?.kind ?? "primary"}
      data-routing-id={
        routing === undefined
          ? ""
          : routing.kind === "host"
            ? routing.hostId
            : routing.environmentId
      }
      className={className}
    >
      <fieldset className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 sm:col-span-2">
          <span className="block text-xs font-medium text-muted-foreground">
            Provider
          </span>
          <select
            aria-label="Provider ID"
            value={draft.providerId || providerId}
            onChange={(event) => updateProvider(event.target.value)}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
          >
            {providers.length === 0 ? (
              <option value="">No providers available</option>
            ) : null}
            {providers.map((provider) => (
              <option
                key={provider.id}
                value={provider.id}
                disabled={!provider.available}
              >
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">
            Model
          </span>
          <select
            aria-label="Model"
            value={selectedModel?.model ?? draft.model}
            onChange={(event) => {
              const model = models.find(
                (candidate) => candidate.model === event.target.value,
              );
              if (model)
                setDraft((current) => ({
                  ...current,
                  model: model.model,
                  reasoningLevel: model.defaultReasoningEffort,
                }));
            }}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
          >
            {models.length === 0 ? (
              <option value="">
                {modelsQuery.isLoading
                  ? "Loading models…"
                  : "No models available"}
              </option>
            ) : null}
            {models.map((model) => (
              <option key={model.id} value={model.model}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">
            Reasoning
          </span>
          <select
            aria-label="Reasoning level"
            value={draft.reasoningLevel}
            onChange={(event) => {
              const level = reasoningOptions.find(
                (option) => option.reasoningEffort === event.target.value,
              )?.reasoningEffort;
              if (level)
                setDraft((current) => ({ ...current, reasoningLevel: level }));
            }}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
          >
            {reasoningOptions.length === 0 ? (
              <option value={draft.reasoningLevel}>
                {draft.reasoningLevel}
              </option>
            ) : null}
            {reasoningOptions.map((option) => (
              <option
                key={option.reasoningEffort}
                value={option.reasoningEffort}
              >
                {option.description}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">
            Service tier
          </span>
          <select
            id="tasks-plus-service-tier"
            aria-label="Service tier"
            value={draft.serviceTier ?? ""}
            onChange={(event) => {
              const serviceTier = event.target.value;
              setDraft((current) => ({
                ...current,
                serviceTier:
                  serviceTier === "fast" || serviceTier === "default"
                    ? serviceTier
                    : undefined,
              }));
            }}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Unsupported</option>
            {serviceTiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {modelsQuery.data?.modelLoadError ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Could not load models: {modelsQuery.data.modelLoadError}
        </p>
      ) : null}
    </div>
  );
}

function PermissionModePicker({
  providerId,
  value,
  onChange,
  className,
  align = "end",
}: {
  providerId: string;
  value: PermissionMode;
  onChange(value: PermissionMode): void;
  routing?: PickerRouting;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <select
      aria-label="Permission mode"
      value={value}
      data-testid="bb-permission-mode-picker"
      data-provider-id={providerId}
      data-align={align}
      className={className}
      onChange={(event) => {
        const next = event.target.value;
        if (next === "accept-edits" || next === "auto" || next === "full")
          onChange(next);
      }}
    >
      <option value="accept-edits">Accept Edits</option>
      <option value="auto">Approve for me</option>
      <option value="full">Full Access</option>
    </select>
  );
}

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  "accept-edits": "Accept Edits",
  auto: "Approve for me",
  full: "Full Access",
};

const ENVIRONMENT_LABELS: Record<EnvironmentKind, string> = {
  "project-default": "Project default",
  "new-worktree": "New worktree",
};

interface MachineOption {
  id: string;
  name: string;
}

/**
 * Manage-table summary of where a preset's threads spawn. Machine names come
 * from listMachines; an unknown id (machine removed) falls back to the id.
 */
export function describePresetEnvironment(
  preset: Pick<Preset, "environmentKind" | "baseBranch" | "machineId">,
  machines: readonly MachineOption[],
): string {
  if (preset.environmentKind !== "new-worktree") return "Project default";
  const branch = preset.baseBranch ?? "default";
  const machine =
    preset.machineId === null
      ? "default"
      : (machines.find((entry) => entry.id === preset.machineId)?.name ??
        preset.machineId);
  return `Worktree · ${branch} · ${machine}`;
}

/** Sentinel Select value for "Default machine" (Radix rejects empty values). */
const DEFAULT_MACHINE_VALUE = "__default-machine__";

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PresetDraft {
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ProviderModelPickerValue["serviceTier"];
  permissionMode: PermissionMode;
  environmentKind: EnvironmentKind;
  /** Empty means "project default base"; only sent for new-worktree. */
  baseBranch: string;
  /** Empty means "default machine"; only sent for new-worktree. */
  machineId: string;
  instructions: string;
}

const EMPTY_PRESET_DRAFT: PresetDraft = {
  name: "",
  providerId: "",
  modelId: "",
  reasoningLevel: "medium",
  serviceTier: undefined,
  permissionMode: "auto",
  environmentKind: "project-default",
  baseBranch: "",
  machineId: "",
  instructions: "",
};

function presetDraft(preset: Preset): PresetDraft {
  const permission = PERMISSION_MODES.find(
    (mode) => mode === preset.permissionMode,
  );
  return {
    name: preset.name,
    providerId: preset.providerId,
    modelId: preset.modelId,
    reasoningLevel: preset.reasoningLevel,
    serviceTier: preset.serviceTier ?? undefined,
    permissionMode: permission ?? "full",
    environmentKind: preset.environmentKind,
    baseBranch: preset.baseBranch ?? "",
    machineId: preset.machineId ?? "",
    instructions: preset.instructions,
  };
}

/** Create/update a preset from a dialog draft. */
export async function savePresetDraft(
  rpc: TasksRpc,
  editing: Preset | null,
  draft: PresetDraft,
): Promise<void> {
  // The contract rejects a branch/machine on project-default presets, and a
  // kind switch must not leave stale targets behind — always send explicit
  // nulls outside new-worktree.
  const worktree = draft.environmentKind === "new-worktree";
  const baseBranch = draft.baseBranch.trim();
  const machineId = draft.machineId.trim();
  const fields = {
    name: draft.name.trim(),
    providerId: draft.providerId.trim(),
    modelId: draft.modelId.trim(),
    reasoningLevel: draft.reasoningLevel,
    serviceTier: draft.serviceTier ?? null,
    permissionMode: draft.permissionMode,
    environmentKind: draft.environmentKind,
    baseBranch: worktree && baseBranch !== "" ? baseBranch : null,
    machineId: worktree && machineId !== "" ? machineId : null,
    instructions: draft.instructions,
  };
  if (editing) {
    await rpc.call("updatePreset", { presetId: editing.id, ...fields });
  } else {
    await rpc.call("createPreset", fields);
  }
}

export function PresetDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preset being edited, or null to create. */
  editing: Preset | null;
  onSave: (draft: PresetDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PresetDraft>(
    editing ? presetDraft(editing) : EMPTY_PRESET_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof PresetDraft>(key: K, value: PresetDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const machinesQuery = useTasksQuery(
    async (rpc) => (await rpc.call("listMachines", {})).machines,
    [],
  );
  const machines = machinesQuery.data;

  const canSubmit =
    draft.name.trim() !== "" &&
    draft.providerId.trim() !== "" &&
    draft.modelId.trim() !== "" &&
    !submitting;
  const pickerValue: ProviderModelPickerValue = {
    providerId: draft.providerId,
    model: draft.modelId,
    reasoningLevel: draft.reasoningLevel,
    ...(draft.serviceTier === undefined
      ? {}
      : { serviceTier: draft.serviceTier }),
  };
  const pickerRouting =
    draft.environmentKind === "new-worktree" && draft.machineId.trim() !== ""
      ? ({ kind: "host", hostId: draft.machineId.trim() } as const)
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit preset" : "New preset"}</DialogTitle>
          <DialogDescription>
            Presets pick the provider, model, and guardrails for dispatched
            threads.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name">
            <Input
              autoFocus
              value={draft.name}
              placeholder="e.g. Sonnet · high"
              onChange={(event) => set("name", event.target.value)}
              className="h-8"
            />
          </Field>
          <Field label="Provider, model, and reasoning">
            <ProviderModelPicker
              value={pickerValue}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  providerId: value.providerId,
                  modelId: value.model,
                  reasoningLevel: value.reasoningLevel,
                  serviceTier: value.serviceTier,
                }))
              }
              {...(pickerRouting === undefined
                ? {}
                : { routing: pickerRouting })}
              className="max-w-full"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Permissions">
              <PermissionModePicker
                providerId={draft.providerId}
                value={draft.permissionMode}
                onChange={(value) => set("permissionMode", value)}
                {...(pickerRouting === undefined
                  ? {}
                  : { routing: pickerRouting })}
                align="start"
                className="h-8 max-w-full"
              />
            </Field>
          </div>
          <Field label="Execution environment">
            <Select
              value={draft.environmentKind}
              onValueChange={(value) => {
                const kind = value as EnvironmentKind;
                // Leaving new-worktree clears its targets so a later save
                // can't ship stale branch/machine values.
                setDraft((current) => ({
                  ...current,
                  environmentKind: kind,
                  ...(kind === "new-worktree"
                    ? {}
                    : { baseBranch: "", machineId: "" }),
                }));
              }}
            >
              <SelectTrigger aria-label="Execution environment" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_ENVIRONMENT_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {ENVIRONMENT_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {draft.environmentKind === "new-worktree" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base branch">
                <Input
                  value={draft.baseBranch}
                  placeholder="project default base — leave empty"
                  aria-label="Base branch"
                  onChange={(event) => set("baseBranch", event.target.value)}
                  className="h-8"
                />
              </Field>
              <Field label="Machine">
                <Select
                  value={
                    draft.machineId === ""
                      ? DEFAULT_MACHINE_VALUE
                      : draft.machineId
                  }
                  onValueChange={(value) =>
                    set(
                      "machineId",
                      value === DEFAULT_MACHINE_VALUE ? "" : value,
                    )
                  }
                >
                  <SelectTrigger aria-label="Machine" className="h-8">
                    <SelectValue
                      placeholder={
                        machines === undefined ? "Loading…" : "Machine"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_MACHINE_VALUE}>
                      Default machine
                    </SelectItem>
                    {(machines ?? []).map((machine) => (
                      <SelectItem key={machine.id} value={machine.id}>
                        {machine.name}
                      </SelectItem>
                    ))}
                    {/* An edited preset may reference a machine that no
                        longer exists; keep it selectable by raw id. */}
                    {draft.machineId !== "" &&
                    !(machines ?? []).some(
                      (machine) => machine.id === draft.machineId,
                    ) ? (
                      <SelectItem value={draft.machineId}>
                        {draft.machineId}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}
          <Field label="Instructions">
            <Textarea
              value={draft.instructions}
              placeholder="Extra instructions prepended to dispatched threads"
              onChange={(event) => set("instructions", event.target.value)}
              className="min-h-20 text-xs"
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => {
              setSubmitting(true);
              setError(null);
              onSave(draft)
                .then(() => onOpenChange(false))
                .catch((saveError: unknown) =>
                  setError(describeError(saveError)),
                )
                .finally(() => setSubmitting(false));
            }}
          >
            {editing ? "Save preset" : "Create preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

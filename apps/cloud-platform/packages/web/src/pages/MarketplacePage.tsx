import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Loader2, ShoppingBag, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageContent } from "@/components/layout/PageContent";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/hooks/useSession";
import {
  exportMarketplacePack,
  fetchMarketplaceCatalog,
  importMarketplacePack,
  installMarketplaceItem,
  removeImportedMarketplaceItem,
  uninstallMarketplaceItem,
  type MarketplaceCatalogItem,
  type MarketplaceCategory,
  type MarketplaceKind,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type KindFilter = "all" | MarketplaceKind;

function matchesQuery(item: MarketplaceCatalogItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  const hay = `${item.title} ${item.summary} ${item.source} ${item.categoryLabel}`.toLowerCase();
  return hay.includes(needle);
}

function visibleItems(
  items: readonly MarketplaceCatalogItem[],
  kind: KindFilter,
  category: string,
  query: string,
  importedOnly: boolean,
): MarketplaceCatalogItem[] {
  const visible: MarketplaceCatalogItem[] = [];
  for (const item of items) {
    if (kind !== "all" && item.kind !== kind) {
      continue;
    }
    if (category.length > 0 && item.category !== category) {
      continue;
    }
    if (importedOnly === true && item.imported !== true) {
      continue;
    }
    if (matchesQuery(item, query) !== true) {
      continue;
    }
    visible.push(item);
  }
  return visible;
}

function kindLabel(kind: MarketplaceKind): string {
  if (kind === "diagram") {
    return "Diagram";
  }
  if (kind === "script") {
    return "Script";
  }
  if (kind === "task") {
    return "Task";
  }
  return "Document";
}

function installedLinkLabel(kind: MarketplaceKind): string {
  if (kind === "script") {
    return "Open script";
  }
  if (kind === "task") {
    return "Open pipeline";
  }
  return "Open template";
}

function templatePath(projectId: string, kind: MarketplaceKind): string {
  if (kind === "diagram") {
    return `/projects/${projectId}/knowledge/diagrams/templates`;
  }
  if (kind === "script") {
    return `/projects/${projectId}/scripts`;
  }
  if (kind === "task") {
    return `/projects/${projectId}/pipeline`;
  }
  return `/projects/${projectId}/knowledge/documentation/templates`;
}

export function MarketplacePage(): React.JSX.Element {
  const { projectId } = useParams();
  const session = useSession();
  const [items, setItems] = useState<MarketplaceCatalogItem[]>([]);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [kind, setKind] = useState<KindFilter>("all");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [importedOnly, setImportedOnly] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async () => {
    if (session === null || projectId === undefined) {
      return;
    }
    setError("");
    try {
      const catalog = await fetchMarketplaceCatalog(session, projectId);
      setItems(catalog.items);
      setCategories(catalog.categories);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load marketplace";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [session, projectId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  async function install(item: MarketplaceCatalogItem): Promise<void> {
    if (session === null || projectId === undefined) {
      return;
    }
    setBusyId(item.id);
    try {
      await installMarketplaceItem(session, { projectId, catalogId: item.id });
      toast.success(`Installed ${item.title}`);
      await loadCatalog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Install failed";
      toast.error(message);
    } finally {
      setBusyId("");
    }
  }

  async function uninstall(item: MarketplaceCatalogItem): Promise<void> {
    if (session === null || projectId === undefined) {
      return;
    }
    setBusyId(item.id);
    try {
      await uninstallMarketplaceItem(session, projectId, item.id);
      toast.success(`Removed ${item.title}`);
      await loadCatalog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Uninstall failed";
      toast.error(message);
    } finally {
      setBusyId("");
    }
  }

  async function exportPack(): Promise<void> {
    if (session === null || projectId === undefined) {
      return;
    }
    setPackBusy(true);
    try {
      await exportMarketplacePack(session, projectId);
      toast.success("Downloaded marketplace JSON");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast.error(message);
    } finally {
      setPackBusy(false);
    }
  }

  async function importFile(file: File): Promise<void> {
    if (session === null || projectId === undefined) {
      return;
    }
    setPackBusy(true);
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        toast.error("Invalid JSON");
        return;
      }
      const result = await importMarketplacePack(session, projectId, raw);
      toast.success(
        `Imported ${result.added} new · ${result.updated} updated · ${result.skippedBuiltin} built-in skipped`,
      );
      await loadCatalog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast.error(message);
    } finally {
      setPackBusy(false);
    }
  }

  async function removeImported(item: MarketplaceCatalogItem): Promise<void> {
    if (session === null || projectId === undefined) {
      return;
    }
    setBusyId(item.id);
    try {
      await removeImportedMarketplaceItem(session, projectId, item.id);
      toast.success(`Removed ${item.title} from catalog`);
      await loadCatalog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Remove failed";
      toast.error(message);
    } finally {
      setBusyId("");
    }
  }

  if (projectId === undefined) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Open a project to use the marketplace.</p>
      </PageContent>
    );
  }

  const shown = visibleItems(items, kind, category, query, importedOnly);
  let documentCount = 0;
  let diagramCount = 0;
  let scriptCount = 0;
  let taskCount = 0;
  let installedCount = 0;
  let importedCount = 0;
  for (const item of items) {
    if (item.kind === "document") {
      documentCount += 1;
    }
    if (item.kind === "diagram") {
      diagramCount += 1;
    }
    if (item.kind === "script") {
      scriptCount += 1;
    }
    if (item.kind === "task") {
      taskCount += 1;
    }
    if (item.installed) {
      installedCount += 1;
    }
    if (item.imported) {
      importedCount += 1;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Marketplace"
        subtitle="Install proven documents, diagrams, scripts, and pipeline stages. Scripts stay off until you enable them."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const files = event.target.files;
                if (files === null) {
                  return;
                }
                const chosen = files.item(0);
                if (chosen === null) {
                  return;
                }
                event.target.value = "";
                void importFile(chosen);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={packBusy}
              onClick={() => {
                void exportPack();
              }}
            >
              {packBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export JSON
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={packBusy}
              onClick={() => {
                const picker = importInputRef.current;
                if (picker === null) {
                  return;
                }
                picker.click();
              }}
            >
              {packBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Import JSON
            </Button>
            <p className="text-xs text-muted-foreground">
              {documentCount} docs · {diagramCount} diagrams · {scriptCount} scripts · {taskCount} tasks · {importedCount} imported · {installedCount} installed
            </p>
          </div>
        }
      />
      <PageContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="sticky top-0 z-10 space-y-3 border-b border-border/60 bg-background/95 pb-3">
          <Input
            value={query}
            placeholder="Search templates, sources, categories"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={kind === "all"}
              label="All"
              onClick={() => {
                setKind("all");
              }}
            />
            <FilterChip
              active={kind === "document"}
              label="Documents"
              onClick={() => {
                setKind("document");
              }}
            />
            <FilterChip
              active={kind === "diagram"}
              label="Diagrams"
              onClick={() => {
                setKind("diagram");
              }}
            />
            <FilterChip
              active={kind === "script"}
              label="Scripts"
              onClick={() => {
                setKind("script");
              }}
            />
            <FilterChip
              active={kind === "task"}
              label="Tasks"
              onClick={() => {
                setKind("task");
              }}
            />
            <FilterChip
              active={importedOnly}
              label="Imported"
              onClick={() => {
                setImportedOnly(importedOnly !== true);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={category.length === 0}
              label="Every category"
              onClick={() => {
                setCategory("");
              }}
            />
            {categories.map((entry) => (
              <FilterChip
                key={entry.id}
                active={category === entry.id}
                label={entry.label}
                onClick={() => {
                  setCategory(entry.id);
                }}
              />
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading catalog
            </div>
          ) : null}
          {error.length > 0 ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading !== true && error.length === 0 && shown.length === 0 ? (
            <div className="panel-card flex flex-col items-center justify-center px-6 py-16 text-center">
              <ShoppingBag className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">No templates in this filter</p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Clear search or pick another category.
              </p>
            </div>
          ) : null}
          {shown.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((item) => (
                <li key={item.id} className="panel-card flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="muted">{kindLabel(item.kind)}</Badge>
                    <Badge variant="outline">{item.categoryLabel}</Badge>
                    {item.imported ? <Badge variant="outline">Imported</Badge> : null}
                    {item.installed ? <Badge variant="success">Installed</Badge> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">{item.source}</p>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    {item.installed ? (
                      <Link
                        className="text-xs underline underline-offset-2"
                        to={templatePath(projectId, item.kind)}
                      >
                        {installedLinkLabel(item.kind)}
                      </Link>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1">
                      {item.imported ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === item.id}
                          onClick={() => {
                            void removeImported(item);
                          }}
                        >
                          {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove pack"}
                        </Button>
                      ) : null}
                      {item.installed ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === item.id}
                          onClick={() => {
                            void uninstall(item);
                          }}
                        >
                          {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uninstall"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => {
                            void install(item);
                          }}
                        >
                          {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Install"}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </PageContent>
    </div>
  );
}

function FilterChip(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        props.active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {props.label}
    </button>
  );
}

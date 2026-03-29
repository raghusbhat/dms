import { useEffect, useState, useCallback } from "react";
import { ClipboardList, Search, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/DatePicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import PageLoader from "@/components/ui/PageLoader";
import type { AuditLogItem, AuditLogPageResponse } from "@/types/document";

const ACTION_META: Record<string, { label: string; className: string }> = {
  upload:           { label: "Upload",           className: "bg-blue-100 text-blue-800" },
  new_version:      { label: "New version",      className: "bg-blue-100 text-blue-800" },
  restore_version:  { label: "Restore version",  className: "bg-violet-100 text-violet-800" },
  view:             { label: "Viewed",           className: "bg-slate-100 text-slate-700" },
  download:         { label: "Downloaded",       className: "bg-amber-100 text-amber-800" },
  metadata_change:  { label: "Metadata changed", className: "bg-sky-100 text-sky-800" },
  soft_delete:      { label: "Deleted",          className: "bg-rose-100 text-rose-800" },
  restore:          { label: "Restored",         className: "bg-emerald-100 text-emerald-800" },
  permanent_delete: { label: "Perm. deleted",    className: "bg-rose-200 text-rose-900" },
};

const ActionBadge = ({ action }: { action: string }) => {
  const meta = ACTION_META[action] ?? { label: action, className: "bg-slate-100 text-slate-700" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${meta.className} w-fit`}>
      {meta.label}
    </span>
  );
};

const actionLabel = (action: string) => ACTION_META[action]?.label ?? action;

const AuditLogPage = () => {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [filterAction, setFilterAction] = useState("all");
  const [filterUser, setFilterUser] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hasActiveFilters = searchQ !== "" || filterAction !== "all" || filterUser !== "all" || dateFrom !== "" || dateTo !== "";

  const clearFilters = () => {
    setSearchQ("");
    setFilterAction("all");
    setFilterUser("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const fetchLogs = useCallback(async () => {
    // Wait for both dates before applying the range filter
    if (dateFrom && !dateTo) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (searchQ) params.set("q", searchQ);
      if (filterAction !== "all") params.set("action", filterAction);
      if (filterUser !== "all") params.set("user_id", filterUser);
      // Only send date params when both are set
      if (dateFrom && dateTo) {
        params.set("date_from", new Date(dateFrom + "T00:00:00").toISOString());
        params.set("date_to", new Date(dateTo + "T23:59:59").toISOString());
      }
      const res = await api.get(`/audit?${params}`);
      if (!res.ok) throw new Error("Failed to load audit log.");
      const data: AuditLogPageResponse = await res.json();
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log.");
    } finally {
      setIsLoading(false);
    }
  }, [searchQ, filterAction, filterUser, dateFrom, dateTo, page, pageSize]);

  // Fetch filter options once on mount
  useEffect(() => {
    api.get("/audit/actions").then(r => r.json()).then(setActions).catch(() => {});
    api.get("/audit/users").then(r => r.json()).then(setUsers).catch(() => {});
  }, []);

  // Single fetch effect — fires whenever fetchLogs identity changes (i.e. any dep changes)
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Filter change handlers — reset page to 1 atomically with filter update
  // React 18 batches these so the effect above fires exactly once with correct state
  const handleActionFilter = (value: string) => { setFilterAction(value); setPage(1); };
  const handleUserFilter = (value: string) => { setFilterUser(value); setPage(1); };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold text-foreground">Audit Log</h1>
          {!isLoading && (
            <span className="rounded-full bg-slate-200 text-slate-800 border border-slate-300 text-[10px] px-1.5 py-0.5 font-semibold tabular-nums">
              {total}
            </span>
          )}
        </div>
      </div>

      {/* Toolbar strip */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-2 flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative w-56">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search document or user..."
            value={searchQ}
            onChange={(e) => { setSearchQ(e.target.value); setPage(1); }}
            className="h-8 w-full pl-8 pr-3 rounded-md border border-input bg-transparent text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Action filter */}
        <Select value={filterAction} onValueChange={handleActionFilter}>
          <SelectTrigger className="h-8 w-36 shadow-none">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>{actionLabel(a)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* User filter */}
        <Select value={filterUser} onValueChange={handleUserFilter}>
          <SelectTrigger className="h-8 w-36 shadow-none">
            <SelectValue placeholder="All users" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date from */}
        <DatePicker
          value={dateFrom}
          onChange={(iso) => {
            setDateFrom(iso);
            if (!iso) setDateTo(""); // clearing start clears end too
            else if (dateTo && dateTo < iso) setDateTo(""); // end before new start → clear end
            setPage(1);
          }}
          placeholder="From date"
          disabled={dateTo ? { after: new Date(dateTo + "T00:00:00") } : undefined}
          className="w-36 text-xs"
        />

        {/* Date to */}
        <DatePicker
          value={dateTo}
          onChange={(iso) => { setDateTo(iso); setPage(1); }}
          placeholder="To date"
          disabled={dateFrom ? { before: new Date(dateFrom + "T00:00:00") } : undefined}
          className="w-36 text-xs"
        />

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="size-3" />
            Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <PageLoader message="Loading audit log..." />
      ) : error ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center py-20">
          <ClipboardList className="size-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-foreground">No activity yet</p>
          <p className="text-xs text-muted-foreground">Actions will appear here as users interact with documents.</p>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div className="shrink-0 grid grid-cols-[1fr_160px_140px_160px_110px] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Document</span>
            <span>Action</span>
            <span>User</span>
            <span>Time</span>
            <span>IP</span>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_160px_140px_160px_110px] items-center gap-4 border-b border-border px-4 py-3 text-sm hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-foreground truncate font-medium">{item.document_title ?? "—"}</span>
                  {!!(item.metadata.version_number || item.metadata.restored_version_number) && (
                    <span className="shrink-0 rounded bg-slate-200 text-slate-700 border border-slate-300 text-[10px] px-1 py-0.5 font-semibold tabular-nums">
                      v{(item.metadata.version_number ?? item.metadata.restored_version_number) as number}
                    </span>
                  )}
                </div>
                <ActionBadge action={item.action} />
                <span className="text-xs text-muted-foreground truncate">{item.user_name ?? "—"}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatDate(item.timestamp)}</span>
                <span className="text-xs text-muted-foreground font-mono">{item.ip_address ?? "—"}</span>
              </div>
            ))}
          </div>

          {/* Footer — always visible */}
          <div className="flex h-11 shrink-0 items-center justify-between border-t border-border px-6 bg-background">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-7 w-16 text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {total === 0 ? "0 results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="size-7" disabled={page === 1} onClick={() => setPage(1)}>
                  <ChevronsLeft className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground px-1">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
                <Button variant="ghost" size="icon" className="size-7" disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" disabled={page * pageSize >= total} onClick={() => setPage(Math.ceil(total / pageSize))}>
                  <ChevronsRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLogPage;

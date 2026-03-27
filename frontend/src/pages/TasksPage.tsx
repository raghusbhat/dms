import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface WorkflowTask {
  id: string;
  instance_id: string;
  document_id: string;
  document_title: string;
  document_type: string | null;
  sensitivity: string | null;
  rule_name: string | null;
  status: string;
  comment: string | null;
  created_at: string;
}

const HARD_CODED_TYPES = ["Contract", "Invoice", "NDA", "Report", "Policy", "Receipt", "Other"];

const DATE_PRESETS = [
  { label: "All time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 3 months", value: "3m" },
  { label: "This year", value: "year" },
];


const getSensitivityBadge = (sensitivity: string | null) => {
  if (!sensitivity) return <span className="text-xs text-muted-foreground">—</span>;
  const styles: Record<string, string> = {
    public: "bg-slate-200 text-slate-800",
    internal: "bg-blue-200 text-blue-900",
    confidential: "bg-amber-200 text-amber-900",
    restricted: "bg-red-200 text-red-900",
  };
  const style = styles[sensitivity] || styles.public;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${style}`}>{sensitivity}</span>;
};

type SortField = "document_title" | "created_at";
type SortDirection = "asc" | "desc" | null;

function getDateRange(preset: string): { date_from?: string; date_to?: string } {
  const now = new Date();
  const to = now.toISOString();
  if (preset === "today") {
    const from = new Date(now); from.setHours(0, 0, 0, 0);
    return { date_from: from.toISOString(), date_to: to };
  }
  if (preset === "7d") {
    const from = new Date(now); from.setDate(from.getDate() - 7);
    return { date_from: from.toISOString(), date_to: to };
  }
  if (preset === "30d") {
    const from = new Date(now); from.setDate(from.getDate() - 30);
    return { date_from: from.toISOString(), date_to: to };
  }
  if (preset === "3m") {
    const from = new Date(now); from.setMonth(from.getMonth() - 3);
    return { date_from: from.toISOString(), date_to: to };
  }
  if (preset === "year") {
    const from = new Date(now.getFullYear(), 0, 1);
    return { date_from: from.toISOString(), date_to: to };
  }
  return {};
}

const TasksPage = () => {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Filter states
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [docType, setDocType] = useState("all");
  const [sensitivity, setSensitivity] = useState("");
  const [datePreset, setDatePreset] = useState("all");

  // Sort states
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const fetchTasks = useCallback(() => {
    setIsLoading(true);
    setError(null);
    
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (docType && docType !== "all") params.set("document_type", docType);
    if (sensitivity) params.set("sensitivity", sensitivity);
    const { date_from, date_to } = getDateRange(datePreset);
    if (date_from) params.set("date_from", date_from);
    if (date_to) params.set("date_to", date_to);
    
    api
      .get(`/workflow/queue?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load tasks.");
        return res.json();
      })
      .then((data: WorkflowTask[]) => {
        setTasks(data);
        setCurrentPage(1);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load tasks.");
      })
      .finally(() => setIsLoading(false));
  }, [debouncedQ, docType, sensitivity, datePreset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTasks();
  }, [fetchTasks]);

  // Sort tasks
  const sortedTasks = useMemo(() => {
    const result = [...tasks];
    result.sort((a, b) => {
      let aVal: string;
      let bVal: string;
      if (sortField === "document_title") {
        aVal = a.document_title.toLowerCase();
        bVal = b.document_title.toLowerCase();
      } else {
        aVal = a.created_at;
        bVal = b.created_at;
      }
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [tasks, sortField, sortDirection]);

  // Paginated tasks
  const totalPages = Math.max(1, Math.ceil(sortedTasks.length / limit));
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * limit;
    return sortedTasks.slice(start, start + limit);
  }, [sortedTasks, currentPage, limit]);

  const startRow = sortedTasks.length > 0 ? (currentPage - 1) * limit + 1 : 0;
  const endRow = Math.min(currentPage * limit, sortedTasks.length);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : sortDirection === "desc" ? null : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="size-3.5 ml-1" />;
    if (sortDirection === "asc") return <ArrowUp className="size-3.5 ml-1" />;
    if (sortDirection === "desc") return <ArrowDown className="size-3.5 ml-1" />;
    return <ArrowUpDown className="size-3.5 ml-1" />;
  };

  const handleLimitChange = (newLimit: string) => {
    setLimit(parseInt(newLimit, 10));
    setCurrentPage(1);
  };

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const clearFilters = () => {
    setQ("");
    setDocType("all");
    setSensitivity("");
    setDatePreset("all");
  };

  const hasActiveFilters = q || (docType !== "all") || sensitivity || datePreset !== "all";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-foreground">Approvals</h1>
          {sortedTasks.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-200 text-blue-900">
              {sortedTasks.length}
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
            placeholder="Search documents..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-full pl-8 pr-3 rounded-md border border-input bg-transparent text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Type dropdown */}
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {HARD_CODED_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date dropdown */}
        <Select value={datePreset} onValueChange={setDatePreset}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="Date" />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sensitivity dropdown */}
        <Select value={sensitivity || "all"} onValueChange={(v) => setSensitivity(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="Sensitivity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sensitivity</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
            <SelectItem value="confidential">Confidential</SelectItem>
            <SelectItem value="restricted">Restricted</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="size-3" />
            Clear filters
          </button>
        )}
      </div>

      {/* Column header - fixed */}
      <div className="shrink-0 grid grid-cols-[1fr_160px_120px_140px_100px] items-center gap-4 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <button
          onClick={() => handleSort("document_title")}
          className="flex items-center text-left hover:text-foreground transition-colors"
        >
          Name
          {getSortIcon("document_title")}
        </button>
        <span>Type</span>
        <span>Sensitivity</span>
        <button
          onClick={() => handleSort("created_at")}
          className="flex items-center text-left hover:text-foreground transition-colors"
        >
          Assigned
          {getSortIcon("created_at")}
        </button>
        <span />
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-muted-foreground">Loading tasks...</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!isLoading && !error && paginatedTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckSquare className="size-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-foreground">No pending approvals</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Documents you need to review will appear here.
            </p>
          </div>
        )}

        {!isLoading && !error && paginatedTasks.length > 0 && (
          <div className="flex flex-col">
            {paginatedTasks.map((task) => (
              <div
                key={task.id}
                className="grid grid-cols-[1fr_160px_120px_140px_100px] items-center gap-4 border-b border-border bg-background px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <div
                  className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/documents/${task.document_id}`)}
                >
                  <span className="truncate text-foreground font-medium">{task.document_title}</span>
                </div>
                <span className="text-xs">
                  {task.document_type ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md font-medium bg-purple-100 text-purple-900">
                      {task.document_type}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
                <span>
                  {getSensitivityBadge(task.sensitivity)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(task.created_at)}
                </span>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/documents/${task.document_id}`)}
                    className="w-full justify-between text-muted-foreground hover:text-foreground"
                  >
                    Review
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fixed footer */}
      <div className="flex h-11 shrink-0 items-center justify-between border-t border-border bg-background px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Rows per page</span>
          <Select value={String(limit)} onValueChange={handleLimitChange}>
            <SelectTrigger className="h-7 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>
            {sortedTasks.length > 0 ? `${startRow}–${endRow} of ${sortedTasks.length}` : `0 of ${sortedTasks.length}`}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => goToPage(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => goToPage(totalPages)}
            disabled={currentPage === totalPages}
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TasksPage;

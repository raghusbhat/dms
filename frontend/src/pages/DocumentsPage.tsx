import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileText, Upload, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import UploadDialog from "@/components/documents/UploadDialog";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Document } from "@/types/document";

const BASE_URL = "http://localhost:8000";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;
const DEFAULT_LIMIT = 25;

const HARD_CODED_TYPES = ["Contract", "Invoice", "NDA", "Report", "Policy", "Receipt", "Other"];

interface DocumentPage {
  items: Document[];
  total: number;
  page: number;
  pages: number;
}

const DATE_PRESETS = [
  { label: "All time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 3 months", value: "3m" },
  { label: "This year", value: "year" },
];


const Spinner = () => (
  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

type SortField = "updated_at" | "title" | "created_at";
type SortDirection = "asc" | "desc";

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

const DocumentsPage = () => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const navigate = useNavigate();
  const pollingRefs = useRef<Map<string, { interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> }>>(new Map());

  // Delete dialog state
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [deleteDocTitle, setDeleteDocTitle] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter states
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [docType, setDocType] = useState("all");
  const [sensitivity, setSensitivity] = useState("");
  const [docStatus, setDocStatus] = useState("");
  const [datePreset, setDatePreset] = useState("all");

  // Sort states
  const [sortBy, setSortBy] = useState<SortField>("updated_at");
  const [sortOrder, setSortOrder] = useState<SortDirection>("desc");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const fetchDocuments = useCallback((pageNum: number) => {
    setIsLoading(true);
    setError(null);
    
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("limit", String(limit));
    if (debouncedQ) params.set("q", debouncedQ);
    if (docType && docType !== "all") params.set("document_type", docType);
    if (sensitivity) params.set("sensitivity", sensitivity);
    if (docStatus) params.set("status", docStatus);
    const { date_from, date_to } = getDateRange(datePreset);
    if (date_from) params.set("date_from", date_from);
    if (date_to) params.set("date_to", date_to);
    params.set("sort_by", sortBy);
    params.set("sort_order", sortOrder);
    
    api
      .get(`/documents?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load documents.");
        return res.json();
      })
      .then((data: DocumentPage) => {
        setDocuments(data.items);
        setCurrentPage(data.page);
        setTotalPages(data.pages);
        setTotal(data.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load documents.");
      })
      .finally(() => setIsLoading(false));
  }, [limit, debouncedQ, docType, sensitivity, docStatus, datePreset, sortBy, sortOrder]);

  useEffect(() => {
    fetchDocuments(1); // eslint-disable-line react-hooks/set-state-in-effect
    const refs = pollingRefs.current;
    return () => {
      refs.forEach(({ interval, timeout }) => {
        clearInterval(interval);
        clearTimeout(timeout);
      });
      refs.clear();
    };
  }, [fetchDocuments]);

  const startPolling = (docId: string) => {
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      const ref = pollingRefs.current.get(docId);
      if (ref) {
        clearInterval(ref.interval);
        pollingRefs.current.delete(docId);
      }
    }, POLL_TIMEOUT_MS);

    const interval = setInterval(() => {
      api
        .get(`/documents/${docId}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to poll document.");
          return res.json();
        })
        .then((doc: Document) => {
          setDocuments((prev) => prev.map((d) => (d.id === docId ? doc : d)));
          if (doc.status === "ready" || doc.status === "processing_failed") {
            clearInterval(interval);
            clearTimeout(timeout);
            pollingRefs.current.delete(docId);
          }
        })
        .catch(() => {
          clearInterval(interval);
          clearTimeout(timeout);
          pollingRefs.current.delete(docId);
        });

      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        clearTimeout(timeout);
        pollingRefs.current.delete(docId);
      }
    }, POLL_INTERVAL_MS);

    pollingRefs.current.set(docId, { interval, timeout });
  };

  const handleUploaded = (doc: Document) => {
    fetchDocuments(1);
    if (doc.status === "uploaded" || doc.status === "processing") {
      startPolling(doc.id);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "uploaded":
        return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-200 text-zinc-800">Uploaded</span>;
      case "processing":
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-200/60 text-blue-900">
            <Spinner />
            Processing
          </span>
        );
      case "ready":
        return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-200 text-emerald-900">Ready</span>;
      case "processing_failed":
        return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-rose-200 text-rose-900">Failed</span>;
      default:
        return <span className="text-xs text-muted-foreground">{status}</span>;
    }
  };

  const getSensitivityBadge = (sensitivity: string | null) => {
    if (!sensitivity) return <span className="text-xs text-muted-foreground">—</span>;
    const styles: Record<string, string> = {
      public: "bg-gray-200 text-gray-800",
      internal: "bg-sky-200 text-sky-900",
      confidential: "bg-orange-200 text-orange-900",
      restricted: "bg-crimson-200 text-crimson-900",
    };
    const style = styles[sensitivity] || styles.public;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${style}`}>{sensitivity}</span>;
  };

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) return <ArrowUpDown className="size-3.5 ml-1" />;
    if (sortOrder === "asc") return <ArrowUp className="size-3.5 ml-1" />;
    return <ArrowDown className="size-3.5 ml-1" />;
  };

  const handleLimitChange = (newLimit: string) => {
    setLimit(parseInt(newLimit, 10));
    setCurrentPage(1);
  };

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages) return;
    fetchDocuments(page);
  };

  const clearFilters = () => {
    setQ("");
    setDocType("all");
    setSensitivity("");
    setDocStatus("");
    setDatePreset("all");
  };

  const hasActiveFilters = q || (docType !== "all") || sensitivity || docStatus || datePreset !== "all";

  const startRow = total > 0 ? (currentPage - 1) * limit + 1 : 0;
  const endRow = Math.min(currentPage * limit, total);

  return (
    <TooltipProvider>
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <h1 className="text-sm font-semibold text-foreground">Documents</h1>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Upload className="size-3.5" />
          Upload
        </Button>
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

        {/* Status dropdown */}
        <Select value={docStatus || "all"} onValueChange={(v) => setDocStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-[130px] shadow-none">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="uploaded">Uploaded</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="processing_failed">Failed</SelectItem>
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
      <div className="shrink-0 grid grid-cols-[1fr_160px_120px_100px_140px_40px] items-center gap-4 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <button
          onClick={() => handleSort("title")}
          className="flex items-center text-left hover:text-foreground transition-colors"
        >
          Name
          {getSortIcon("title")}
        </button>
        <span>Type</span>
        <span>Sensitivity</span>
        <span>Status</span>
        <button
          onClick={() => handleSort("updated_at")}
          className="flex items-center text-left hover:text-foreground transition-colors"
        >
          Uploaded
          {getSortIcon("updated_at")}
        </button>
        <span />
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-muted-foreground">Loading documents...</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!isLoading && !error && documents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="size-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-foreground">No documents yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload your first document to get started.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setUploadOpen(true)}>
              <Upload className="size-3.5" />
              Upload document
            </Button>
          </div>
        )}

        {!isLoading && !error && documents.length > 0 && (
          <div className="flex flex-col">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="grid grid-cols-[1fr_160px_120px_100px_140px_40px] items-center gap-4 border-b border-border bg-background px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => navigate(`/documents/${doc.id}`)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-foreground font-medium">{doc.title}</span>
                </div>
                <span className="text-xs">
                  {doc.extraction?.document_type ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md font-medium bg-violet-100 text-violet-900">
                      {doc.extraction.document_type}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
                <span>
                  {getSensitivityBadge(doc.extraction?.sensitivity ?? null)}
                </span>
                <span>
                  {getStatusBadge(doc.status)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(doc.updated_at)}
                </span>
                <div className="flex items-center gap-1">
                  <a
                    href={`${BASE_URL}/documents/${doc.id}/download`}
                    download
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    title="Download"
                  >
                    <Download className="size-3.5" />
                  </a>
                  {user?.role === "Admin" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteDocId(doc.id);
                            setDeleteDocTitle(doc.title);
                          }}
                          className="flex items-center justify-center rounded p-1 text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Delete document</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDocId !== null} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{deleteDocTitle}</span> and all its versions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={async () => {
                if (!deleteDocId) return;
                setIsDeleting(true);
                try {
                  const res = await api.delete(`/documents/${deleteDocId}`);
                  if (res.ok) {
                    setDocuments((prev) => prev.filter((d) => d.id !== deleteDocId));
                    setDeleteDocId(null);
                  }
                } catch {
                  // silently ignore — dialog stays open so user can retry
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>
            {total > 0 ? `${startRow}–${endRow} of ${total}` : `0 of ${total}`}
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

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
    </TooltipProvider>
  );
};

export default DocumentsPage;

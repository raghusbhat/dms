import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, ChevronRight, AlertCircle, Clock, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import PageLoader from "@/components/ui/PageLoader";
import type { Document, WorkflowTask } from "@/types/document";

// ── Badge helpers ─────────────────────────────────────────────────────────────

const SensitivityBadge = ({ value }: { value: string | null }) => {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const map: Record<string, string> = {
    public:       "bg-slate-200 text-slate-800",
    internal:     "bg-blue-200 text-blue-900",
    confidential: "bg-amber-200 text-amber-900",
    restricted:   "bg-red-200 text-red-900",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${map[value] ?? "bg-slate-200 text-slate-800"}`}>
      {value}
    </span>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    uploaded:          "bg-slate-200 text-slate-700",
    processing:        "bg-blue-200 text-blue-900",
    ready:             "bg-green-200 text-green-900",
    processing_failed: "bg-red-200 text-red-900",
  };
  const labels: Record<string, string> = {
    uploaded: "Uploaded", processing: "Processing",
    ready: "Ready", processing_failed: "Failed",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${map[status] ?? "bg-slate-200 text-slate-700"}`}>
      {labels[status] ?? status}
    </span>
  );
};

// ── Section header ────────────────────────────────────────────────────────────

const SectionHeader = ({
  title,
  count,
  action,
  onAction,
}: {
  title: string;
  count?: number;
  action?: string;
  onAction?: () => void;
}) => (
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
      {count !== undefined && count > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-200 text-amber-900">
          {count}
        </span>
      )}
    </div>
    {action && onAction && (
      <button
        onClick={onAction}
        className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {action} <ChevronRight className="size-3" />
      </button>
    )}
  </div>
);

// ── Table header row ──────────────────────────────────────────────────────────

const TableHead = ({ cols }: { cols: string[] }) => (
  <div
    className="grid gap-3 border-b border-border bg-muted/40 px-3 py-2"
    style={{ gridTemplateColumns: `1fr ${cols.slice(1).map(() => "auto").join(" ")}` }}
  >
    {cols.map((c) => (
      <span key={c} className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {c}
      </span>
    ))}
  </div>
);

// ── Reviewer view ─────────────────────────────────────────────────────────────

const ReviewerDashboard = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/workflow/queue")
      .then((r) => r.ok ? r.json() : [])
      .then((data: WorkflowTask[]) => setTasks(data))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <PageLoader />;
  }

  const visible = tasks.slice(0, 10);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <SectionHeader
        title="Pending Approvals"
        count={tasks.length}
        action={tasks.length > 10 ? `View all ${tasks.length}` : "View all"}
        onAction={() => navigate("/tasks")}
      />

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckSquare className="size-7 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-foreground">You're all caught up</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No documents are waiting for your review.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <TableHead cols={["Document", "Type", "Sensitivity", "Received", ""]} />
          {visible.map((task) => (
            <div
              key={task.id}
              className="grid gap-3 items-center border-b border-border last:border-0 px-3 py-2.5 hover:bg-muted/40 transition-colors"
              style={{ gridTemplateColumns: "1fr auto auto auto auto" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  className="truncate text-sm font-medium text-foreground cursor-pointer hover:underline"
                  onClick={() => navigate(`/documents/${task.document_id}`)}
                >
                  {task.document_title}
                </span>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {task.document_type ?? "—"}
              </span>
              <SensitivityBadge value={task.sensitivity} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDate(task.created_at)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => navigate(`/documents/${task.document_id}`)}
              >
                Review <ChevronRight className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Admin / default view ──────────────────────────────────────────────────────

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/documents")
      .then((r) => r.ok ? r.json() : { items: [] })
      .then((data: { items: Document[] }) => setDocuments(data.items))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <PageLoader />;
  }

  const failed = documents.filter((d) => d.status === "processing_failed");
  const processing = documents.filter(
    (d) => d.status === "processing" || d.status === "uploaded"
  );
  const recent = documents.slice(0, 5);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">

      {/* Attention strip — only shown if something needs action */}
      {(failed.length > 0 || processing.length > 0) && (
        <div className="flex items-center gap-5 rounded-md border border-border bg-muted/30 px-4 py-2.5">
          {failed.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <AlertCircle className="size-3.5 text-red-500 shrink-0" />
              <span className="font-semibold text-red-700">{failed.length} failed</span>
              <span className="text-muted-foreground">— needs attention</span>
            </div>
          )}
          {failed.length > 0 && processing.length > 0 && (
            <div className="w-px h-3.5 bg-border" />
          )}
          {processing.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="size-3.5 text-blue-500 shrink-0" />
              <span className="font-semibold text-blue-800">{processing.length} in progress</span>
            </div>
          )}
          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => navigate("/documents")}
          >
            View documents →
          </button>
        </div>
      )}

      {/* Recent documents */}
      <div>
        <SectionHeader
          title="Recent Documents"
          action="View all"
          onAction={() => navigate("/documents")}
        />
        {recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="size-7 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">No documents yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload your first document to get started.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <TableHead cols={["Document", "Type", "Status", "Uploaded"]} />
            {recent.map((doc) => (
              <div
                key={doc.id}
                className="grid gap-3 items-center border-b border-border last:border-0 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                style={{ gridTemplateColumns: "1fr auto auto auto" }}
                onClick={() => navigate(`/documents/${doc.id}`)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium text-foreground">
                    {doc.title}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {doc.extraction?.document_type ?? "—"}
                </span>
                <StatusBadge status={doc.status} />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(doc.updated_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const DashboardPage = () => {
  const { user } = useAuth();

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-6">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {greeting()}, {user?.name?.split(" ")[0]}
          </p>
          <p className="text-xs text-muted-foreground leading-none mt-0.5">
            {user?.role === "reviewer"
              ? "Here's what's waiting for your review."
              : "Here's what's happening in your workspace."}
          </p>
        </div>
      </div>

      {user?.role === "reviewer" ? <ReviewerDashboard /> : <AdminDashboard />}
    </div>
  );
};

export default DashboardPage;

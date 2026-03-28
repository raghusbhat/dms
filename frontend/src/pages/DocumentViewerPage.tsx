import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Download,
  RotateCw,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  CheckCircle,
  XCircle,
  ArrowLeftCircle,
  MessageCircle,
  X,
  Send,
  Loader2,
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, assertOk } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import type { Document as DmsDocument, WorkflowTask } from "@/types/document";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const BASE_URL = "http://localhost:8000";

const VIEWABLE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];
const VIEWABLE_VIDEO_TYPES = ["video/mp4", "video/webm"];
const PDF_TYPE = "application/pdf";
const CONVERTIBLE_TYPES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
];

type ViewerState =
  | { type: "loading" }
  | { type: "pdf"; url: string; pages: number; scale: number; rotation: number }
  | { type: "image"; url: string; rotation: number }
  | { type: "video"; url: string }
  | { type: "unsupported" }
  | { type: "error"; message: string };

const DocumentViewerPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState<DmsDocument | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [state, setState] = useState<ViewerState>({ type: "loading" });
  const [workflowTask, setWorkflowTask] = useState<WorkflowTask | null>(null);
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [expandedEntityGroups, setExpandedEntityGroups] = useState<Set<string>>(
    new Set(),
  );

  // Metadata edit states
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  // Ask states
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [isAsking, setIsAsking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem("viewer_sidebar_collapsed") !== "true";
  });

  const toggleEntityGroup = (label: string) => {
    setExpandedEntityGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const copySummary = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    }).catch(() => {});
  };

  const handleAsk = (question: string) => {
    if (!question.trim() || !doc) return;
    setIsAsking(true);

    // Add user message to history
    setChatHistory((prev) => [...prev, { role: "user", content: question }]);

    api
      .post(`/documents/${doc.id}/ask`, { question })
      .then((res) => {
        if (!res.ok) throw new Error("Request failed");
        return res.json();
      })
      .then((data) => {
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", content: data.answer },
        ]);
      })
      .catch(() => {
        setChatHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Failed to get an answer. Please try again.",
          },
        ]);
      })
      .finally(() => setIsAsking(false));
  };

  const patchMetadata = async (patch: {
    document_type?: string;
    sensitivity?: string;
    tags?: string[];
  }) => {
    if (!doc) return;
    setIsSavingMeta(true);
    setMetaError(null);
    try {
      const res = await api.patch(`/documents/${doc.id}/metadata`, patch);
      assertOk(res);
      const updated: DmsDocument = await res.json();
      setDoc(updated);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to save — please try again.");
      setTimeout(() => setMetaError(null), 4000);
    } finally {
      setIsSavingMeta(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("viewer_sidebar_collapsed", String(!sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    if (!id) return;
    api
      .get(`/documents/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Document not found.");
        return res.json();
      })
      .then((data: DmsDocument) => setDoc(data))
      .catch((err: unknown) => {
        setFetchError(
          err instanceof Error ? err.message : "Failed to load document.",
        );
      });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api
      .get("/workflow/queue")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((tasks: WorkflowTask[] | null) => {
        if (tasks) {
          const task = tasks.find((t) => t.document_id === id);
          setWorkflowTask(task || null);
        }
      })
      .catch(() => {
        // Ignore errors — workflow is optional
      });
  }, [id]);

  useEffect(() => {
    if (!doc) return;
    if (!doc.latest_version) {
      setState({ type: "unsupported" });
      return;
    }
    setState({ type: "loading" });

    const mime = doc.latest_version.mime_type;
    const previewUrl = `${BASE_URL}/documents/${doc.id}/preview`;

    if (mime === PDF_TYPE || CONVERTIBLE_TYPES.includes(mime)) {
      setState({
        type: "pdf",
        url: previewUrl,
        pages: 0,
        scale: 1.0,
        rotation: 0,
      });
    } else if (VIEWABLE_IMAGE_TYPES.includes(mime)) {
      setState({ type: "image", url: previewUrl, rotation: 0 });
    } else if (VIEWABLE_VIDEO_TYPES.includes(mime)) {
      setState({ type: "video", url: previewUrl });
    } else {
      setState({ type: "unsupported" });
    }
  }, [doc]);

  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfOptions = useMemo(() => ({ withCredentials: true }), []);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      setState((s) => {
        if (s.type !== "pdf") return s;
        const delta = e.deltaY > 0 ? -0.25 : 0.25;
        return { ...s, scale: Math.min(3, Math.max(0.5, s.scale + delta)) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const mime = doc?.latest_version?.mime_type ?? "";
  const isConverting = CONVERTIBLE_TYPES.includes(mime);

  const getEntityGroupLabel = (label: string): string => {
    const map: Record<string, string> = {
      PERSON: "People",
      ORG: "Organizations",
      GPE: "Locations",
      LOC: "Locations",
      DATE: "Dates",
      MONEY: "Amounts",
    };
    return map[label] || label;
  };

  const ENTITY_PREVIEW_COUNT = 5;

  const renderEntitiesGrouped = (
    entities: Array<{ text: string; label: string }>,
  ) => {
    const grouped = entities.reduce(
      (acc, ent) => {
        if (!acc[ent.label]) acc[ent.label] = [];
        acc[ent.label].push(ent.text);
        return acc;
      },
      {} as Record<string, string[]>,
    );

    const orderedLabels = ["PERSON", "ORG", "GPE", "LOC", "DATE", "MONEY"];
    const allLabels = Object.keys(grouped).sort((a, b) => {
      const aIdx = orderedLabels.indexOf(a);
      const bIdx = orderedLabels.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    if (allLabels.length === 0) {
      return (
        <div className="px-4 pb-4">
          <p className="text-xs text-muted-foreground">No entities found.</p>
        </div>
      );
    }

    return (
      <div className="px-4 pb-4 flex flex-col gap-4">
        {allLabels.map((label) => {
          const texts = [...new Set(grouped[label])]; // dedupe
          const isExpanded = expandedEntityGroups.has(label);
          const displayTexts = isExpanded
            ? texts
            : texts.slice(0, ENTITY_PREVIEW_COUNT);
          const remaining = texts.length - ENTITY_PREVIEW_COUNT;

          return (
            <div key={label}>
              {/* Group heading — visually anchored, clearly a label not a value */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  {getEntityGroupLabel(label)}
                </span>
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] tabular-nums text-muted-foreground/60">
                  {texts.length}
                </span>
              </div>
              {/* Entity chips */}
              <div className="flex flex-wrap gap-1.5">
                {displayTexts.map((text, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-foreground leading-none"
                  >
                    {text}
                  </span>
                ))}
                {remaining > 0 && !isExpanded && (
                  <button
                    onClick={() => toggleEntityGroup(label)}
                    className="inline-flex items-center rounded-md bg-muted/60 border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    +{remaining} more
                  </button>
                )}
                {isExpanded && texts.length > ENTITY_PREVIEW_COUNT && (
                  <button
                    onClick={() => toggleEntityGroup(label)}
                    className="inline-flex items-center rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const handleAction = async (action: "approve" | "reject" | "return") => {
    if (!workflowTask) return;
    if ((action === "reject" || action === "return") && !comment.trim()) {
      setActionError("Comment is required for this action");
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      const res = await api.post(
        `/workflow/tasks/${workflowTask.id}/${action}`,
        { comment: comment || null },
      );
      await assertOk(res);
      const updated: WorkflowTask = await res.json();
      setWorkflowTask(updated);
      setComment("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
          <div className="flex items-center gap-1.5 min-w-0 text-sm">
            <button
              onClick={() => navigate("/documents")}
              className="shrink-0 text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
            >
              Documents
            </button>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            <span className="truncate font-medium text-foreground">
              {doc?.title ?? "Loading..."}
            </span>
            {isConverting && (
              <span className="shrink-0 text-xs text-muted-foreground">
                (converted)
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 ml-4 shrink-0">
            {/* Workflow actions */}
            {workflowTask && workflowTask.status === "pending" && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-emerald-500 hover:bg-emerald-700 text-white border border-emerald-200"
                        >
                          <CheckCircle className="size-3 mr-1" />
                          Approve
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" align="end">
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              Approve document
                            </p>
                            <p className="text-xs text-muted-foreground">
                              This will mark the document as approved.
                            </p>
                          </div>
                          <Textarea
                            placeholder="Add a comment (optional)"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            className="text-xs min-h-[64px] resize-none"
                          />
                          {actionError && (
                            <p className="text-xs text-destructive">
                              {actionError}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => handleAction("approve")}
                              disabled={isSubmitting}
                            >
                              {isSubmitting ? "Saving…" : "Confirm"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                setComment("");
                                setActionError(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </TooltipTrigger>
                  <TooltipContent>Approve document</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200"
                        >
                          <ArrowLeftCircle className="size-3 mr-1" />
                          Return
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" align="end">
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              Return for revision
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Send this document back for changes.
                            </p>
                          </div>
                          <Textarea
                            placeholder="Explain what needs to be revised (required)"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            className="text-xs min-h-[64px] resize-none"
                          />
                          {actionError && (
                            <p className="text-xs text-destructive">
                              {actionError}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-amber-600 hover:bg-amber-700"
                              onClick={() => handleAction("return")}
                              disabled={isSubmitting}
                            >
                              {isSubmitting ? "Saving…" : "Confirm"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                setComment("");
                                setActionError(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </TooltipTrigger>
                  <TooltipContent>Return for revision</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200"
                        >
                          <XCircle className="size-3 mr-1" />
                          Reject
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" align="end">
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              Reject document
                            </p>
                            <p className="text-xs text-muted-foreground">
                              This will reject the document permanently.
                            </p>
                          </div>
                          <Textarea
                            placeholder="Explain why (required)"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            className="text-xs min-h-[64px] resize-none"
                          />
                          {actionError && (
                            <p className="text-xs text-destructive">
                              {actionError}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-rose-600 hover:bg-rose-700"
                              onClick={() => handleAction("reject")}
                              disabled={isSubmitting}
                            >
                              {isSubmitting ? "Saving…" : "Confirm"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                setComment("");
                                setActionError(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </TooltipTrigger>
                  <TooltipContent>Reject document</TooltipContent>
                </Tooltip>
              </>
            )}

            {/* Status badge when not pending */}
            {workflowTask && workflowTask.status !== "pending" && (
              <span
                className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border ${
                  workflowTask.status === "approved"
                    ? "bg-green-100 text-green-800 border-green-200"
                    : workflowTask.status === "rejected"
                      ? "bg-red-100 text-red-800 border-red-200"
                      : "bg-slate-100 text-slate-800 border-slate-200"
                }`}
              >
                {workflowTask.status === "approved" && (
                  <CheckCircle className="size-3" />
                )}
                {workflowTask.status === "rejected" && (
                  <XCircle className="size-3" />
                )}
                {workflowTask.status === "returned" && (
                  <ArrowLeftCircle className="size-3" />
                )}
                {workflowTask.status.replace("_", " ")}
              </span>
            )}

            {/* Zoom dropdown */}
            {state.type === "pdf" && state.pages > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Select
                    value={String(state.scale)}
                    onValueChange={(v) =>
                      setState((s) =>
                        s.type === "pdf" ? { ...s, scale: parseFloat(v) } : s,
                      )
                    }
                  >
                    <SelectTrigger className="w-[100px] h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.5">50%</SelectItem>
                      <SelectItem value="0.75">75%</SelectItem>
                      <SelectItem value="1">100%</SelectItem>
                      <SelectItem value="1.25">125%</SelectItem>
                      <SelectItem value="1.5">150%</SelectItem>
                      <SelectItem value="2">200%</SelectItem>
                    </SelectContent>
                  </Select>
                </TooltipTrigger>
                <TooltipContent>Zoom level</TooltipContent>
              </Tooltip>
            )}

            {(state.type === "pdf" || state.type === "image") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setState((s) =>
                        s.type === "pdf" || s.type === "image"
                          ? { ...s, rotation: (s.rotation + 90) % 360 }
                          : s,
                      )
                    }
                  >
                    <RotateCw className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Rotate</TooltipContent>
              </Tooltip>
            )}

            {doc && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a href={`${BASE_URL}/documents/${doc.id}/download`} download>
                    <Button variant="ghost" size="icon">
                      <Download className="size-4" />
                    </Button>
                  </a>
                </TooltipTrigger>
                <TooltipContent>Download original</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Viewer */}
          <div
            ref={viewerRef}
            className="flex-1 min-w-0 overflow-x-auto overflow-y-auto bg-muted/20 p-6 flex flex-col items-center"
          >
            {fetchError && (
              <div className="mt-20 flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-destructive">{fetchError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/documents")}
                >
                  Back to Documents
                </Button>
              </div>
            )}

            {!fetchError && state.type === "loading" && (
              <p className="mt-20 text-sm text-muted-foreground">
                Loading preview...
              </p>
            )}

            {state.type === "error" && (
              <div className="mt-20 flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-destructive">{state.message}</p>
                {doc && (
                  <a href={`${BASE_URL}/documents/${doc.id}/download`} download>
                    <Button size="sm" variant="outline">
                      Download instead
                    </Button>
                  </a>
                )}
              </div>
            )}

            {state.type === "unsupported" && (
              <div className="mt-20 flex flex-col items-center gap-3 text-center">
                <p className="text-sm font-medium text-foreground">
                  No preview available
                </p>
                <p className="text-sm text-muted-foreground">
                  This file type cannot be displayed in the browser.
                </p>
                {doc && (
                  <a href={`${BASE_URL}/documents/${doc.id}/download`} download>
                    <Button size="sm" variant="outline" className="mt-1">
                      <Download className="size-3.5" />
                      Download to open
                    </Button>
                  </a>
                )}
              </div>
            )}

            {state.type === "pdf" && (
              <Document
                file={state.url}
                options={pdfOptions}
                onLoadSuccess={({ numPages }) =>
                  setState((s) =>
                    s.type === "pdf" ? { ...s, pages: numPages } : s,
                  )
                }
                onLoadError={(err) => {
                  const raw = err.message ?? "";
                  let message = "Failed to load document for preview.";
                  if (raw.includes("422")) {
                    message =
                      "This document could not be converted for preview. The file may be corrupted or in an unsupported format.";
                  } else if (raw.includes("401") || raw.includes("403")) {
                    message =
                      "You do not have permission to view this document.";
                  } else if (raw.includes("404")) {
                    message = "Document preview not found.";
                  } else if (raw.includes("500") || raw.includes("503")) {
                    message =
                      "The server encountered an error generating the preview.";
                  }
                  setState({ type: "error", message });
                }}
                loading={
                  <p className="mt-20 text-sm text-muted-foreground">
                    Loading PDF...
                  </p>
                }
              >
                {Array.from({ length: state.pages }, (_, i) => (
                  <Page
                    key={i + 1}
                    pageNumber={i + 1}
                    scale={state.scale}
                    rotate={state.rotation}
                    className="mb-4"
                    renderTextLayer
                    renderAnnotationLayer={false}
                    onRenderError={() => {
                      /* silently ignore per-page render errors */
                    }}
                  />
                ))}
              </Document>
            )}

            {state.type === "image" && (
              <img
                src={state.url}
                alt={doc?.title}
                className="max-w-full rounded object-contain"
                style={{ transform: `rotate(${state.rotation}deg)` }}
              />
            )}

            {state.type === "video" && (
              <video src={state.url} controls className="max-w-full rounded" />
            )}
          </div>

          {/* Right sidebar toggle — lives OUTSIDE the sidebar so it's never clipped */}
          <div className="relative shrink-0 flex items-start pt-0 z-30">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="rounded-l-md border border-r-0 border-border bg-primary/10 hover:bg-primary/20 text-primary px-0.5 py-3 shadow-sm transition-colors"
                >
                  {sidebarOpen ? (
                    <ChevronRight className="size-3" />
                  ) : (
                    <ChevronLeft className="size-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {sidebarOpen ? "Collapse panel" : "Expand panel"}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Info panel wrapper */}
          <div
            className="shrink-0 border-l border-border flex flex-col bg-background transition-all duration-200 overflow-hidden"
            style={{ width: sidebarOpen ? "280px" : "0" }}
          >
            {/* Content - only visible when open */}
            <div className={sidebarOpen ? "flex flex-col h-full" : "hidden"}>
              {/* Fixed metadata chips */}
              {metaError && (
                <div className="shrink-0 px-4 pt-2">
                  <p className="text-[11px] text-destructive">{metaError}</p>
                </div>
              )}
              {doc && (
                <div className="shrink-0 border-b border-border px-4 py-3 flex flex-col gap-2">
                  {(() => {
                    const canEdit =
                      doc.status === "ready" &&
                      (user?.role === "Admin" || user?.role === "reviewer");

                    return (
                      <>
                        {/* Row 1: classification + sensitivity (editable or read-only) */}
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {/* Classification */}
                          {canEdit ? (
                            <Select
                              value={doc.extraction?.document_type ?? ""}
                              onValueChange={(val) =>
                                patchMetadata({ document_type: val })
                              }
                              disabled={isSavingMeta}
                            >
                              <SelectTrigger className="h-6 text-[11px] w-auto min-w-[90px] px-2 py-0 bg-purple-50 border-purple-200 text-purple-900 rounded-md">
                                <SelectValue placeholder="Type…" />
                              </SelectTrigger>
                              <SelectContent>
                                {[
                                  "Contract",
                                  "Invoice",
                                  "Report",
                                  "Policy",
                                  "Letter",
                                  "NDA",
                                  "Other",
                                ].map((t) => (
                                  <SelectItem
                                    key={t}
                                    value={t}
                                    className="text-xs"
                                  >
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            doc.extraction?.document_type && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-100 text-purple-900">
                                {doc.extraction.document_type}
                              </span>
                            )
                          )}

                          {/* Sensitivity */}
                          {canEdit ? (
                            <Select
                              value={doc.extraction?.sensitivity ?? ""}
                              onValueChange={(val) =>
                                patchMetadata({ sensitivity: val })
                              }
                              disabled={isSavingMeta}
                            >
                              <SelectTrigger className="h-6 text-[11px] w-auto min-w-[90px] px-2 py-0 rounded-md border">
                                <SelectValue placeholder="Sensitivity…" />
                              </SelectTrigger>
                              <SelectContent>
                                {[
                                  "public",
                                  "internal",
                                  "confidential",
                                  "restricted",
                                ].map((s) => (
                                  <SelectItem
                                    key={s}
                                    value={s}
                                    className="text-xs capitalize"
                                  >
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            doc.extraction?.sensitivity &&
                            (() => {
                              const styles: Record<string, string> = {
                                public: "bg-slate-200 text-slate-800",
                                internal: "bg-blue-200 text-blue-900",
                                confidential: "bg-amber-200 text-amber-900",
                                restricted: "bg-red-200 text-red-900",
                              };
                              return (
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${styles[doc.extraction.sensitivity] ?? styles.public}`}
                                >
                                  {doc.extraction.sensitivity}
                                </span>
                              );
                            })()
                          )}

                          {/* Status badge — always read-only */}
                          {(() => {
                            const statusStyles: Record<string, string> = {
                              uploaded: "bg-slate-200 text-slate-800",
                              processing: "bg-blue-200 text-blue-900",
                              ready: "bg-green-200 text-green-900",
                              processing_failed: "bg-red-200 text-red-900",
                            };
                            return (
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${statusStyles[doc.status] ?? "bg-slate-200 text-slate-800"}`}
                              >
                                {doc.status.replace("_", " ")}
                              </span>
                            );
                          })()}
                        </div>

                        {/* Row 2: Tags */}
                        <div className="flex flex-wrap gap-1 items-center">
                          {(doc.tags ?? []).map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground border border-border"
                            >
                              {tag}
                              {canEdit && (
                                <button
                                  onClick={() =>
                                    patchMetadata({
                                      tags: doc.tags.filter((t) => t !== tag),
                                    })
                                  }
                                  disabled={isSavingMeta}
                                  className="ml-0.5 hover:text-destructive transition-colors leading-none"
                                  aria-label={`Remove tag ${tag}`}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          ))}
                          {canEdit && (
                            <input
                              type="text"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && tagInput.trim()) {
                                  e.preventDefault();
                                  const newTag = tagInput.trim();
                                  if (!doc.tags?.includes(newTag)) {
                                    patchMetadata({
                                      tags: [...(doc.tags ?? []), newTag],
                                    });
                                  }
                                  setTagInput("");
                                }
                              }}
                              placeholder="Add tag…"
                              disabled={isSavingMeta}
                              className="h-5 w-20 text-[11px] px-1.5 rounded-md border border-dashed border-border bg-transparent placeholder:text-muted-foreground/50 outline-none focus:border-primary transition-colors"
                            />
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Scrollable sections */}
              <div className="flex-1 overflow-y-auto">
                {/* Section 1: AI Analysis */}
                <Collapsible
                  defaultOpen
                  className="bg-blue-50/40 dark:bg-blue-950/10"
                >
                  <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-4 py-2.5 hover:bg-blue-100/50 dark:hover:bg-blue-950/20 transition-colors">
                    <ChevronRight className="size-3 transition-transform [[data-state=open]_&]:rotate-90" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      AI Analysis
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {doc?.status === "processing" && (
                      <div className="px-4 pb-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                          Analyzing document...
                        </div>
                      </div>
                    )}
                    {doc?.status === "processing_failed" && (
                      <div className="px-4 pb-4">
                        <p className="text-sm text-destructive">
                          Analysis failed
                        </p>
                      </div>
                    )}
                    {doc?.status === "ready" && doc.extraction && (
                      <div className="px-4 pb-4">
                        {/* Confidence */}
                        {doc.extraction.type_confidence && (
                          <div className="mt-2">
                            <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2.5 py-0.5 text-[11px] font-medium tabular-nums">
                              {Math.round(doc.extraction.type_confidence * 100)}
                              % confidence
                            </span>
                          </div>
                        )}

                        {/* Summary */}
                        {doc.extraction.summary && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                Summary
                              </p>
                              <button
                                onClick={() =>
                                  copySummary(doc.extraction!.summary!)
                                }
                                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                title="Copy summary"
                              >
                                {copiedSummary ? (
                                  <Check className="size-3 text-emerald-600" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                                {copiedSummary ? "Copied" : "Copy"}
                              </button>
                            </div>
                            <div className="rounded-md bg-white/70 dark:bg-white/5 border border-border/60 px-3 py-2.5">
                              <p
                                className={`text-xs text-foreground leading-relaxed ${!showFullSummary ? "line-clamp-4" : ""}`}
                              >
                                {doc.extraction.summary}
                              </p>
                              <button
                                onClick={() =>
                                  setShowFullSummary(!showFullSummary)
                                }
                                className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                {showFullSummary ? "Show less" : "Show more"}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Tags */}
                        {Array.isArray(doc.extraction.key_fields?.tags) &&
                          (doc.extraction.key_fields.tags as string[]).length >
                            0 && (
                            <div className="mt-3">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">
                                Tags
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {(
                                  doc.extraction.key_fields.tags as string[]
                                ).map((tag, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-muted text-muted-foreground"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                    {doc?.status === "ready" && !doc.extraction && (
                      <div className="px-4 pb-4">
                        <p className="text-xs text-muted-foreground">
                          No analysis available
                        </p>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                <div className="border-t border-border" />

                {/* Section 2: File Details */}
                <Collapsible defaultOpen>
                  <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-4 py-2.5 hover:bg-muted/40 transition-colors">
                    <ChevronRight className="size-3 transition-transform [[data-state=open]_&]:rotate-90" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      File Details
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {doc?.latest_version && (
                      <div className="px-4 pb-4 mt-2 flex flex-col gap-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                            File name
                          </p>
                          <p className="text-xs text-foreground font-medium break-all">
                            {doc.latest_version.file_name}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                            Size
                          </p>
                          <p className="text-xs text-foreground">
                            {formatBytes(doc.latest_version.file_size)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                            Uploaded
                          </p>
                          <p className="text-xs text-foreground">
                            {formatDate(doc.updated_at)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                            Type
                          </p>
                          <p className="text-[10px] text-foreground break-all">
                            {doc.latest_version.mime_type}
                          </p>
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                <div className="border-t border-border" />

                {/* Section 3: Entities */}
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-4 py-2.5 hover:bg-muted/40 transition-colors">
                    <ChevronRight className="size-3 transition-transform [[data-state=open]_&]:rotate-90" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Entities
                    </span>
                    {doc?.extraction?.key_fields?.entities &&
                    Array.isArray(doc.extraction.key_fields.entities) &&
                    doc.extraction.key_fields.entities.length > 0 ? (
                      <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                        {doc.extraction.key_fields.entities.length}
                      </span>
                    ) : null}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {doc?.extraction?.key_fields?.entities &&
                    Array.isArray(doc.extraction.key_fields.entities) ? (
                      renderEntitiesGrouped(doc.extraction.key_fields.entities)
                    ) : (
                      <div className="px-4 pb-4">
                        <p className="text-xs text-muted-foreground">
                          No entities found.
                        </p>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>
          </div>

          {/* Floating Ask button */}
          {doc && doc.status === "ready" && !chatOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setChatOpen(true)}
                  className="fixed bottom-6 right-6 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all flex items-center gap-2 px-4 z-40"
                >
                  <MessageCircle className="size-5" />
                  <span className="text-sm font-medium">Ask</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Ask this document</TooltipContent>
            </Tooltip>
          )}

          {/* Chat drawer */}
          {chatOpen && (
            <div className="absolute inset-y-0 right-0 w-[320px] bg-background border-l border-border shadow-lg z-50 flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Ask this document
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {doc?.title}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setChatOpen(false)}
                      className="p-1 rounded-md hover:bg-muted transition-colors"
                    >
                      <X className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Close</TooltipContent>
                </Tooltip>
              </div>

              {/* Chat history */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatHistory.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">
                    Ask a question about this document
                  </div>
                ) : (
                  chatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {isAsking && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2 text-xs">
                      <div className="flex gap-1">
                        <span
                          className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="border-t border-border p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem(
                      "question",
                    ) as HTMLInputElement;
                    if (input.value.trim()) {
                      handleAsk(input.value);
                      input.value = "";
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    name="question"
                    placeholder="Type your question..."
                    disabled={isAsking}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isAsking}
                    className="h-9 w-9 p-0"
                  >
                    {isAsking ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>
                </form>
              </div>
            </div>
          )}
        </div>

        {state.type === "pdf" && state.pages > 1 && (
          <div className="flex h-9 shrink-0 items-center justify-center border-t border-border bg-background">
            <span className="text-xs text-muted-foreground">
              {state.pages} pages
            </span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

export default DocumentViewerPage;

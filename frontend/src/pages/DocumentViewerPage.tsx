import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Download, ZoomIn, ZoomOut, RotateCw, ChevronRight, Copy, Check } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api, assertOk } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import type { Document as DmsDocument, WorkflowTask } from "@/types/document";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const BASE_URL = "http://localhost:8000";

const VIEWABLE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
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
  const [doc, setDoc] = useState<DmsDocument | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [state, setState] = useState<ViewerState>({ type: "loading" });
  const [workflowTask, setWorkflowTask] = useState<WorkflowTask | null>(null);
  const [actionState, setActionState] = useState<{ type: "approve" | "reject" | "return" } | null>(null);
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [expandedEntityGroups, setExpandedEntityGroups] = useState<Set<string>>(new Set());

  // Ask states
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);

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
    });
  };

  const handleAsk = () => {
    if (!askQuestion.trim() || !doc) return;
    setIsAsking(true);
    setAskAnswer(null);
    api
      .post(`/documents/${doc.id}/ask`, { question: askQuestion })
      .then((res) => res.json())
      .then((data) => setAskAnswer(data.answer))
      .catch(() => setAskAnswer("Failed to get an answer. Please try again."))
      .finally(() => setIsAsking(false));
  };

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
        setFetchError(err instanceof Error ? err.message : "Failed to load document.");
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
      setState({ type: "pdf", url: previewUrl, pages: 0, scale: 1.0, rotation: 0 });
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

  const renderEntitiesGrouped = (entities: Array<{ text: string; label: string }>) => {
    const grouped = entities.reduce((acc, ent) => {
      if (!acc[ent.label]) acc[ent.label] = [];
      acc[ent.label].push(ent.text);
      return acc;
    }, {} as Record<string, string[]>);

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
          const displayTexts = isExpanded ? texts : texts.slice(0, ENTITY_PREVIEW_COUNT);
          const remaining = texts.length - ENTITY_PREVIEW_COUNT;

          return (
            <div key={label}>
              {/* Group heading — visually anchored, clearly a label not a value */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  {getEntityGroupLabel(label)}
                </span>
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] tabular-nums text-muted-foreground/60">{texts.length}</span>
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
      const res = await api.post(`/workflow/tasks/${workflowTask.id}/${action}`, { comment: comment || null });
      await assertOk(res);
      const updated: WorkflowTask = await res.json();
      setWorkflowTask(updated);
      setActionState(null);
      setComment("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
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
            <span className="shrink-0 text-xs text-muted-foreground">(converted)</span>
          )}
        </div>

        <div className="flex items-center gap-1 ml-4 shrink-0">
          {state.type === "pdf" && state.pages > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setState((s) =>
                    s.type === "pdf" ? { ...s, scale: Math.max(0.5, s.scale - 0.25) } : s
                  )
                }
                title="Zoom out"
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="w-10 text-center text-xs text-muted-foreground" title="Alt + scroll to zoom">
                {state.type === "pdf" ? Math.round(state.scale * 100) : 100}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setState((s) =>
                    s.type === "pdf" ? { ...s, scale: Math.min(3, s.scale + 0.25) } : s
                  )
                }
                title="Zoom in"
              >
                <ZoomIn className="size-4" />
              </Button>
            </>
          )}

          {(state.type === "pdf" || state.type === "image") && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setState((s) =>
                  s.type === "pdf" || s.type === "image"
                    ? { ...s, rotation: (s.rotation + 90) % 360 }
                    : s
                )
              }
              title="Rotate"
            >
              <RotateCw className="size-4" />
            </Button>
          )}

          {doc && (
            <a
              href={`${BASE_URL}/documents/${doc.id}/download`}
              download
              title="Download original"
            >
              <Button variant="ghost" size="icon">
                <Download className="size-4" />
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Viewer */}
        <div ref={viewerRef} className="flex-1 overflow-y-auto bg-muted/20 p-6 flex flex-col items-center">
          {fetchError && (
            <div className="mt-20 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-destructive">{fetchError}</p>
              <Button size="sm" variant="outline" onClick={() => navigate("/documents")}>
                Back to Documents
              </Button>
            </div>
          )}

          {!fetchError && state.type === "loading" && (
            <p className="mt-20 text-sm text-muted-foreground">Loading preview...</p>
          )}

          {state.type === "error" && (
            <div className="mt-20 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-destructive">{state.message}</p>
              {doc && (
                <a href={`${BASE_URL}/documents/${doc.id}/download`} download>
                  <Button size="sm" variant="outline">Download instead</Button>
                </a>
              )}
            </div>
          )}

          {state.type === "unsupported" && (
            <div className="mt-20 flex flex-col items-center gap-3 text-center">
              <p className="text-sm font-medium text-foreground">No preview available</p>
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
                setState((s) => (s.type === "pdf" ? { ...s, pages: numPages } : s))
              }
              onLoadError={(err) => {
                const raw = err.message ?? "";
                let message = "Failed to load document for preview.";
                if (raw.includes("422")) {
                  message = "This document could not be converted for preview. The file may be corrupted or in an unsupported format.";
                } else if (raw.includes("401") || raw.includes("403")) {
                  message = "You do not have permission to view this document.";
                } else if (raw.includes("404")) {
                  message = "Document preview not found.";
                } else if (raw.includes("500") || raw.includes("503")) {
                  message = "The server encountered an error generating the preview.";
                }
                setState({ type: "error", message });
              }}
              loading={<p className="mt-20 text-sm text-muted-foreground">Loading PDF...</p>}
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
                  onRenderError={() => {/* silently ignore per-page render errors */}}
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

        {/* Info panel */}
        <div className="w-[280px] shrink-0 border-l border-border flex flex-col bg-background">
          {/* Fixed metadata chips */}
          {doc && (
            <div className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap gap-1.5">
              {doc.extraction?.document_type && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-100 text-purple-900">
                  {doc.extraction.document_type}
                </span>
              )}
              {doc.extraction?.sensitivity && (
                (() => {
                  const styles: Record<string, string> = {
                    public: "bg-slate-200 text-slate-800",
                    internal: "bg-blue-200 text-blue-900",
                    confidential: "bg-amber-200 text-amber-900",
                    restricted: "bg-red-200 text-red-900",
                  };
                  return (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${styles[doc.extraction.sensitivity] ?? styles.public}`}>
                      {doc.extraction.sensitivity}
                    </span>
                  );
                })()
              )}
              {(() => {
                const statusStyles: Record<string, string> = {
                  uploaded: "bg-slate-200 text-slate-800",
                  processing: "bg-blue-200 text-blue-900",
                  ready: "bg-green-200 text-green-900",
                  processing_failed: "bg-red-200 text-red-900",
                };
                return (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${statusStyles[doc.status] ?? "bg-slate-200 text-slate-800"}`}>
                    {doc.status.replace("_", " ")}
                  </span>
                );
              })()}
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground">
                {formatDate(doc.updated_at)}
              </span>
            </div>
          )}

          {/* Scrollable sections */}
          <div className="flex-1 overflow-y-auto">
            {/* Section 1: AI Analysis */}
            <Collapsible defaultOpen className="bg-blue-50/40 dark:bg-blue-950/10">
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
                    <p className="text-sm text-destructive">Analysis failed</p>
                  </div>
                )}
                {doc?.status === "ready" && doc.extraction && (
                  <div className="px-4 pb-4">
                    {/* Confidence */}
                    {doc.extraction.type_confidence && (
                      <div className="mt-2">
                        <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2.5 py-0.5 text-[11px] font-medium tabular-nums">
                          {Math.round(doc.extraction.type_confidence * 100)}% confidence
                        </span>
                      </div>
                    )}

                    {/* Summary */}
                    {doc.extraction.summary && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Summary</p>
                          <button
                            onClick={() => copySummary(doc.extraction!.summary!)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy summary"
                          >
                            {copiedSummary ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                            {copiedSummary ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <div className="rounded-md bg-white/70 dark:bg-white/5 border border-border/60 px-3 py-2.5">
                          <p className={`text-xs text-foreground leading-relaxed ${!showFullSummary ? "line-clamp-4" : ""}`}>
                            {doc.extraction.summary}
                          </p>
                          <button
                            onClick={() => setShowFullSummary(!showFullSummary)}
                            className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            {showFullSummary ? "Show less" : "Show more"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    {Array.isArray(doc.extraction.key_fields?.tags) && (doc.extraction.key_fields.tags as string[]).length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Tags</p>
                        <div className="flex flex-wrap gap-1">
                          {(doc.extraction.key_fields.tags as string[]).map((tag, i) => (
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
                    <p className="text-xs text-muted-foreground">No analysis available</p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            <div className="border-t border-border" />

            {/* Ask this document */}
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-foreground mb-2">Ask this document</p>
              <div className="flex gap-2">
                <input
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                  placeholder="What is the payment term?"
                  className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button size="sm" onClick={handleAsk} disabled={isAsking || !askQuestion.trim()} className="h-8 text-xs">
                  {isAsking ? "..." : "Ask"}
                </Button>
              </div>
              {askAnswer && (
                <div className="mt-2 rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-foreground leading-relaxed">
                  {askAnswer}
                </div>
              )}
            </div>

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
                {doc?.extraction?.key_fields?.entities && Array.isArray(doc.extraction.key_fields.entities) && doc.extraction.key_fields.entities.length > 0 && (
                  <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {doc.extraction.key_fields.entities.length}
                  </span>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                {doc?.extraction?.key_fields?.entities && Array.isArray(doc.extraction.key_fields.entities) ? (
                  renderEntitiesGrouped(doc.extraction.key_fields.entities)
                ) : (
                  <div className="px-4 pb-4">
                    <p className="text-xs text-muted-foreground">No entities found.</p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Sticky workflow strip */}
          {workflowTask && (
            <div className="shrink-0 border-t border-border bg-white dark:bg-white/[0.03] px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Workflow
                </span>
                <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${
                  workflowTask.status === "pending" ? "bg-amber-200 text-amber-900" :
                  workflowTask.status === "approved" ? "bg-green-200 text-green-900" :
                  workflowTask.status === "rejected" ? "bg-red-200 text-red-900" :
                  "bg-slate-200 text-slate-700"
                }`}>
                  {workflowTask.status.replace("_", " ")}
                </span>
              </div>

              {workflowTask.rule_name && (
                <p className="text-[11px] text-muted-foreground mb-3">{workflowTask.rule_name}</p>
              )}

              {workflowTask.status === "pending" && (
                <>
                  {!actionState ? (
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        className="w-full bg-emerald-200 hover:bg-emerald-300 text-emerald-900 shadow-none border-0"
                        onClick={() => setActionState({ type: "approve" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        className="w-full bg-amber-200 hover:bg-amber-300 text-amber-900 shadow-none border-0"
                        onClick={() => setActionState({ type: "return" })}
                      >
                        Return for revision
                      </Button>
                      <Button
                        size="sm"
                        className="w-full bg-rose-200 hover:bg-rose-300 text-rose-900 shadow-none border-0"
                        onClick={() => setActionState({ type: "reject" })}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-medium text-foreground capitalize">{actionState.type}</p>
                      <Textarea
                        placeholder={
                          actionState.type === "approve"
                            ? "Add a comment (optional)"
                            : "Add a comment (required)"
                        }
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        className="text-xs min-h-[64px] resize-none"
                      />
                      {actionError && (
                        <p className="text-xs text-destructive">{actionError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => handleAction(actionState.type)}
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? "Saving…" : "Confirm"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setActionState(null);
                            setComment("");
                            setActionError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {workflowTask.status !== "pending" && workflowTask.comment && (
                <p className="text-xs text-muted-foreground italic">"{workflowTask.comment}"</p>
              )}
            </div>
          )}
        </div>
      </div>

      {state.type === "pdf" && state.pages > 1 && (
        <div className="flex h-9 shrink-0 items-center justify-center border-t border-border bg-background">
          <span className="text-xs text-muted-foreground">{state.pages} pages</span>
        </div>
      )}
    </div>
  );
};

export default DocumentViewerPage;

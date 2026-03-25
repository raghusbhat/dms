import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Document as DmsDocument } from "@/types/document";

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

  const pdfOptions = useMemo(() => ({ withCredentials: true }), []);
  const mime = doc?.latest_version?.mime_type ?? "";
  const isConverting = CONVERTIBLE_TYPES.includes(mime);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/documents")}
            className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Documents
          </Button>
          <span className="text-muted-foreground">/</span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {doc?.title ?? "Loading..."}
            </span>
            {isConverting && (
              <span className="text-xs text-muted-foreground">Converted for preview</span>
            )}
          </div>
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
              <span className="w-10 text-center text-xs text-muted-foreground">
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

      {/* Viewer body */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto bg-muted/30 p-6">
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
                className="mb-4 shadow-md"
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
            className="max-w-full rounded shadow-md object-contain"
            style={{ transform: `rotate(${state.rotation}deg)` }}
          />
        )}

        {state.type === "video" && (
          <video src={state.url} controls className="max-w-full rounded shadow-md" />
        )}
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

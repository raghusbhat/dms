import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import type { Document } from "@/types/document";

const BASE_URL = "http://localhost:8000";

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: (doc: Document) => void;
}

type UploadState =
  | { stage: "idle" }
  | { stage: "selected"; file: File }
  | { stage: "uploading"; file: File; progress: number }
  | { stage: "error"; file: File; message: string };

const UploadDialog = ({ open, onClose, onUploaded }: Props) => {
  const [state, setState] = useState<UploadState>({ stage: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = (file: File) => {
    setState({ stage: "selected", file });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  }, []);

  const handleUpload = async () => {
    if (state.stage !== "selected") return;
    const { file } = state;

    setState({ stage: "uploading", file, progress: 0 });

    const formData = new FormData();
    formData.append("file", file);

    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setState({ stage: "uploading", file, progress: Math.round((e.loaded / e.total) * 100) });
        }
      };

      xhr.onload = () => {
        if (xhr.status === 201) {
          try {
            const doc: Document = JSON.parse(xhr.responseText);
            onUploaded(doc);
            handleClose();
          } catch {
            setState({ stage: "error", file, message: "Upload succeeded but the server returned an unexpected response." });
          }
        } else {
          let message = "Upload failed. Please try again.";
          try {
            const err = JSON.parse(xhr.responseText);
            if (xhr.status < 500 && typeof err.detail === "string") {
              message = err.detail;
            }
          } catch { /* ignore */ }
          setState({ stage: "error", file, message });
        }
        resolve();
      };

      xhr.onerror = () => {
        setState({
          stage: "error",
          file,
          message: "Unable to reach the server. Check your connection and try again.",
        });
        resolve();
      };

      xhr.ontimeout = () => {
        setState({
          stage: "error",
          file,
          message: "Upload timed out. Please check your connection and try again.",
        });
        resolve();
      };

      xhr.withCredentials = true;
      xhr.timeout = 10 * 60 * 1000; // 10 minutes — enough for large files
      xhr.open("POST", `${BASE_URL}/documents/upload`);
      xhr.send(formData);
    });
  };

  const handleClose = () => {
    setState({ stage: "idle" });
    setIsDragging(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-1">
          {/* Drop zone — shown when idle or after error */}
          {(state.stage === "idle" || state.stage === "error") && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40 hover:bg-accent/50"
              )}
            >
              <Upload className="size-6 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Drop a file here, or click to browse
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  PDF, DOCX, XLSX, images, video — up to 500 MB
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) selectFile(file);
                }}
              />
            </button>
          )}

          {/* File selected — confirm before uploading */}
          {state.stage === "selected" && (
            <div className="rounded-lg border border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground truncate">{state.file.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(state.file.size)}</p>
            </div>
          )}

          {/* Upload progress */}
          {state.stage === "uploading" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground truncate max-w-[80%]">{state.file.name}</p>
                <span className="text-xs text-muted-foreground">{state.progress}%</span>
              </div>
              <Progress value={state.progress} />
            </div>
          )}

          {/* Error message */}
          {state.stage === "error" && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={state.stage === "uploading"}
            >
              Cancel
            </Button>
            {state.stage === "selected" && (
              <Button onClick={handleUpload}>Upload</Button>
            )}
            {state.stage === "error" && (
              <Button onClick={() => setState({ stage: "selected", file: state.file })}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadDialog;

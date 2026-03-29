import { useEffect, useState } from "react";
import { RotateCcw, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import PageLoader from "@/components/ui/PageLoader";
import type { TrashItem } from "@/types/document";

const TrashPage = () => {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteTitle, setConfirmDeleteTitle] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState<string | null>(null);

  const fetchTrash = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get("/documents/trash");
      if (!res.ok) throw new Error("Failed to load trash.");
      const data: TrashItem[] = await res.json();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trash.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTrash();
  }, []);

  const handleRestore = async (id: string) => {
    setIsRestoring(id);
    try {
      const res = await api.patch(`/documents/trash/${id}/restore`);
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    } finally {
      setIsRestoring(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!confirmDeleteId) return;
    setIsDeleting(true);
    try {
      const res = await api.delete(`/documents/trash/${confirmDeleteId}/permanent`);
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== confirmDeleteId));
        setConfirmDeleteId(null);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold text-foreground">Trash</h1>
            {!isLoading && (
              <span className="rounded-full bg-slate-200 text-slate-800 border border-slate-300 text-[10px] px-1.5 py-0.5 font-semibold tabular-nums">
                {items.length}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Soft-deleted items can be restored.
          </p>
        </div>

        {/* Content */}
        {isLoading ? (
          <PageLoader message="Loading trash..." />
        ) : error ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center py-20">
            <Trash2 className="size-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-foreground">Trash is empty</p>
            <p className="text-xs text-muted-foreground">Deleted documents will appear here.</p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="shrink-0 grid grid-cols-[1fr_160px_160px_100px] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Name</span>
              <span>Deleted by</span>
              <span>Deleted on</span>
              <span />
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_160px_160px_100px] items-center gap-4 border-b border-border px-4 py-3 text-sm hover:bg-muted/30 transition-colors"
                >
                  {/* Name + file info */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.title}</p>
                      {item.latest_version && (
                        <p className="text-[11px] text-muted-foreground">
                          {item.latest_version.file_size > 0
                            ? `${Math.round(item.latest_version.file_size / 1024)} KB`
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Deleted by */}
                  <span className="text-xs text-muted-foreground truncate">
                    {item.deleted_by_name ?? "—"}
                  </span>

                  {/* Deleted on */}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(item.deleted_at)}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 justify-end">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                          disabled={isRestoring === item.id}
                          onClick={() => handleRestore(item.id)}
                        >
                          {isRestoring === item.id ? (
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Restore document</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            setConfirmDeleteId(item.id);
                            setConfirmDeleteTitle(item.title);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete permanently</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Permanent delete confirmation dialog */}
        <AlertDialog open={confirmDeleteId !== null} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong className="text-foreground">{confirmDeleteTitle}</strong> will be permanently deleted and cannot be recovered. All versions and file data will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handlePermanentDelete}
                disabled={isDeleting}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting…" : "Delete permanently"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default TrashPage;

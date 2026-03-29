import { useState, useEffect } from "react";
import { Folder as FolderIcon, FolderOpen, ChevronRight, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Folder } from "@/types/folder";

interface NewFolderModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultParentId?: string | null;
}

const NewFolderModal = ({ open, onClose, onCreated, defaultParentId }: NewFolderModalProps) => {
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setSelectedParentId(defaultParentId ?? null);
    api.get("/folders").then(async (res) => {
      if (res.ok) setFolders(await res.json());
    });
  }, [open, defaultParentId]);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const body: { name: string; parent_id?: string } = { name: name.trim() };
      if (selectedParentId) body.parent_id = selectedParentId;
      const res = await api.post("/folders", body);
      if (res.ok) {
        onCreated();
        window.dispatchEvent(new CustomEvent("dms:folders-changed"));
        onClose();
      } else {
        const err = await res.json();
        setError(err.detail || "Failed to create folder.");
      }
    } catch {
      setError("Failed to create folder.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const findFolderName = (nodes: Folder[], id: string): string | null => {
    for (const f of nodes) {
      if (f.id === id) return f.name;
      const found = findFolderName(f.children, id);
      if (found) return found;
    }
    return null;
  };

  const selectedLabel = selectedParentId
    ? (findFolderName(folders, selectedParentId) ?? "Unknown")
    : "Root (top level)";

  const renderTree = (nodes: Folder[], depth = 0): React.ReactNode =>
    nodes.map((folder) => {
      const isSelected = selectedParentId === folder.id;
      const isExpanded = expandedIds.has(folder.id);
      const hasChildren = folder.children.length > 0;

      return (
        <div key={folder.id}>
          <div
            className={`flex items-center gap-1.5 py-1.5 cursor-pointer transition-colors ${
              isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            }`}
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            onClick={() => setSelectedParentId(folder.id)}
          >
            <button
              className={`shrink-0 p-0.5 rounded ${hasChildren ? "hover:bg-accent/70" : "pointer-events-none opacity-0"}`}
              onClick={e => hasChildren && toggleExpand(folder.id, e)}
              tabIndex={-1}
            >
              {isExpanded
                ? <ChevronDown className="size-3 text-muted-foreground" />
                : <ChevronRight className="size-3 text-muted-foreground" />}
            </button>
            {isExpanded && hasChildren
              ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              : <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="text-xs whitespace-nowrap" title={folder.name}>{folder.name}</span>
            {folder.document_count > 0 && (
              <span className="ml-2 shrink-0 rounded-full bg-muted text-muted-foreground text-[9px] font-medium tabular-nums leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                {folder.document_count}
              </span>
            )}
          </div>
          {isExpanded && hasChildren && renderTree(folder.children, depth + 1)}
        </div>
      );
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">New Folder</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Name input */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Folder name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
              placeholder="e.g. Contracts 2024"
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Parent folder picker — fixed height, always scrollable */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Create inside</label>
            <div className="border border-border rounded-md h-48 overflow-y-scroll overflow-x-auto">
              <div className="w-max min-w-full">
                {/* Root option */}
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer transition-colors ${
                    selectedParentId === null ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedParentId(null)}
                >
                  <span className="size-4 shrink-0" />
                  <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Root (top level)</span>
                </div>
                {renderTree(folders)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Creating in:</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium max-w-[180px] truncate" title={selectedLabel}>
              <FolderIcon className="size-3 shrink-0" />
              {selectedLabel}
            </span>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? "Creating…" : "Create Folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewFolderModal;

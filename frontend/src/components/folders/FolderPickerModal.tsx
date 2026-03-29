import { useEffect, useState } from "react";
import { Folder as FolderIcon, FolderOpen, ChevronRight, ChevronDown, Search, X } from "lucide-react";
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

interface FolderPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folderId: string | null, folderLabel: string | null) => void;
  title?: string;
  confirmLabel?: string;
}

interface FlatFolder extends Folder {
  depth: number;
  path: string;
}

const FolderPickerModal = ({
  open,
  onClose,
  onSelect,
  title = "Move to folder",
  confirmLabel = "Move here",
}: FolderPickerModalProps) => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) {
      fetchFolders();
      setSelectedFolderId(null);
      setSearchQuery("");
    }
  }, [open]);

  const fetchFolders = async () => {
    try {
      const res = await api.get("/folders");
      if (res.ok) {
        const data: Folder[] = await res.json();
        setFolders(data);
      }
    } catch {
      // silently ignore
    }
  };

  const toggleExpand = (folderId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const flattenFolders = (
    folders: Folder[],
    depth: number = 0,
    path: string[] = []
  ): FlatFolder[] => {
    let result: FlatFolder[] = [];
    for (const folder of folders) {
      const flatFolder: FlatFolder = {
        ...folder,
        depth,
        path: [...path, folder.name].join(" / "),
      };
      result.push(flatFolder);
      if (expandedIds.has(folder.id)) {
        result = result.concat(
          flattenFolders(folder.children, depth + 1, [...path, folder.name])
        );
      }
    }
    return result;
  };

  const flatFolders = flattenFolders(folders);

  const filteredFolders = searchQuery.trim()
    ? flatFolders.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : flatFolders;

  const findFolderPath = (folderId: string | null): string => {
    if (!folderId) return "No folder (root)";
    const folder = flatFolders.find((f) => f.id === folderId);
    return folder?.path || "Unknown";
  };

  const handleConfirm = () => {
    const label = selectedFolderId ? findFolderPath(selectedFolderId) : null;
    onSelect(selectedFolderId, label);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-sm pl-7 pr-7 py-1.5 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          {/* Folder tree */}
          <div className="border border-border rounded-md h-56 overflow-y-auto">
            {/* No folder (root) option */}
            <div
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                selectedFolderId === null
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onClick={() => setSelectedFolderId(null)}
            >
              <span className="w-4" />
              <FolderIcon className="size-4" />
              <span className="text-sm">No folder (root)</span>
            </div>

            {/* Folder rows */}
            {filteredFolders.map((folder) => {
              const isSelected = selectedFolderId === folder.id;
              const isExpanded = expandedIds.has(folder.id);
              const hasChildren = folder.children.length > 0;

              return (
                <div key={folder.id}>
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                    style={{ paddingLeft: `${folder.depth * 16 + 12}px` }}
                    onClick={() => setSelectedFolderId(folder.id)}
                  >
                    {hasChildren ? (
                      <button
                        onClick={(e) => toggleExpand(folder.id, e)}
                        className="p-0.5 hover:bg-accent rounded"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="size-4" />
                    ) : (
                      <FolderIcon className="size-4" />
                    )}
                    <span className="text-sm truncate flex-1">{folder.name}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Confirmation line */}
          <div className="text-xs text-muted-foreground">
            Moving to: <span className="text-foreground font-medium">{findFolderPath(selectedFolderId)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FolderPickerModal;

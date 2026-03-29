import { useEffect, useState } from "react";
import { Folder as FolderIcon, FolderOpen, Plus, Pencil, Trash2 } from "lucide-react";
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
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { Folder } from "@/types/folder";

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  collapsed: boolean;
}


const FolderTree = ({ selectedFolderId, onSelect, collapsed }: FolderTreeProps) => {
  const { user } = useAuth();
  const isAdmin = user?.role === "Admin";
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // undefined = not creating; null = creating at root; string = creating under that folder id
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  useEffect(() => {
    fetchFolders();
  }, []);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const body: { name: string; parent_id?: string | null } = { name: newFolderName.trim() };
      if (createFolderParentId) body.parent_id = createFolderParentId;
      const res = await api.post("/folders", body);
      if (res.ok) {
        setNewFolderName("");
        setCreateFolderParentId(undefined);
        await fetchFolders();
      } else {
        const err = await res.json();
        setError(err.detail || "Failed to create folder");
      }
    } catch {
      setError("Failed to create folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameValue.trim() || !renameFolderId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.patch(`/folders/${renameFolderId}`, { name: renameValue.trim() });
      if (res.ok) {
        setRenameFolderId(null);
        setRenameValue("");
        await fetchFolders();
      } else {
        const err = await res.json();
        setError(err.detail || "Failed to rename folder");
      }
    } catch {
      setError("Failed to rename folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.delete(`/folders/${deleteFolderId}`);
      if (res.ok) {
        setDeleteFolderId(null);
        await fetchFolders();
      } else if (res.status === 409) {
        const err = await res.json();
        setError(err.detail || "Cannot delete non-empty folder");
      } else {
        setError("Failed to delete folder");
      }
    } catch {
      setError("Failed to delete folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };



  const renderFolderActions = (folder: Folder) => {
    if (!isAdmin) return null;
    return (
      <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={(e) => {
            e.stopPropagation();
            setCreateFolderParentId(folder.id);
            setNewFolderName("");
          }}
        >
          <Plus className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={(e) => {
            e.stopPropagation();
            setRenameFolderId(folder.id);
            setRenameValue(folder.name);
          }}
        >
          <Pencil className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-destructive hover:text-destructive"
          disabled={folder.document_count > 0 || folder.children.length > 0}
          onClick={(e) => {
            e.stopPropagation();
            setDeleteFolderId(folder.id);
          }}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    );
  };

  const renderFolderTree = (folders: Folder[], depth: number = 0) => (
    <div className="flex flex-col">
      {folders.map((folder) => {
        const isSelected = selectedFolderId === folder.id;
        const isExpanded = expandedFolders.has(folder.id);
        const hasChildren = folder.children.length > 0;

        return (
          <div key={folder.id}>
            <div
              className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              onClick={() => onSelect(folder.id)}
            >
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(folder.id);
                  }}
                  className="p-0.5 hover:bg-accent rounded"
                >
                  {isExpanded ? (
                    <FolderOpen className="size-4" />
                  ) : (
                    <FolderIcon className="size-4" />
                  )}
                </button>
              ) : (
                <FolderIcon className="size-4" />
              )}
              <span className="text-sm truncate flex-1">{folder.name}</span>
              <span className="text-xs text-muted-foreground">{folder.document_count}</span>
              {renderFolderActions(folder)}
            </div>
            {isExpanded && hasChildren && renderFolderTree(folder.children, depth + 1)}
            {createFolderParentId === folder.id && (
              <div className="px-2 py-1" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") setCreateFolderParentId(undefined);
                  }}
                  placeholder="Folder name..."
                  className="w-full text-sm px-2 py-1 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  disabled={isSubmitting}
                />
                {error && <p className="text-xs text-destructive mt-1">{error}</p>}
                <div className="flex gap-1 mt-1">
                  <Button size="sm" onClick={handleCreateFolder} disabled={isSubmitting}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCreateFolderParentId(undefined)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {renameFolderId === folder.id && (
              <div className="px-2 py-1" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameFolder();
                    if (e.key === "Escape") setRenameFolderId(null);
                  }}
                  className="w-full text-sm px-2 py-1 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  disabled={isSubmitting}
                />
                {error && <p className="text-xs text-destructive mt-1">{error}</p>}
                <div className="flex gap-1 mt-1">
                  <Button size="sm" onClick={handleRenameFolder} disabled={isSubmitting}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRenameFolderId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (collapsed) return null;

  return (
    <>
      <div className="border-t border-border px-2 py-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Folders
          </span>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => {
                setCreateFolderParentId(null); // null = create at root
                setNewFolderName("");
              }}
            >
              <Plus className="size-3" />
            </Button>
          )}
        </div>

        {/* All Documents */}
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
            selectedFolderId === null ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          }`}
          onClick={() => onSelect(null)}
        >
          <FolderIcon className="size-4" />
          <span className="text-sm">All Documents</span>
        </div>

        {/* Folder tree */}
        <div className="mt-1">{renderFolderTree(folders)}</div>

        {/* Create root folder inline — only when explicitly triggered by Admin */}
        {isAdmin && createFolderParentId === null && (
          <div className="px-2 py-1">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setCreateFolderParentId(undefined);
              }}
              placeholder="Folder name..."
              className="w-full text-sm px-2 py-1 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              disabled={isSubmitting}
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
            <div className="flex gap-1 mt-1">
              <Button size="sm" onClick={handleCreateFolder} disabled={isSubmitting}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCreateFolderParentId(undefined)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteFolderId !== null} onOpenChange={(open) => !open && setDeleteFolderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the folder. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFolder}
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={isSubmitting}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default FolderTree;

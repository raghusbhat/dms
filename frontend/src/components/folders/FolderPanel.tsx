import { useEffect, useRef, useState, useCallback } from "react";
import NewFolderModal from "./NewFolderModal";
import { useNavigate } from "react-router-dom";
import {
  Folder as FolderIcon,
  FolderOpen,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useAuth } from "@/contexts/AuthContext";
import type { Folder } from "@/types/folder";

interface FolderPanelProps {
  selectedFolderId: string | null;
  hideHeader?: boolean;
}

const EXPAND_KEY = "folder_expand_state";

const FolderPanel = ({ selectedFolderId, hideHeader = false }: FolderPanelProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "Admin";

  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(EXPAND_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [newFolderModal, setNewFolderModal] = useState<{ open: boolean; defaultParentId: string | null }>({ open: false, defaultParentId: null });
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Context menu
  const [ctxFolder, setCtxFolder] = useState<Folder | null>(null);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });

  const fetchFolders = useCallback(async () => {
    try {
      const res = await api.get("/folders");
      if (res.ok) setFolders(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  // Re-fetch when a document move happens anywhere in the app
  useEffect(() => {
    window.addEventListener("dms:folders-changed", fetchFolders);
    return () => window.removeEventListener("dms:folders-changed", fetchFolders);
  }, [fetchFolders]);

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem(EXPAND_KEY, JSON.stringify([...expandedIds]));
  }, [expandedIds]);

  // Auto-expand ancestors of selected folder
  useEffect(() => {
    if (!selectedFolderId || folders.length === 0) return;
    const findAncestors = (nodes: Folder[], target: string, path: string[] = []): string[] | null => {
      for (const f of nodes) {
        if (f.id === target) return path;
        const found = findAncestors(f.children, target, [...path, f.id]);
        if (found) return found;
      }
      return null;
    };
    const ancestors = findAncestors(folders, selectedFolderId);
    if (ancestors?.length) setExpandedIds(prev => new Set([...prev, ...ancestors]));
  }, [selectedFolderId, folders]);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const onSelect = (id: string | null) => {
    if (id) navigate(`/documents?folder_id=${id}`);
    else navigate("/documents");
  };

  // ── CRUD handlers ──────────────────────────────────────────────────────────

  const handleRename = async () => {
    if (!renameValue.trim() || !renameFolderId) return;
    setIsSubmitting(true);
    try {
      const res = await api.patch(`/folders/${renameFolderId}`, { name: renameValue.trim() });
      if (res.ok) { setRenameFolderId(null); setRenameValue(""); await fetchFolders(); }
    } catch { /* silent */ }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteFolderId) return;
    setIsSubmitting(true);
    setDeleteError(null);
    try {
      const res = await api.delete(`/folders/${deleteFolderId}`);
      if (res.ok) { setDeleteFolderId(null); await fetchFolders(); }
      else { const e = await res.json(); setDeleteError(e.detail || "Cannot delete folder."); }
    } catch { setDeleteError("Failed to delete folder."); }
    finally { setIsSubmitting(false); }
  };

  // ── Search — flat filtered list ────────────────────────────────────────────

  const flattenAll = (nodes: Folder[], path = ""): { folder: Folder; path: string }[] => {
    let out: { folder: Folder; path: string }[] = [];
    for (const f of nodes) {
      const p = path ? `${path} / ${f.name}` : f.name;
      out.push({ folder: f, path: p });
      out = out.concat(flattenAll(f.children, p));
    }
    return out;
  };

  const q = searchQuery.toLowerCase().trim();
  const searchResults = q ? flattenAll(folders).filter(({ folder, path }) =>
    folder.name.toLowerCase().includes(q) || path.toLowerCase().includes(q)
  ) : null;

  // ── Recursive tree renderer ────────────────────────────────────────────────

  const renderTree = (nodes: Folder[], depth = 0): React.ReactNode => {
    return nodes.map((folder, idx) => {
      const isLast = idx === nodes.length - 1;
      const isExpanded = expandedIds.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const hasChildren = folder.children.length > 0;
      const isRenaming = renameFolderId === folder.id;

      // Guide line x position for this depth level (12px indent per level)
      const guideX = (depth - 1) * 12 + 16;

      return (
        <div key={folder.id} className="relative">

          {/* Vertical segment — full height for non-last, half height for last */}
          {depth > 0 && (
            <span
              className="absolute w-px bg-border/60"
              style={{
                left: guideX,
                top: 0,
                height: isLast ? "50%" : "100%",
              }}

            />
          )}

          {/* Horizontal elbow — connects vertical guide to the row */}
          {depth > 0 && (
            <span
              className="absolute h-px bg-border/60"
              style={{
                left: guideX,
                top: "50%",
                width: 10,
              }}
            />
          )}

          {/* Row */}
          <div
            className={`group flex items-center gap-1 rounded-md pr-1 py-[3px] cursor-pointer select-none transition-colors ${
              isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            }`}
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
            onClick={() => onSelect(folder.id)}
            onContextMenu={e => {
              if (!isAdmin) return;
              e.preventDefault();
              setCtxFolder(folder);
              setCtxPos({ x: e.clientX, y: e.clientY });
            }}
          >
            {/* Chevron — always reserves space; invisible when no children */}
            <button
              className={`shrink-0 rounded p-0.5 transition-colors ${hasChildren ? "hover:bg-accent/70" : "pointer-events-none opacity-0"}`}
              onClick={e => hasChildren && toggleExpand(folder.id, e)}
              tabIndex={-1}
            >
              <ChevronRight
                className={`size-3 text-muted-foreground transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
              />
            </button>

            {/* Folder icon */}
            {isExpanded && hasChildren
              ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              : <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />}

            {/* Name or rename input */}
            {isRenaming ? (
              <div className="flex-1 mr-1" onClick={e => e.stopPropagation()}>
                <InlineInput
                  value={renameValue}
                  onChange={setRenameValue}
                  onEnter={handleRename}
                  onEscape={() => { setRenameFolderId(null); setRenameValue(""); }}
                  disabled={isSubmitting}
                />
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1 text-xs truncate leading-5">{folder.name}</span>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {folder.name}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Count chip */}
            {!isRenaming && folder.document_count > 0 && (
              <span className={`shrink-0 rounded-full text-[9px] font-medium tabular-nums leading-none px-1.5 py-0.5 min-w-[18px] text-center mr-0.5 ${
                isSelected
                  ? "bg-accent-foreground/15 text-accent-foreground"
                  : "bg-muted text-muted-foreground"
              }`}>
                {folder.document_count}
              </span>
            )}

            {/* Three-dot menu — Admin only, appears on hover */}
            {isAdmin && !isRenaming && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="shrink-0 p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => e.stopPropagation()}
                  >
                    <MoreHorizontal className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setNewFolderModal({ open: true, defaultParentId: folder.id }); }}>
                    <Plus className="size-3.5 mr-2" /> New subfolder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setRenameFolderId(folder.id); setRenameValue(folder.name); }}>
                    <Pencil className="size-3.5 mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    disabled={folder.document_count > 0 || folder.children.length > 0}
                    onClick={e => { e.stopPropagation(); setDeleteFolderId(folder.id); setDeleteError(null); }}
                  >
                    <Trash2 className="size-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Children — no separate guide line; per-node segments above handle threading */}
          {isExpanded && hasChildren && (
            <div>{renderTree(folder.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={400}>
    <div className="flex flex-col h-full text-sm">

      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center px-3 py-2 border-b border-border">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Folders
          </span>
        </div>
      )}

      {/* New Folder button — Admin only */}
      {isAdmin && (
        <div className="px-2 pt-3 pb-1">
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => setNewFolderModal({ open: true, defaultParentId: selectedFolderId })}
          >
            <Plus className="size-3.5" />
            New Folder
          </button>
        </div>
      )}

      {/* Search */}
      <div className="px-2 pb-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search folders..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full text-xs pl-6 pr-6 py-1 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
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
      </div>

      {/* Tree / search results */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">

        {/* All Documents */}
        <div
          className={`flex items-center gap-1.5 rounded-md px-2 py-[3px] cursor-pointer transition-colors mb-0.5 ${
            selectedFolderId === null ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          }`}
          onClick={() => onSelect(null)}
        >
          <span className="invisible size-3" /> {/* chevron spacer */}
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs">All Documents</span>
        </div>

        {searchResults ? (
          /* Search results — flat list, no guide lines */
          searchResults.map(({ folder, path }) => (
            <div
              key={folder.id}
              className={`flex items-center gap-1.5 rounded-md px-2 py-[3px] cursor-pointer transition-colors ${
                selectedFolderId === folder.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              onClick={() => onSelect(folder.id)}
            >
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <span className="text-xs truncate block">{folder.name}</span>
                <span className="text-[10px] text-muted-foreground truncate block">{path}</span>
              </div>
              {folder.document_count > 0 && (
                <span className="text-[10px] text-muted-foreground">{folder.document_count}</span>
              )}
            </div>
          ))
        ) : (
          /* Normal tree with guide lines */
          <div className="relative">{renderTree(folders)}</div>
        )}

      </div>

      {/* Context menu */}
      {ctxFolder && isAdmin && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxFolder(null)} />
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 w-40"
            style={{ left: ctxPos.x, top: ctxPos.y }}
          >
            {[
              { label: "New subfolder", icon: <Plus className="size-3.5" />, action: () => { setNewFolderModal({ open: true, defaultParentId: ctxFolder.id }); } },
              null,
              { label: "Rename", icon: <Pencil className="size-3.5" />, action: () => { setRenameFolderId(ctxFolder.id); setRenameValue(ctxFolder.name); } },
              null,
              {
                label: "Delete", icon: <Trash2 className="size-3.5" />,
                action: () => { setDeleteFolderId(ctxFolder.id); setDeleteError(null); },
                disabled: ctxFolder.document_count > 0 || ctxFolder.children.length > 0,
                destructive: true,
              },
            ].map((item, i) =>
              item === null
                ? <div key={i} className="my-1 border-t border-border" />
                : (
                  <button
                    key={item.label}
                    disabled={item.disabled}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed ${item.destructive ? "text-destructive" : ""}`}
                    onClick={() => { item.action(); setCtxFolder(null); }}
                  >
                    {item.icon} {item.label}
                  </button>
                )
            )}
          </div>
        </>
      )}

      {/* New Folder modal */}
      <NewFolderModal
        open={newFolderModal.open}
        onClose={() => setNewFolderModal({ open: false, defaultParentId: null })}
        onCreated={fetchFolders}
        defaultParentId={newFolderModal.defaultParentId}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteFolderId !== null} onOpenChange={open => { if (!open) { setDeleteFolderId(null); setDeleteError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the folder. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-xs text-destructive px-1">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
};

// Defined outside component — stable identity across renders, reliable autoFocus
function InlineInput({
  value, onChange, onEnter, onEscape, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  onEscape: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Delay allows any closing dropdown/popover to release focus first
    const id = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); onEnter(); }
        if (e.key === "Escape") { e.preventDefault(); onEscape(); }
      }}
      className="flex-1 text-xs px-1.5 py-0.5 rounded border border-ring bg-background outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

export default FolderPanel;

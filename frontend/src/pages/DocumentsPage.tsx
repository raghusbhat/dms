import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import UploadDialog from "@/components/documents/UploadDialog";
import { api } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import type { Document } from "@/types/document";

const BASE_URL = "http://localhost:8000";

const DocumentsPage = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get("/documents")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load documents.");
        return res.json();
      })
      .then((data: Document[]) => setDocuments(data))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load documents.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleUploaded = (doc: Document) => {
    setDocuments((prev) => [doc, ...prev]);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-8">
        <h1 className="text-sm font-semibold text-foreground">Documents</h1>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Upload className="size-3.5" />
          Upload
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading documents...</p>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {!isLoading && !error && documents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="size-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-foreground">No documents yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload your first document to get started.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setUploadOpen(true)}>
              <Upload className="size-3.5" />
              Upload document
            </Button>
          </div>
        )}

        {!isLoading && !error && documents.length > 0 && (
          <div className="flex flex-col">
            {/* List header */}
            <div className="grid grid-cols-[1fr_120px_140px_40px] items-center gap-4 border-b border-border pb-2 text-xs font-medium text-muted-foreground">
              <span>Name</span>
              <span>Size</span>
              <span>Uploaded</span>
              <span />
            </div>

            {/* Document rows */}
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="grid grid-cols-[1fr_120px_140px_40px] items-center gap-4 border-b border-border py-2.5 text-sm -mx-2 px-2 rounded cursor-pointer hover:bg-accent/40 transition-colors"
                onClick={() => navigate(`/documents/${doc.id}`)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-foreground font-medium">{doc.title}</span>
                </div>
                <span className="text-muted-foreground text-xs">
                  {doc.latest_version ? formatBytes(doc.latest_version.file_size) : "—"}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(doc.updated_at)}
                </span>
                <a
                  href={`${BASE_URL}/documents/${doc.id}/download`}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  title="Download"
                >
                  <Download className="size-3.5" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
};

export default DocumentsPage;

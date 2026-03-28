export interface DocumentVersion {
  id: string;
  version_number: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

export interface DocumentExtraction {
  document_type: string | null;
  type_confidence: number | null;
  sensitivity: "public" | "internal" | "confidential" | "restricted" | null;
  summary: string | null;
  key_fields: Record<string, unknown> | null;
}

export interface Document {
  id: string;
  title: string;
  folder_id: string | null;
  current_version_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  latest_version: DocumentVersion | null;
  status: "uploaded" | "processing" | "ready" | "processing_failed";
  extraction: DocumentExtraction | null;
}

export interface WorkflowTask {
  id: string;
  instance_id: string;
  document_id: string;
  document_title: string;
  document_type: string | null;
  sensitivity: string | null;
  rule_name: string | null;
  status: string;
  comment: string | null;
  created_at: string;
}

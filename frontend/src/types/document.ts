export interface DocumentVersion {
  id: string;
  version_number: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

export interface Document {
  id: string;
  title: string;
  folder_id: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  latest_version: DocumentVersion | null;
}

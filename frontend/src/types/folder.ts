export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  document_count: number;
  children: Folder[];
}

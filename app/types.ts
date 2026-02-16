export interface FileNode {
  name: string;
  path: string;
  category: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface SearchResult {
  path: string;
  name: string;
  category: string;
  excerpt: string;
  score: number;
}

export interface FileContent {
  path: string;
  content: string;
  name: string;
  category: string;
}

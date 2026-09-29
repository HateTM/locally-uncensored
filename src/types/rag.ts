export interface DocumentMeta {
  id: string
  name: string
  type: 'pdf' | 'docx' | 'txt'
  size: number
  addedAt: number
  chunkCount: number
}

export interface TextChunk {
  id: string
  documentId: string
  content: string
  embedding: number[]
  index: number
  /** Embedded with nomic's `search_document: ` prefix (rag.ts embedForTask).
   *  Absent on chunks indexed before it; those are re-embedded on first use. */
  taskPrefixed?: boolean
}

export interface RAGContext {
  chunks: TextChunk[]
  query: string
  documentIds: string[]
}

export interface VectorSearchResult {
  chunk: TextChunk
  score: number
}

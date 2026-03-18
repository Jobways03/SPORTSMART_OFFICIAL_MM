export interface SearchRepository { indexDocument(doc: unknown): Promise<void>; search(query: unknown): Promise<unknown[]>; }

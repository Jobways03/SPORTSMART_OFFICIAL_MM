export interface SearchEnginePort { search(query: unknown): Promise<unknown>; index(document: unknown): Promise<void>; }

declare module "node:sqlite" {
  export type SQLInputValue = null | number | bigint | string | Uint8Array;
  export type SQLOutputValue = null | number | bigint | string | Uint8Array;

  export type StatementResult = {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };

  export class StatementSync {
    run(...anonymousParameters: SQLInputValue[]): StatementResult;
    get(...anonymousParameters: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    all(...anonymousParameters: SQLInputValue[]): Array<Record<string, SQLOutputValue>>;
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

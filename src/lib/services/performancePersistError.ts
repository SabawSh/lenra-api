export class PerformancePersistError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PerformancePersistError";
    this.status = status;
    this.code = code;
  }
}

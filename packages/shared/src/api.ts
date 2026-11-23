/** API-Typen zwischen Client und Server. Der Snapshot steht in snapshot.ts. */

export interface HealthResponse {
  status: 'ok';
  /** Commit, aus dem das Image gebaut wurde (Build-Arg GIT_COMMIT), sonst "dev". */
  version: string;
}

export interface ErrorResponse {
  error: string;
}

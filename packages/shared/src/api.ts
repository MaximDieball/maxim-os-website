/** API-Typen zwischen Client und Server. Der Snapshot steht in snapshot.ts. */

export interface HealthResponse {
  status: 'ok';
}

export interface ErrorResponse {
  error: string;
}

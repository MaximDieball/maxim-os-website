/** API-Typen zwischen Client und Server. */

export interface HealthResponse {
  status: 'ok';
}

export interface ErrorResponse {
  error: string;
}

/** API-Typen zwischen Client und Server. Der Snapshot steht in snapshot.ts. */

export interface HealthResponse {
  status: 'ok';
  /** Commit, aus dem das Image gebaut wurde (Build-Arg GIT_COMMIT), sonst "dev". */
  version: string;
}

export interface ErrorResponse {
  error: string;
}

/**
 * Antwort von GET /api/minecraft (#35). Alle Texte sind vom Server gekürzt und von
 * Steuer- und Farbcodes befreit; der Client filtert bei der Ausgabe trotzdem (Regel 5).
 */
export type MinecraftStatus =
  | {
      online: true;
      /** Adresse zum Verbinden, z. B. minecraft.maxim-dieball.de */
      address: string;
      version?: string;
      motd?: string;
      players: { online: number; max: number; names: string[] };
      /** Antwortzeit des Servers in ms */
      latencyMs?: number;
    }
  | { online: false; address: string };

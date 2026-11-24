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

/** Eine Nachricht an den KI-Assistenten (#73). Den Systemprompt setzt nur der Server. */
export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Body von POST /api/ask: Verlauf, letzte Nachricht ist die neue Frage. */
export interface AskRequest {
  messages: AskMessage[];
}

/** Antwort von GET /api/ask/status. */
export interface AskStatus {
  online: boolean;
}

/** Grenzen für /api/ask, gemeinsam für Client und Server (SPEC 4b). */
export const ASK_LIMITS = {
  maxMessages: 9,
  userChars: 500,
  assistantChars: 2000,
  /** Frage-Antwort-Paare, die der Browser als Verlauf mitschickt. */
  historyPairs: 4,
  /** Alle Nachrichten zusammen (Kontext des Modells schonen, #76). */
  totalChars: 4000,
} as const;

/**
 * Trennt im Antwort-Stream von /api/ask den Text von einem vorgeschlagenen Command
 * (#108): `<text>\u001e{"command":"minecraft"}`. Das Modell kann dieses Steuerzeichen
 * nicht erzeugen, weil der Server alle Steuerzeichen aus der Antwort entfernt.
 */
export const ASK_COMMAND_SEPARATOR = '\u001e';

/** Anhang nach ASK_COMMAND_SEPARATOR. */
export interface AskSuggestion {
  command: string;
}

/**
 * V4 Neben 6: an e-mail could not be handed to the provider (Resend error,
 * timeout, no provider configured in production).
 *
 * Internal only: the message is English and may carry provider text, so it is
 * for the server log, never for the Praxis. `flashMessageFromError`
 * (lib/flash.ts) shows the generic German text for it and logs the details.
 * Dependency-free so lib/flash.ts can import it without pulling in the mail
 * drivers.
 */
export class EmailDeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmailDeliveryError";
  }
}

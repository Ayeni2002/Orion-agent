/**
 * Service-layer error carrying an HTTP status.
 *
 * Route Handlers map this to a response status without inspecting error
 * strings, so a service can signal "not found" or "invalid" without knowing
 * anything about HTTP.
 */
export class ServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

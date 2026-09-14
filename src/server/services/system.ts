/**
 * System service.
 *
 * Deliberately the smallest real service in the project: it exists so the
 * route-handler → service convention is demonstrated by working code rather
 * than only described in a comment. The agent, project, research and report
 * services introduced in later phases follow this same shape.
 */

export interface SystemStatus {
  status: "ok";
  service: "orion";
  timestamp: string;
}

export function getSystemStatus(): SystemStatus {
  return {
    status: "ok",
    service: "orion",
    timestamp: new Date().toISOString(),
  };
}

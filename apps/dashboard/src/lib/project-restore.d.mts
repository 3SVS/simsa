import type { Project } from "./mock-data";
import type { ExtendedProjectData } from "./workflow-store";

export function buildLocalProjectFromServer(
  server: { id: string; title?: string; idea?: string; productSpec?: unknown; items?: unknown[]; createdAt?: string },
  serverExt: ExtendedProjectData | null,
): { project: Project; ext: ExtendedProjectData };

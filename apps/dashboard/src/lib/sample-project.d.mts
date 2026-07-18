import type { Project } from "./mock-data";
import type { ExtendedProjectData } from "./workflow-store";

export const SAMPLE_ID_PREFIX: string;
export function buildSampleProject(): { project: Project; ext: ExtendedProjectData };

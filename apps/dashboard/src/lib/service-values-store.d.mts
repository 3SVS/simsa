export declare function saveServiceValues(projectId: string, services: unknown[]): void;
export declare function loadServiceValues(projectId: string): unknown[] | null;
export declare function clearServiceValues(projectId: string): void;
export declare function seedServiceSetup(
  projectId: string,
  spec:
    | { oneLine?: string; problem?: string; included?: string[]; userFlow?: string[]; productName?: string }
    | null
    | undefined,
): unknown[];

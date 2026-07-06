export interface CatalogEnvVar {
  key: string;
  description: string;
  /** server-only; never expose to the browser bundle */
  secret?: boolean;
  /** placeholder hint shown in the UI, never a real value */
  example?: string;
  /** filled in the browser by the setup UI; sent to export, never stored server-side */
  value?: string;
}

export interface CatalogService {
  id: string;
  label: string;
  setupUrl?: string;
  setupSteps?: string[];
  envVars: CatalogEnvVar[];
}

export declare const SERVICE_CATALOG: CatalogService[];

export declare function catalogServiceById(id: string): CatalogService | null;

export declare function detectServices(
  spec:
    | {
        oneLine?: string;
        problem?: string;
        included?: string[];
        userFlow?: string[];
        productName?: string;
      }
    | null
    | undefined,
): CatalogService[];

export declare function hasAnyValue(services: CatalogService[]): boolean;

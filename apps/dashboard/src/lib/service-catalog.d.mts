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
  /** why a non-dev might need this, one plain sentence */
  why?: string;
  setupUrl?: string;
  setupSteps?: string[];
  envVars: CatalogEnvVar[];
}

export declare const SERVICE_CATALOG: CatalogService[];

export type CatalogLocale = "en" | "ko";

export declare function catalogServiceById(id: string, locale?: CatalogLocale): CatalogService | null;

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
  locale?: CatalogLocale,
): CatalogService[];

export declare function hasAnyValue(services: CatalogService[]): boolean;

export declare function allCatalogServices(locale?: CatalogLocale): CatalogService[];

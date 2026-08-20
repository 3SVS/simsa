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

/** 스택 불가지 §3-2: 유저가 답한 조합(P1 stackProfile)의 data 축을 소비한다. */
export interface StackProfileLike {
  hosting?: { id?: string; other?: string };
  data?: { id?: string; other?: string };
}

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
  stackProfile?: StackProfileLike | null,
): CatalogService[];

/** 카탈로그에 없는 서비스를 자유텍스트 이름으로 흡수 (D-3). 빈 이름 → null. */
export declare function customServiceEntry(name: string, locale?: CatalogLocale): CatalogService | null;

export declare function hasAnyValue(services: CatalogService[]): boolean;

export declare function allCatalogServices(locale?: CatalogLocale): CatalogService[];

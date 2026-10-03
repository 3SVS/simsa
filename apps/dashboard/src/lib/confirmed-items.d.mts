export function effectiveConfirmedItemIds(
  confirmedItemIds: unknown,
  requirementIds: ReadonlyArray<string>,
): string[];

export function withUserAuthoredItems(input: {
  confirmedItemIds: unknown;
  before: ReadonlyArray<string>;
  after: ReadonlyArray<string>;
  authored: ReadonlyArray<string>;
}): string[];

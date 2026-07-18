export const SESSION_CAP: number;
export function shouldReportClientError(
  err: { message: string },
  state: { sentCount: number; seenMessages: Set<string> },
): boolean;

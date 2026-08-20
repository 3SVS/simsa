export function stackProfilePatch(
  hostingId: string | null,
  hostingOther: string,
  dataId: string | null,
  dataOther: string,
): {
  stackProfile?: {
    hosting?: { id: string; other?: string };
    data?: { id: string; other?: string };
  };
};

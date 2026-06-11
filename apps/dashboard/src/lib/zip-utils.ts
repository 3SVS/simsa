"use client";

/**
 * Client-side zip generation for the builder pack download.
 * Depends on jszip (browser-compatible).
 */

import type { ExportFile } from "./workspace-export-api";

/**
 * Generate a zip Blob from the export bundle files.
 * File paths are used as-is within the zip (includes the conclave-build-pack/ prefix).
 */
export async function buildPackToZip(files: ExportFile[]): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** Trigger a browser download of the builder pack zip. */
export async function downloadBuildPackZip(files: ExportFile[], projectTitle: string): Promise<void> {
  const blob = await buildPackToZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `conclave-build-pack.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

"use client";

/**
 * Site-wide drag-and-drop target (Bae: "드래그앤드롭은 전체 사이트 어디에 놔도
 * 들어가게"). Dropping a text document anywhere starts the spec branch with
 * the file's content prefilled.
 *
 * Reads hwpx / PDF / docx / txt / md in the browser (lib/document-extract).
 * Binary .hwp has no reliable JS parser — the notice tells the user to save
 * as hwpx/PDF from 한글. Content is handed off via sessionStorage (the file
 * itself never leaves the machine here).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { extractDocumentsText } from "@/lib/document-extract";

export const DROPPED_DOC_KEY = "simsa:dropped-doc";
export const DROPPED_DOC_NAME_KEY = "simsa:dropped-doc-name";
export const DROPPED_DOC_SKIPPED_KEY = "simsa:dropped-doc-skipped";
export function GlobalDropZone() {
  const { t } = useI18n();
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // dragenter/leave fire for every child element — depth counter avoids flicker.
  const depthRef = useRef(0);

  useEffect(() => {
    function hasFiles(e: DragEvent): boolean {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }
    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      setDragging(true);
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setDragging(false);
    }
    function noticeFor(error: string): string {
      if (error === "media") return t.dropzone.media;
      if (error === "hwp_binary") return t.dropzone.hwpBinary;
      if (error === "scanned_pdf") return t.dropzone.scannedPdf;
      if (error === "empty") return t.dropzone.empty;
      if (error === "unsupported") return t.dropzone.unsupported;
      return t.dropzone.readError;
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      setNotice(t.dropzone.reading);
      void extractDocumentsText(files).then((res) => {
        if (!res.text) {
          // Nothing readable — explain the FIRST cause instead of going quiet.
          setNotice(noticeFor(res.skipped[0]?.error ?? "read_error"));
          window.setTimeout(() => setNotice(null), 8000);
          return;
        }
        setNotice(null);
        const label =
          res.readNames.length > 1
            ? t.dropzone.multiName.replace("{first}", res.readNames[0]!).replace("{n}", String(res.readNames.length - 1))
            : res.readNames[0]!;
        try {
          window.sessionStorage.setItem(DROPPED_DOC_KEY, res.text);
          window.sessionStorage.setItem(DROPPED_DOC_NAME_KEY, label);
          if (res.skipped.length > 0) {
            window.sessionStorage.setItem(
              DROPPED_DOC_SKIPPED_KEY,
              res.skipped.map((sk) => sk.fileName).join(", "),
            );
          }
        } catch {
          setNotice(t.dropzone.readError);
          window.setTimeout(() => setNotice(null), 6000);
          return;
        }
        router.push("/projects/new?path=spec&dropped=1");
      });
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [router, t]);

  return (
    <>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-brand-600/10 backdrop-blur-[1px]">
          <div className="rounded-xl border-2 border-dashed border-brand-400 bg-white px-8 py-6 text-center shadow-lg">
            <p className="text-base font-semibold text-gray-900">{t.dropzone.title}</p>
            <p className="mt-1 text-sm text-gray-500">{t.dropzone.hint}</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 shadow-md">
          {notice}
        </div>
      )}
    </>
  );
}

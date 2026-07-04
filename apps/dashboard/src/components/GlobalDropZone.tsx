"use client";

/**
 * Site-wide drag-and-drop target (Bae: "드래그앤드롭은 전체 사이트 어디에 놔도
 * 들어가게"). Dropping a text document anywhere starts the spec branch with
 * the file's content prefilled.
 *
 * Scope (honest): reads .txt / .md / text/* client-side. PDF/Word need a
 * parsing pipeline — until then the overlay says so instead of failing
 * silently. Content is handed off via sessionStorage (never uploaded here).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";

export const DROPPED_DOC_KEY = "simsa:dropped-doc";
export const DROPPED_DOC_NAME_KEY = "simsa:dropped-doc-name";
const MAX_TEXT_BYTES = 300_000;

function isTextLike(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return /\.(txt|md|markdown)$/i.test(file.name);
}

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
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!isTextLike(file)) {
        setNotice(t.dropzone.unsupported);
        window.setTimeout(() => setNotice(null), 6000);
        return;
      }
      file
        .slice(0, MAX_TEXT_BYTES)
        .text()
        .then((text) => {
          if (!text.trim()) return;
          try {
            window.sessionStorage.setItem(DROPPED_DOC_KEY, text);
            window.sessionStorage.setItem(DROPPED_DOC_NAME_KEY, file.name);
          } catch {
            /* storage unavailable — nothing to hand off */
            return;
          }
          router.push("/projects/new?path=spec&dropped=1");
        })
        .catch(() => {
          setNotice(t.dropzone.readError);
          window.setTimeout(() => setNotice(null), 6000);
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

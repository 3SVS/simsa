import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { NAV_LABELS } from "@/lib/labels";
import { MockUserBadge } from "@/components/MockUserBadge";

const NAV_ITEMS = [
  { key: "idea", href: "idea" },
  { key: "spec", href: "spec" },
  { key: "items", href: "items" },
  { key: "checks", href: "checks" },
  { key: "fixes", href: "fixes" },
  { key: "export", href: "export" },
  { key: "settings", href: "settings" },
] as const;

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // localStorage 프로젝트는 클라이언트에서 렌더링 — 여기선 이름만 필요, 없으면 fallback
  const project = getProject(id);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <Link href="/projects" className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ← 목록
        </Link>
        <span className="text-gray-200">|</span>
        <span className="text-sm font-medium text-gray-900 truncate">
          {project?.name ?? "프로젝트"}
        </span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-48 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
          <ul className="space-y-1 py-6 px-3 flex-1">
            <li>
              <Link
                href={`/projects/${id}`}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                개요
              </Link>
            </li>
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <Link
                  href={`/projects/${id}/${item.href}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  {NAV_LABELS[item.key]}
                </Link>
              </li>
            ))}
          </ul>
          <MockUserBadge />
        </nav>

        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
  );
}

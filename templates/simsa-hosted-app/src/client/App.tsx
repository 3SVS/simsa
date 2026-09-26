/**
 * Simsa 호스팅 템플릿 — 화면 시작점.
 * 지시서(dev-spec)의 화면 정의(SCR-*)를 이 파일과 components/ 아래에 구현한다.
 * 데이터는 항상 /api/* 로만 읽고 쓴다(직접 DB 접근 없음).
 */
import { useEffect, useState } from "react";

type Item = { id: number; title: string; done: number; created_at: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) throw new Error(body.error ?? `http_${res.status}`);
  return body;
}

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api<{ items: Item[] }>("/api/items");
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api("/api/items", { method: "POST", body: JSON.stringify({ title }) });
      setTitle("");
      await load();
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  const toggle = async (it: Item) => {
    await api(`/api/items/${it.id}`, { method: "PATCH", body: JSON.stringify({ done: it.done !== 1 }) }).catch((err) => setError(String(err.message)));
    await load();
  };

  const remove = async (it: Item) => {
    await api(`/api/items/${it.id}`, { method: "DELETE" }).catch((err) => setError(String(err.message)));
    await load();
  };

  return (
    <main className="app">
      <h1>할 일</h1>
      <form onSubmit={add} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="할 일을 적고 Enter" aria-label="새 할 일" maxLength={200} />
        <button type="submit">추가</button>
      </form>
      {error && <p className="error" role="alert">문제가 생겼어요: {error}</p>}
      {loading ? (
        <p className="muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="muted">아직 할 일이 없어요.</p>
      ) : (
        <ul className="list">
          {items.map((it) => (
            <li key={it.id} className={it.done ? "done" : ""}>
              <label>
                <input type="checkbox" checked={it.done === 1} onChange={() => void toggle(it)} />
                <span>{it.title}</span>
              </label>
              <button type="button" className="ghost" onClick={() => void remove(it)} aria-label={`${it.title} 삭제`}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer className="muted small">Simsa가 호스팅 중 · 언제든 내 GitHub로 가져갈 수 있어요</footer>
    </main>
  );
}

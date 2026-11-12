"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Send } from "lucide-react";
import { ROLE_LABEL, type Role } from "@/lib/domain";
import { api, errMsg } from "@/lib/client";
import { Button, cn, ErrorNote, useToast } from "@/components/ui";

interface Message {
  id: number;
  userId: number | null;
  userName: string;
  userRole: Role | null;
  body: string;
  createdAt: string;
}

const POLL_MS = 4000;

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function day(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });
}

export function ChatPanel() {
  const toast = useToast();
  const [title, setTitle] = useState("Conversa da equipe");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useMemo(
    () => messages[messages.length - 1]?.id ?? null,
    [messages],
  );

  // Carga inicial e atualização incremental (só as mensagens novas).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const data = await api<{ title: string; messages: Message[] }>(
          "/api/chat",
        );
        if (!alive) return;
        setTitle(data.title);
        setMessages((cur) => {
          const known = new Set(cur.map((m) => m.id));
          const fresh = data.messages.filter((m) => !known.has(m.id));
          return fresh.length ? [...cur, ...fresh].slice(-300) : cur;
        });
        setError(null);
      } catch (e) {
        if (alive) setError(errMsg(e));
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Identidade de quem está logado, para alinhar as próprias mensagens à direita.
  useEffect(() => {
    api<{ user: { id: number } }>("/api/auth/me")
      .then((r) => setMe(r.user.id))
      .catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const res = await api<{ id: number; createdAt: string }>("/api/chat", {
        method: "POST",
        body: { body },
      });
      setDraft("");
      // Mostra a mensagem imediatamente; a atualização periódica confirma.
      setMessages((cur) => [
        ...cur,
        {
          id: res.id,
          userId: me,
          userName: "Você",
          userRole: null,
          body,
          createdAt: res.createdAt,
        },
      ]);
    } catch (err) {
      toast(errMsg(err), "error");
    } finally {
      setBusy(false);
    }
  }

  let lastDay = "";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col px-3 pb-3 pt-5 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Colaboradores
        </p>
        <h1 className="display mt-1.5 text-[34px]">{title}</h1>
        <p className="mb-3 text-sm text-ink-2">
          Mensagens entre a equipe de produção, qualidade, acabamento e
          logística. Atualiza sozinha.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}

        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-line bg-card p-3"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-3">
              Nenhuma mensagem ainda. Comece a conversa.
            </p>
          )}
          {messages.map((m) => {
            const mine = m.userId !== null && m.userId === me;
            const d = day(m.createdAt);
            const showDay = d !== lastDay;
            lastDay = d;
            return (
              <div key={m.id}>
                {showDay && (
                  <p className="my-2 text-center text-[11px] font-bold uppercase tracking-wide text-ink-3">
                    {d}
                  </p>
                )}
                <div
                  className={cn("flex", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-xl px-3 py-2",
                      mine ? "bg-ink text-paper" : "bg-paper-deep",
                    )}
                  >
                    <p
                      className={cn(
                        "text-[11px] font-bold",
                        mine ? "text-hivis" : "text-ink-2",
                      )}
                    >
                      {mine ? "Você" : m.userName}
                      {m.userRole && (
                        <span className="font-normal opacity-75">
                          {" "}
                          · {ROLE_LABEL[m.userRole]}
                        </span>
                      )}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {m.body}
                    </p>
                    <p
                      className={cn(
                        "tnum mt-0.5 text-right text-[10px]",
                        mine ? "text-paper/60" : "text-ink-3",
                      )}
                    >
                      {time(m.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={send} className="mt-3 flex items-end gap-2">
          <textarea
            value={draft}
            maxLength={1000}
            rows={2}
            placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)"
            aria-label="Mensagem"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(e as unknown as FormEvent);
              }
            }}
            className="min-h-11 flex-1 resize-none rounded-lg border border-ink/25 bg-white px-3 py-2 text-base outline-none focus:border-ink focus:ring-2 focus:ring-hivis sm:text-sm"
          />
          <Button
            type="submit"
            icon={<Send aria-hidden className="size-4" />}
            loading={busy}
            disabled={!draft.trim()}
          >
            Enviar
          </Button>
        </form>
        <p className="mt-1 text-right text-[11px] text-ink-3">
          {draft.length}/1000 · último id {lastId ?? "–"}
        </p>
      </div>
    </div>
  );
}

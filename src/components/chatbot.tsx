"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logEvent } from "@/lib/evaluation";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface Msg { role: "user" | "assistant"; content: string; rated?: boolean }

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi! Ask me about availability, booking rules, or your own bookings, e.g. \"Is the futsal court free tomorrow evening?\", \"Can I book Court 1 at 3pm?\" or \"When is my next booking?\"" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ messages: next.slice(-6) }),
      });
      const data = await res.json();
      setMsgs([...next, { role: "assistant", content: data.reply ?? "Sorry, something went wrong." }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "Sorry, I could not reach the server." }]);
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function rate(idx: number, helpful: boolean) {
    logEvent("chat_feedback", { bool: helpful });
    setMsgs((prev) => prev.map((m, i) => (i === idx ? { ...m, rated: true } : m)));
  }

  if (!open) {
    return (
      <Button className="fixed bottom-6 right-6 h-13 gap-2 rounded-full px-5 shadow-lg shadow-primary/25 transition-transform hover:scale-105"
        onClick={() => setOpen(true)}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
        </span>
        Ask the assistant
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-6 right-6 flex h-[500px] w-[370px] flex-col overflow-hidden rounded-2xl border-0 p-0 shadow-2xl">
      <CardHeader className="flex flex-row items-center justify-between bg-gradient-to-r from-primary to-primary/85 py-3.5 text-primary-foreground">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-bold">AI</span>
          <div>
            <CardTitle className="text-sm text-primary-foreground">Facility Assistant</CardTitle>
            <p className="text-[11px] text-primary-foreground/70">Answers from live availability</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
          onClick={() => setOpen(false)}>Close</Button>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 overflow-hidden bg-card p-3">
        <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
          {msgs.map((m, i) => (
            <div key={i}
              className={`max-w-[85%] ${m.role === "user" ? "ml-auto" : ""}`}>
              <div
                className={`whitespace-pre-wrap px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                  m.role === "user"
                    ? "rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-2xl rounded-bl-md bg-muted"
                }`}>
                {m.content}
              </div>
              {m.role === "assistant" && i > 0 && (
                <div className="flex gap-2 pl-1 pt-1">
                  {m.rated ? (
                    <span className="text-[11px] text-muted-foreground">Thanks for the feedback</span>
                  ) : (
                    <>
                      <button aria-label="Helpful" className="text-muted-foreground hover:text-foreground"
                        onClick={() => rate(i, true)}><ThumbsUp className="h-3.5 w-3.5" /></button>
                      <button aria-label="Not helpful" className="text-muted-foreground hover:text-destructive"
                        onClick={() => rate(i, false)}><ThumbsDown className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="w-fit rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">.</span>
                <span className="animate-bounce [animation-delay:120ms]">.</span>
                <span className="animate-bounce [animation-delay:240ms]">.</span>
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 border-t pt-3">
          <Input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about availability or rules..." />
          <Button onClick={send} disabled={busy}>Send</Button>
        </div>
      </CardContent>
    </Card>
  );
}

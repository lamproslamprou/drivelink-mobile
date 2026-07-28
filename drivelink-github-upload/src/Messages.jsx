import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

// Groups raw message rows into conversation threads (one per listing+counterpart pair)
function buildThreads(messages, myId) {
  const map = new Map();
  for (const m of messages) {
    const otherId = m.sender_id === myId ? m.recipient_id : m.sender_id;
    const key = `${m.listing_id}::${otherId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return [...map.entries()].map(([key, msgs]) => {
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const [listingId, otherId] = key.split("::");
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter(m => m.recipient_id === myId && !m.read).length;
    return { key, listingId, otherId, msgs, last, unread };
  }).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
}

export default function Messages({ currentUser, listings, users, openThread, onOpened }) {
  const [messages, setMessages] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  // A thread that has been opened from a listing but has no messages yet. Kept in
  // local state because the parent clears `openThread` as soon as onOpened() fires,
  // which would otherwise leave the chat pane with nothing to render.
  const [pendingThread, setPendingThread] = useState(null);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
      .order("created_at", { ascending: true });
    if (data) setMessages(data);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("messages-" + currentUser.id)
      // Listens for UPDATE as well as INSERT. Messages insert with
      // moderation_status = 'pending', which RLS hides from the recipient, so
      // the recipient never receives the INSERT event — they only become
      // visible on the UPDATE that flips the status to 'approved'.
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new;
        if (!m) return;
        if (m.sender_id === currentUser.id || m.recipient_id === currentUser.id) {
          // Don't re-add a message we already inserted optimistically.
          setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser.id]);

  useEffect(() => {
    if (openThread) {
      const listingId = String(openThread.listingId);
      const otherId = String(openThread.otherId);
      const key = `${listingId}::${otherId}`;
      setPendingThread({ key, listingId, otherId });
      setActiveKey(key);
      setSendError("");
      onOpened?.();
    }
  }, [openThread]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeKey, messages]);

  const threads = buildThreads(messages, currentUser.id);
  const active =
    threads.find(t => t.key === activeKey) ||
    (pendingThread && pendingThread.key === activeKey
      ? { ...pendingThread, msgs: [], unread: 0 }
      : null);

  const send = async () => {
    const body = draft.trim();
    if (!body || !active || sending) return;
    const row = {
      id: "m" + Date.now() + Math.random().toString(36).slice(2, 7),
      listing_id: active.listingId,
      sender_id: currentUser.id,
      recipient_id: active.otherId,
      body,
      read: false,
    };
    setDraft("");
    setSendError("");
    setSending(true);
    setMessages(prev => [...prev, { ...row, created_at: new Date().toISOString() }]);

    const { error } = await supabase.from("messages").insert(row);
    if (error) {
      setSending(false);
      // Roll the optimistic message back so the UI doesn't lie about delivery.
      setMessages(prev => prev.filter(m => m.id !== row.id));
      setDraft(body);
      setSendError(error.message || "Message didn't send. Try again.");
      return;
    }

    // Inserts with moderation_status = 'pending', so the recipient cannot see
    // it until this returns approved. On failure it stays pending, which is
    // the safe direction.
    let mod = { status: "pending" };
    try {
      const { data, error: modErr } = await supabase.functions.invoke("moderate-content", {
        body: { surface: "message", contentId: row.id },
      });
      if (modErr) {
        let parsed = null;
        try { parsed = await modErr.context?.json?.(); } catch {}
        mod = parsed?.status ? parsed : { status: "pending" };
      } else {
        mod = data;
      }
    } catch { /* stays pending */ }
    setSending(false);

    if (mod.status === "rejected" || mod.status === "blocked") {
      setMessages(prev => prev.filter(m => m.id !== row.id));
      setSendError(mod.reason || "That message violates our content policy.");
    }
  };

  const markRead = async (thread) => {
    const unreadIds = thread.msgs.filter(m => m.recipient_id === currentUser.id && !m.read).map(m => m.id);
    if (unreadIds.length) {
      setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, read: true } : m));
      await supabase.from("messages").update({ read: true }).in("id", unreadIds);
    }
  };

  const selectThread = (t) => {
    setActiveKey(t.key);
    setSendError("");
    markRead(t);
  };

  const otherName = (id) => users.find(u => u.id === id)?.name || "User";
  const listingLabel = (id) => {
    const l = listings.find(x => x.id === id);
    return l ? `${l.year} ${l.make} ${l.model}` : "Listing";
  };

  return (
    <div style={s.pageWrap}>
      <h2 style={s.pageTitle}>Messages</h2>
      <div style={s.layout}>
        <div style={s.threadList}>
          {threads.length === 0 && !pendingThread && (
            <p style={{ color: "#6b7280", padding: 16, fontSize: 13 }}>
              No conversations yet. Message a seller from a listing to start one.
            </p>
          )}
          {pendingThread && !threads.some(t => t.key === pendingThread.key) && (
            <div
              style={{ ...s.threadItem, ...(activeKey === pendingThread.key ? s.threadItemActive : {}) }}
              onClick={() => { setActiveKey(pendingThread.key); setSendError(""); }}
            >
              <div style={s.threadTop}>
                <span style={s.threadName}>{otherName(pendingThread.otherId)}</span>
              </div>
              <div style={s.threadSub}>{listingLabel(pendingThread.listingId)}</div>
              <div style={{ ...s.threadPreview, fontStyle: "italic" }}>New conversation</div>
            </div>
          )}
          {threads.map(t => (
            <div
              key={t.key}
              style={{ ...s.threadItem, ...(activeKey === t.key ? s.threadItemActive : {}) }}
              onClick={() => selectThread(t)}
            >
              <div style={s.threadTop}>
                <span style={s.threadName}>{otherName(t.otherId)}</span>
                {t.unread > 0 && <span style={s.unreadDot}>{t.unread}</span>}
              </div>
              <div style={s.threadSub}>{listingLabel(t.listingId)}</div>
              <div style={s.threadPreview}>{t.last.body}</div>
            </div>
          ))}
        </div>
        <div style={s.chatPane}>
          {!active ? (
            <div style={s.emptyChat}>Select a conversation</div>
          ) : (
            <>
              <div style={s.chatHeader}>
                <b>{otherName(active.otherId)}</b> — {listingLabel(active.listingId)}
              </div>
              <div style={s.chatBody}>
                {active.msgs.length === 0 && (
                  <div style={s.firstMsgHint}>
                    Say hello — ask about condition, service history, or set up a time to see the car.
                  </div>
                )}
                {active.msgs.map(m => (
                  <div key={m.id} style={{ ...s.bubble, ...(m.sender_id === currentUser.id ? s.bubbleMine : s.bubbleTheirs) }}>
                    {m.body}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              {sendError && <div style={s.errorBar}>{sendError}</div>}
              <div style={s.chatInputRow}>
                <input
                  style={s.chatInput}
                  placeholder="Type a message…"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && send()}
                />
                <button style={{ ...s.sendBtn, ...(sending ? s.sendBtnDisabled : {}) }} onClick={send} disabled={sending}>
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  pageWrap: { paddingTop: 36 },
  pageTitle: { fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 24, letterSpacing: "-0.02em" },
  layout: { display: "flex", gap: 20, background: "#fff", borderRadius: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)", minHeight: 480, overflow: "hidden" },
  threadList: { width: 300, flexShrink: 0, borderRight: "1px solid #e5e7eb", overflowY: "auto", maxHeight: 560 },
  threadItem: { padding: "14px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer" },
  threadItemActive: { background: "#f1f5f9" },
  threadTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  threadName: { fontWeight: 700, fontSize: 14, color: "#0f172a" },
  unreadDot: { background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "1px 7px" },
  threadSub: { fontSize: 12, color: "#3b82f6", marginTop: 2 },
  threadPreview: { fontSize: 12, color: "#6b7280", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chatPane: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  emptyChat: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af", fontSize: 14 },
  chatHeader: { padding: "14px 20px", borderBottom: "1px solid #e5e7eb", fontSize: 14, color: "#374151" },
  chatBody: { flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, maxHeight: 420 },
  firstMsgHint: { color: "#9ca3af", fontSize: 13, textAlign: "center", padding: "24px 12px", lineHeight: 1.5 },
  bubble: { maxWidth: "70%", padding: "8px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.4 },
  bubbleMine: { alignSelf: "flex-end", background: "#0f172a", color: "#fff" },
  bubbleTheirs: { alignSelf: "flex-start", background: "#f1f5f9", color: "#0f172a" },
  errorBar: { background: "#fef2f2", color: "#b91c1c", fontSize: 12, padding: "8px 16px", borderTop: "1px solid #fecaca" },
  chatInputRow: { display: "flex", gap: 10, padding: 16, borderTop: "1px solid #e5e7eb" },
  chatInput: { flex: 1, minWidth: 0, padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none" },
  sendBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  sendBtnDisabled: { opacity: 0.6, cursor: "default" },
};

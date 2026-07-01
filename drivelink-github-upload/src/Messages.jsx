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
  const [draft, setDraft] = useState("");
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new;
        if (m.sender_id === currentUser.id || m.recipient_id === currentUser.id) {
          setMessages(prev => [...prev, m]);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser.id]);

  useEffect(() => {
    if (openThread) {
      const key = `${openThread.listingId}::${openThread.otherId}`;
      setActiveKey(key);
      onOpened?.();
    }
  }, [openThread]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeKey, messages]);

  const threads = buildThreads(messages, currentUser.id);
  const active = threads.find(t => t.key === activeKey) ||
    (openThread ? { key: activeKey, listingId: openThread.listingId, otherId: openThread.otherId, msgs: [], unread: 0 } : null);

  const send = async () => {
    if (!draft.trim() || !active) return;
    const row = {
      id: "m" + Date.now(),
      listing_id: active.listingId,
      sender_id: currentUser.id,
      recipient_id: active.otherId,
      body: draft.trim(),
      read: false,
    };
    setDraft("");
    setMessages(prev => [...prev, { ...row, created_at: new Date().toISOString() }]);
    await supabase.from("messages").insert(row);
  };

  const markRead = async (thread) => {
    const unreadIds = thread.msgs.filter(m => m.recipient_id === currentUser.id && !m.read).map(m => m.id);
    if (unreadIds.length) {
      setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, read: true } : m));
      await supabase.from("messages").update({ read: true }).in("id", unreadIds);
    }
  };

  return (
    <div style={s.pageWrap}>
      <h2 style={s.pageTitle}>Messages</h2>
      <div style={s.layout}>
        <div style={s.threadList}>
          {threads.length === 0 && <p style={{ color: "#6b7280", padding: 16, fontSize: 13 }}>No conversations yet. Message a seller from a listing to start one.</p>}
          {threads.map(t => {
            const other = users.find(u => u.id === t.otherId);
            const listing = listings.find(l => l.id === t.listingId);
            return (
              <div
                key={t.key}
                style={{ ...s.threadItem, ...(activeKey === t.key ? s.threadItemActive : {}) }}
                onClick={() => { setActiveKey(t.key); markRead(t); }}
              >
                <div style={s.threadTop}>
                  <span style={s.threadName}>{other?.name || "User"}</span>
                  {t.unread > 0 && <span style={s.unreadDot}>{t.unread}</span>}
                </div>
                <div style={s.threadSub}>{listing ? `${listing.year} ${listing.make} ${listing.model}` : "Listing"}</div>
                <div style={s.threadPreview}>{t.last.body}</div>
              </div>
            );
          })}
        </div>
        <div style={s.chatPane}>
          {!active ? (
            <div style={s.emptyChat}>Select a conversation</div>
          ) : (
            <>
              <div style={s.chatHeader}>
                {(() => {
                  const other = users.find(u => u.id === active.otherId);
                  const listing = listings.find(l => l.id === active.listingId);
                  return <><b>{other?.name || "User"}</b> — {listing ? `${listing.year} ${listing.make} ${listing.model}` : "Listing"}</>;
                })()}
              </div>
              <div style={s.chatBody}>
                {active.msgs.map(m => (
                  <div key={m.id} style={{ ...s.bubble, ...(m.sender_id === currentUser.id ? s.bubbleMine : s.bubbleTheirs) }}>
                    {m.body}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div style={s.chatInputRow}>
                <input
                  style={s.chatInput}
                  placeholder="Type a message…"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && send()}
                />
                <button style={s.sendBtn} onClick={send}>Send</button>
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
  chatPane: { flex: 1, display: "flex", flexDirection: "column" },
  emptyChat: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af", fontSize: 14 },
  chatHeader: { padding: "14px 20px", borderBottom: "1px solid #e5e7eb", fontSize: 14, color: "#374151" },
  chatBody: { flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, maxHeight: 420 },
  bubble: { maxWidth: "70%", padding: "8px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.4 },
  bubbleMine: { alignSelf: "flex-end", background: "#0f172a", color: "#fff" },
  bubbleTheirs: { alignSelf: "flex-start", background: "#f1f5f9", color: "#0f172a" },
  chatInputRow: { display: "flex", gap: 10, padding: 16, borderTop: "1px solid #e5e7eb" },
  chatInput: { flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none" },
  sendBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};

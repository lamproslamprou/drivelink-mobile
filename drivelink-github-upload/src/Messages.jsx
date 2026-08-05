import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

// Listing states where money is in flight. A thread attached to one of these is
// the only record of what the two parties agreed to, so it can't be removed
// from either inbox until the transaction resolves.
const LOCKED_LISTING_STATES = ["pending_confirmation", "sold", "disputed"];

const MOBILE_BREAKPOINT = 760;

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

// Where a thread belongs right now, for THIS user only.
//
// hidden_at / archived_at are timestamps rather than booleans on purpose: a
// thread is only out of the inbox while nothing has happened since you removed
// it. The moment the other party writes again the thread resurfaces, because
// silently swallowing incoming messages forever is worse than having no delete
// at all. It also means "delete" can never lose a message — only the ones you
// had already read.
function threadState(thread, hideRow) {
  if (!hideRow) return "inbox";
  const lastAt = new Date(thread.last.created_at).getTime();
  if (hideRow.hidden_at && lastAt <= new Date(hideRow.hidden_at).getTime()) return "hidden";
  if (hideRow.archived_at && lastAt <= new Date(hideRow.archived_at).getTime()) return "archived";
  return "inbox";
}

export default function Messages({ currentUser, listings, users, offers, openThread, onOpened }) {
  const [messages, setMessages] = useState([]);
  const [hideRows, setHideRows] = useState([]);
  const [tab, setTab] = useState("inbox"); // "inbox" | "archived"
  const [activeKey, setActiveKey] = useState(null);
  // A thread that has been opened from a listing but has no messages yet. Kept in
  // local state because the parent clears `openThread` as soon as onOpened() fires,
  // which would otherwise leave the chat pane with nothing to render.
  const [pendingThread, setPendingThread] = useState(null);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [actionError, setActionError] = useState("");
  const [sending, setSending] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false
  );
  const bottomRef = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
      .order("created_at", { ascending: true });
    if (data) setMessages(data);
  };

  const loadHidden = async () => {
    const { data } = await supabase
      .from("conversation_hidden")
      .select("*")
      .eq("user_id", currentUser.id);
    if (data) setHideRows(data);
  };

  useEffect(() => {
    load();
    loadHidden();
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
      setTab("inbox");
      onOpened?.();
    }
  }, [openThread]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeKey, messages]);

  const allThreads = buildThreads(messages, currentUser.id);
  const hideByKey = new Map(hideRows.map(r => [`${r.listing_id}::${r.other_user_id}`, r]));

  const inboxThreads = allThreads.filter(t => threadState(t, hideByKey.get(t.key)) === "inbox");
  const archivedThreads = allThreads.filter(t => threadState(t, hideByKey.get(t.key)) === "archived");
  const visibleThreads = tab === "inbox" ? inboxThreads : archivedThreads;

  const active =
    allThreads.find(t => t.key === activeKey) ||
    (pendingThread && pendingThread.key === activeKey
      ? { ...pendingThread, msgs: [], unread: 0 }
      : null);

  // ── Guard ───────────────────────────────────────────────────────────────────
  // Returns a reason string if this thread can't be removed, or null if it can.
  const removalBlockedReason = (thread) => {
    if (!thread) return null;
    const listing = listings.find(l => l.id === thread.listingId);
    if (listing && LOCKED_LISTING_STATES.includes(listing.status)) {
      return "This car has a sale in progress — the conversation stays available until it's resolved.";
    }
    const liveOffer = (offers || []).find(
      o => o.listing_id === thread.listingId &&
           (o.status === "pending" || o.status === "countered" || o.status === "accepted") &&
           (o.buyer_id === thread.otherId || o.seller_id === thread.otherId)
    );
    if (liveOffer) {
      return "There's an open offer on this car — the conversation stays available until it's settled.";
    }
    return null;
  };

  // ── Archive / delete / restore ──────────────────────────────────────────────
  // All three write the same per-user row. Nothing is ever deleted: the other
  // party's copy of the thread is untouched and every message stays in the
  // database, which is what makes a dispute arbitrable later.
  const setHidden = async (thread, patch) => {
    setActionError("");
    const row = {
      user_id: currentUser.id,
      listing_id: thread.listingId,
      other_user_id: thread.otherId,
      hidden_at: null,
      archived_at: null,
      ...patch,
    };
    const existing = hideByKey.get(thread.key);
    setHideRows(prev => {
      const rest = prev.filter(r => !(r.listing_id === thread.listingId && r.other_user_id === thread.otherId));
      return [...rest, row];
    });
    const { error } = await supabase
      .from("conversation_hidden")
      .upsert(row, { onConflict: "user_id,listing_id,other_user_id" });
    if (error) {
      // Roll back so the UI doesn't claim something the database refused.
      setHideRows(prev => {
        const rest = prev.filter(r => !(r.listing_id === thread.listingId && r.other_user_id === thread.otherId));
        return existing ? [...rest, existing] : rest;
      });
      setActionError("Couldn't update that conversation — try again.");
      return false;
    }
    return true;
  };

  const archiveThread = async (thread) => {
    const blocked = removalBlockedReason(thread);
    if (blocked) { setActionError(blocked); return; }
    const ok = await setHidden(thread, { archived_at: new Date().toISOString() });
    if (ok && activeKey === thread.key) setActiveKey(null);
  };

  const deleteThread = async (thread) => {
    const blocked = removalBlockedReason(thread);
    if (blocked) { setActionError(blocked); return; }
    const who = otherName(thread.otherId);
    const confirmed = window.confirm(
      `Delete your copy of this conversation with ${who}?\n\n` +
      `It disappears from your inbox only — ${who} keeps their copy, and if they message you again the thread comes back.`
    );
    if (!confirmed) return;
    const ok = await setHidden(thread, { hidden_at: new Date().toISOString() });
    if (ok && activeKey === thread.key) setActiveKey(null);
  };

  const restoreThread = async (thread) => {
    await setHidden(thread, {});
    setTab("inbox");
  };

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
    setActionError("");
    markRead(t);
  };

  const otherName = (id) => users.find(u => u.id === id)?.name || "User";
  const listingLabel = (id) => {
    const l = listings.find(x => x.id === id);
    return l ? `${l.year} ${l.make} ${l.model}` : "Listing";
  };

  // On a phone the list and the chat are separate screens, not columns.
  const showList = !isMobile || !active;
  const showChat = !isMobile || !!active;

  const emptyCopy = tab === "archived"
    ? "Nothing archived."
    : "No conversations yet. Message a seller from a listing to start one.";

  return (
    <div style={s.pageWrap}>
      <h2 style={s.pageTitle}>Messages</h2>

      <div style={s.tabRow}>
        <button
          style={{ ...s.tabBtn, ...(tab === "inbox" ? s.tabBtnActive : {}) }}
          onClick={() => { setTab("inbox"); setActiveKey(null); }}
        >
          Inbox{inboxThreads.length ? ` (${inboxThreads.length})` : ""}
        </button>
        <button
          style={{ ...s.tabBtn, ...(tab === "archived" ? s.tabBtnActive : {}) }}
          onClick={() => { setTab("archived"); setActiveKey(null); }}
        >
          Archived{archivedThreads.length ? ` (${archivedThreads.length})` : ""}
        </button>
      </div>

      {actionError && <div style={s.actionBar}>{actionError}</div>}

      <div style={{ ...s.layout, ...(isMobile ? s.layoutMobile : {}) }}>
        {showList && (
          <div style={{ ...s.threadList, ...(isMobile ? s.threadListMobile : {}) }}>
            {visibleThreads.length === 0 && !pendingThread && (
              <p style={{ color: "#6b7280", padding: 16, fontSize: 13 }}>{emptyCopy}</p>
            )}
            {tab === "inbox" && pendingThread && !allThreads.some(t => t.key === pendingThread.key) && (
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
            {visibleThreads.map(t => (
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
                {tab === "archived" && (
                  <button
                    style={s.inlineAction}
                    onClick={(e) => { e.stopPropagation(); restoreThread(t); }}
                  >
                    Move back to inbox
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {showChat && (
          <div style={s.chatPane}>
            {!active ? (
              <div style={s.emptyChat}>Select a conversation</div>
            ) : (
              <>
                <div style={s.chatHeader}>
                  <div style={s.chatHeaderTop}>
                    {isMobile && (
                      <button style={s.backBtn} onClick={() => setActiveKey(null)}>← All</button>
                    )}
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <b>{otherName(active.otherId)}</b> — {listingLabel(active.listingId)}
                    </span>
                  </div>
                  {active.msgs.length > 0 && (
                    <div style={s.chatHeaderActions}>
                      <button style={s.headerAction} onClick={() => archiveThread(active)}>Archive</button>
                      <button style={{ ...s.headerAction, color: "#b91c1c" }} onClick={() => deleteThread(active)}>Delete</button>
                    </div>
                  )}
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
        )}
      </div>
    </div>
  );
}

const s = {
  pageWrap: { paddingTop: 36 },
  pageTitle: { fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 16, letterSpacing: "-0.02em" },
  tabRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  tabBtn: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 999, padding: "7px 16px", fontSize: 13, fontWeight: 600, color: "#6b7280", cursor: "pointer" },
  tabBtnActive: { background: "#0f172a", borderColor: "#0f172a", color: "#fff" },
  actionBar: { background: "#fffbeb", color: "#92400e", fontSize: 13, padding: "10px 14px", borderRadius: 10, border: "1px solid #fde68a", marginBottom: 12, lineHeight: 1.45 },
  layout: { display: "flex", gap: 20, background: "#fff", borderRadius: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)", minHeight: 480, overflow: "hidden" },
  layoutMobile: { gap: 0, minHeight: 420 },
  threadList: { width: 300, flexShrink: 0, borderRight: "1px solid #e5e7eb", overflowY: "auto", maxHeight: 560 },
  threadListMobile: { width: "100%", borderRight: "none", maxHeight: "none" },
  threadItem: { padding: "14px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer" },
  threadItemActive: { background: "#f1f5f9" },
  threadTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  threadName: { fontWeight: 700, fontSize: 14, color: "#0f172a", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  unreadDot: { background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "1px 7px", flexShrink: 0 },
  threadSub: { fontSize: 12, color: "#3b82f6", marginTop: 2 },
  threadPreview: { fontSize: 12, color: "#6b7280", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  inlineAction: { marginTop: 8, background: "none", border: "none", padding: 0, color: "#3b82f6", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  chatPane: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  emptyChat: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 200, color: "#9ca3af", fontSize: 14 },
  chatHeader: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb", fontSize: 14, color: "#374151", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  chatHeaderTop: { display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 },
  chatHeaderActions: { display: "flex", gap: 6, flexShrink: 0 },
  backBtn: { background: "none", border: "none", color: "#3b82f6", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, flexShrink: 0 },
  headerAction: { background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer" },
  chatBody: { flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, maxHeight: 420 },
  firstMsgHint: { color: "#9ca3af", fontSize: 13, textAlign: "center", padding: "24px 12px", lineHeight: 1.5 },
  bubble: { maxWidth: "70%", padding: "8px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.4, wordBreak: "break-word" },
  bubbleMine: { alignSelf: "flex-end", background: "#0f172a", color: "#fff" },
  bubbleTheirs: { alignSelf: "flex-start", background: "#f1f5f9", color: "#0f172a" },
  errorBar: { background: "#fef2f2", color: "#b91c1c", fontSize: 12, padding: "8px 16px", borderTop: "1px solid #fecaca" },
  chatInputRow: { display: "flex", gap: 10, padding: 16, borderTop: "1px solid #e5e7eb" },
  chatInput: { flex: 1, minWidth: 0, padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none" },
  sendBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14, flexShrink: 0 },
  sendBtnDisabled: { opacity: 0.6, cursor: "default" },
};

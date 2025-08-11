import React, { useEffect, useMemo, useRef, useState } from "react";
import Client from "/src/client.jsx";

/** Connection + ident (same for both bots) */
const WS_URL = "wss://cs.mobstudio.ru:6672";
const IDENT  = ":ru IDENT 352 -2 4030 1 2 :GALA";

/** Tunables (reliability/UX) */
const LOG_LIMIT           = 1200; // how many log lines to keep in UI
const QUIT_AFTER_MS       = 30;   // tiny delay after last ACTION before QUIT
const SEND_OFFSET_MS      = 0;    // deadline fine-tune (ms, can be negative)
const RELOGIN_DELAY       = 200;  // base delay before auto re-login
const RELOGIN_COOLDOWN_MS = 1200; // extra cooldown to remain offline before re-login

/** Parse player IDs from "353" lines. Pattern: g<digits> <ID> and any big numbers (>=7 digits). */
function parse353Ids(line) {
  const ids = new Set();
  let m;
  const reG = /g\d+\s+(\d{6,})\b/g;
  while ((m = reG.exec(line)) !== null) ids.add(m[1]);
  const reBig = /\b(\d{7,})\b/g;
  while ((m = reBig.exec(line)) !== null) ids.add(m[1]);
  return [...ids];
}

/** Parse player IDs from "860" lines: take all big numbers (>=7 digits). */
function parse860Ids(line) {
  const ids = new Set();
  let m; const re = /\b(\d{7,})\b/g;
  while ((m = re.exec(line)) !== null) ids.add(m[1]);
  return [...ids];
}

/** One independent bot (WS client + full cycle automation) */
function Bot({ label }) {
  // --- client
  const client = useMemo(() => new Client({ url: WS_URL, ident: IDENT }), []);
  const clientRef = useRef(client);

  // --- UI state
  const [log, setLog] = useState([]);
  const [uiIds, setUiIds] = useState([]);     // list of player IDs for UI
  const [connected, setConnected] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [recoverCode, setRecoverCode] = useState("");
  const recoverRef = useRef("");

  const [autoRun, setAutoRun] = useState(true);
  const [delayMs, setDelayMs] = useState(2050); // full cycle delay in ms (per bot)
  const [founderId, setFounderId] = useState(null); // 👑 (for UI)
  const [myId, setMyId] = useState(null);           // your own ID if available
  const [lastShot, setLastShot] = useState(null);   // { elapsedMs, caught3s, targets }

  // --- live settings/values for handlers (avoid effect re-bind)
  const settingsRef  = useRef({ autoRun: true, delayMs: 2050 });
  const founderIdRef = useRef(null);
  const myIdRef      = useRef(null);
  useEffect(() => { settingsRef.current.autoRun = autoRun; }, [autoRun]);
  useEffect(() => { settingsRef.current.delayMs = delayMs; }, [delayMs]);
  useEffect(() => { founderIdRef.current = founderId; }, [founderId]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

  // --- runtime pools/SM
  const idsRef = useRef(new Set()); // current players on planet (IDs)
  const sm = useRef({
    onPlanet: false,
    joinAt: 0,
    deadlineTs: 0,
    timers: { deadline: null, quit: null, relogin: null },
  });

  // --- logging
  const addLog = (prefix, m) => {
    setLog((l) => {
      const next = [...l, `${prefix} ${m}`];
      if (next.length > LOG_LIMIT) next.splice(0, next.length - LOG_LIMIT);
      return next;
    });
  };
  const appLog = (m) => addLog("[APP]", m);

  // --- players pool
  const mergeIds = (arr) => {
    if (!arr?.length) return;
    let changed = false;
    for (const id of arr) if (!idsRef.current.has(id)) { idsRef.current.add(id); changed = true; }
    if (changed) setUiIds(Array.from(idsRef.current));
  };
  const getTargetsNow = () => {
    const all = Array.from(idsRef.current);
    const king = founderIdRef.current;
    const me   = myIdRef.current;
    return all.filter((id) => id && id !== king && id !== me);
  };

  // --- action & quit
  const markShot = (sentCount) => {
    const elapsedMs = Date.now() - sm.current.joinAt;
    const caught3s  = elapsedMs >= 3000; // visual “caught 3s” mark
    setLastShot({ elapsedMs, caught3s, targets: sentCount });
    appLog(
      caught3s
        ? `3s caught: ACTION at ${elapsedMs} ms, targets: ${sentCount}`
        : `<3s: ACTION at ${elapsedMs} ms, targets: ${sentCount}`
    );
  };

  const quitNow = () => {
    clearTimeout(sm.current.timers.quit);
    sm.current.timers.quit = setTimeout(() => {
      appLog("QUIT.");
      clientRef.current.send("QUIT :ds");
      clientRef.current.close(); // close WS; offClose will handle re-login if enabled
    }, QUIT_AFTER_MS);
  };

  const performActionsAndQuit = () => {
    const king = String(founderIdRef.current ?? "");
    const rawTargets = getTargetsNow();
    const targets = rawTargets.filter((id) => String(id) !== king); // extra safety

    if (!targets.length) { appLog("No targets → QUIT."); quitNow(); return; }

    appLog(`Targets: ${targets.length}. Sending ACTION 3 ...`);
    targets.forEach((id) => {
      if (String(id) === king) { addLog("[APP]", `SKIP king ${id}`); return; }
      addLog("[APP]", `ACTION 3 ${id}`);
      client.send(`ACTION 3 ${id}`);
    });

    markShot(targets.length);
    quitNow();
  };

  // --- cycle
  const startCycle = () => {
    const delay = Math.max(0, Number(settingsRef.current.delayMs) || 0);
    const s = sm.current;
    s.onPlanet = true;
    s.joinAt = Date.now();
    s.deadlineTs = s.joinAt + delay + SEND_OFFSET_MS;

    idsRef.current.clear();
    setUiIds([]);
    setLastShot(null);

    appLog(`Старт цикла. Интервал = ${delay} мс. Ждём...`);
    clearTimeout(s.timers.deadline);
    s.timers.deadline = setTimeout(() => performActionsAndQuit(), Math.max(0, s.deadlineTs - Date.now()));
  };

  const doJoin = () => {
    client.send("FWLISTVER 311");
    client.send("ADDONS 251920 1");
    client.send("MYADDONS 251920 1");
    client.send("PHONE 1440 932 0 2 :chrome 138.0.0.0");
    client.send("JOIN");
    appLog("JOIN отправлен.");
    startCycle();
  };

  // --- bind handlers once (per bot)
  useEffect(() => {
    const offOpen  = client.on("open",  () => setConnected(true));
    const offClose = client.on("close", () => {
      setConnected(false); setAuthOk(false);
      if (settingsRef.current.autoRun && recoverRef.current) {
        clearTimeout(sm.current.timers.relogin);
        sm.current.timers.relogin = setTimeout(() => {
          appLog("Перезаход...");
          client.reset();
          client.startLogin(recoverRef.current);
        }, RELOGIN_DELAY + RELOGIN_COOLDOWN_MS);
      }
    });
    const offAuth = client.on("auth_ok", () => { setAuthOk(true); /* setMyId("...") if known */ doJoin(); });
    const offTx   = client.on("tx",   (m) => addLog("=>", m));
    const offLine = client.on("line", (m) => {
      addLog("<=", m);
      if (m.startsWith("353 ")) { mergeIds(parse353Ids(m)); return; }
      if (m.startsWith("860 ")) { mergeIds(parse860Ids(m)); return; }
      // robust king parsing: FOUNDER 123 / FO 123; ignore FO 0
      const fMatch = m.match(/\bFO(?:UNDER)?\s+(\d+)\b/i);
      if (fMatch) {
        const id = String(fMatch[1]);
        if (id !== "0") { setFounderId(id); founderIdRef.current = id; appLog(`FOUNDER (king) = ${id}`); }
      }
    });
    const offMsg = client.on("message", (line) => {
      const head = line.split(" ")[0];
      if (head === "353") { mergeIds(parse353Ids(line)); return; }
      if (head === "860") { mergeIds(parse860Ids(line)); return; }
      const fMatch = line.match(/\bFO(?:UNDER)?\s+(\d+)\b/i);
      if (fMatch) {
        const id = String(fMatch[1]);
        if (id !== "0") { setFounderId(id); founderIdRef.current = id; appLog(`FOUNDER (king) = ${id}`); }
      }
    });
    return () => {
      offOpen(); offClose(); offAuth(); offTx(); offLine(); offMsg();
      clearTimeout(sm.current.timers.deadline);
      clearTimeout(sm.current.timers.quit);
      clearTimeout(sm.current.timers.relogin);
      client.close();
    };
  }, [client]);

  // --- UI handlers
  const handleLogin = (e) => {
    e?.preventDefault?.();
    if (!recoverCode.trim()) return;
    setLog([]); setUiIds([]); setFounderId(null); setLastShot(null);
    idsRef.current.clear();
    sm.current = { onPlanet:false, joinAt:0, deadlineTs:0, timers:{ deadline:null, quit:null, relogin:null } };
    recoverRef.current = recoverCode.trim();
    client.reset(); client.startLogin(recoverRef.current);
    appLog("Логин по RECOVER_CODE.");
  };
  const handleQuit = () => { clientRef.current.send("QUIT :ds"); clientRef.current.close(); appLog("Ручной выход."); };

  // --- small status badge for “3s caught”
  const ShotBadge = () => {
    if (!lastShot) return <span style={{padding:"2px 8px",borderRadius:12,background:"#333",color:"#fff"}}>3s: — (ждём)</span>;
    const ok = lastShot.caught3s;
    return (
      <span
        title={`ACTION через ${lastShot.elapsedMs} мс, целей: ${lastShot.targets}`}
        style={{padding:"2px 8px",borderRadius:12,background: ok ? "#0b8c2a" : "#b2262a",color:"#fff",fontWeight:700}}
      >
        {ok ? `3s OK (${lastShot.elapsedMs} мс)` : `Раньше 3s (${lastShot.elapsedMs} мс)`}
      </span>
    );
  };

  // --- render (panel for one bot)
  return (
    <div style={{ border:"1px solid #333", borderRadius:10, padding:10, marginBottom:14 }}>
      <div style={{ fontWeight:700, marginBottom:6 }}>{label}</div>

      <form onSubmit={handleLogin} style={{ display:"flex", gap:8, marginBottom:8 }}>
        <input placeholder="RECOVER_CODE" value={recoverCode} onChange={(e) => setRecoverCode(e.target.value)} disabled={authOk} />
        <button type="submit" disabled={authOk || !recoverCode.trim()}>Войти</button>
      </form>

      <div style={{ marginBottom:8, display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
        <button onClick={handleQuit}>Выход</button>
        <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
          Интервал (мс):
          <input type="number" step="1" min="0" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value) || 0)} style={{ width:90 }} />
        </label>
        <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
          <input type="checkbox" checked={autoRun} onChange={(e)=>setAutoRun(e.target.checked)} />
          Авто-повтор заходов
        </label>
        <ShotBadge />
        <span>WS: {connected ? "connected" : "disconnected"} | AUTH: {authOk ? "OK" : "—"}</span>
      </div>

      <div style={{ marginBottom:8 }}>
        <strong>Игроки (ID):</strong>
        <ul>{uiIds.map((id) => <li key={id}>{id}{id===founderId ? "King" : ""}{id===myId ? " (я)" : ""}</li>)}</ul>
      </div>

      <pre style={{ maxHeight:300, overflow:"auto", background:"#111", color:"#0f0", padding:8 }}>
        {log.join("\n")}
      </pre>
    </div>
  );
}

/** Render two independent bots */
export default function PrisonMulti() {
  return (
    <div style={{ fontFamily: "monospace" }}>
      <Bot label="Bot 1" />
      <Bot label="Bot 2" />
    </div>
  );
}

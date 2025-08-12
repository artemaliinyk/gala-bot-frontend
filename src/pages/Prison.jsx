import React, { useEffect, useMemo, useRef, useState } from "react";
import Client from "/src/client.jsx";

/** Connection + ident */
const WS_URL = "wss://cs.mobstudio.ru:6672";
const IDENT = ":ru IDENT 352 -2 4030 1 2 :GALA";

/** Tunables */
const LOG_LIMIT = 1200;
const QUIT_AFTER_MS = 30;
const SEND_OFFSET_MS = 0;
const RELOGIN_DELAY = 200;
const RELOGIN_COOLDOWN_MS = 1200;

/** Utils */
const mkLogger = (set) => (p, m) =>
  set((l) => {
    const next = [...l, `${p} ${m}`];
    if (next.length > LOG_LIMIT) next.splice(0, next.length - LOG_LIMIT);
    return next;
  });

/** Player model */
function upsert(map, id, patch = {}) {
  if (!id) return;
  const k = String(id);
  const prev = map.get(k) || { id: k, nick: null, clan: null, present: false, isKing: false, isMe: false };
  map.set(k, { ...prev, ...patch });
}
const show = (p) => `${p.clan ? `[${p.clan}]` : ""}${p.nick ?? "—"}`;

/** ---- Bot ---- */
function Bot({ label: caption }) {
  const client = useMemo(() => new Client({ url: WS_URL, ident: IDENT }), []);
  const clientRef = useRef(client);

  const [log, setLog] = useState([]);
  const addLog = mkLogger(setLog);
  const appLog = (m) => addLog("[APP]", m);

  const [connected, setConnected] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [recoverCode, setRecoverCode] = useState("");
  const recoverRef = useRef("");

  const [autoRun, setAutoRun] = useState(true);
  const [delayMs, setDelayMs] = useState(2050);

  const [founderId, setFounderId] = useState(null);
  const [myId, setMyId] = useState(null);

  const [uiPlayers, setUiPlayers] = useState([]);
  const [lastShot, setLastShot] = useState(null);

  const settingsRef = useRef({ autoRun: true, delayMs: 2050 });
  const founderIdRef = useRef(null);
  const myIdRef = useRef(null);
  useEffect(() => {
    settingsRef.current.autoRun = autoRun;
  }, [autoRun]);
  useEffect(() => {
    settingsRef.current.delayMs = delayMs;
  }, [delayMs]);
  useEffect(() => {
    founderIdRef.current = founderId;
  }, [founderId]);
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);

  // players
  const playersRef = useRef(new Map()); // Map<id, {id,nick,clan,present,isKing,isMe}>

  // SM
  const sm = useRef({
    onPlanet: false,
    joinAt: 0,
    deadlineTs: 0,
    timers: { deadline: null, quit: null, relogin: null, waitResume: null },
    waitingForTarget: false,
    selfJoinPending: false, 
  });

  /** Roster/UI */
  const refreshUi = () => {
    const arr = Array.from(playersRef.current.values())
      .filter((p) => p.present && (p.nick || p.clan))
      .sort((a, b) => {
        if (a.isKing && !b.isKing) return -1;
        if (!a.isKing && b.isKing) return 1;
        if (a.isMe && !b.isMe) return -1;
        if (!a.isMe && b.isMe) return 1;
        const an = `${a.clan ?? ""} ${a.nick ?? ""}`.trim();
        const bn = `${b.clan ?? ""} ${b.nick ?? ""}`.trim();
        return an.localeCompare(bn, undefined, { sensitivity: "base" });
      });
    setUiPlayers(arr);
  };

  const getTargets = () => {
    const king = String(founderIdRef.current ?? "");
    const me = String(myIdRef.current ?? "");
    return Array.from(playersRef.current.values())
      .filter((p) => p.present)
      .filter((p) => String(p.id) !== king)
      .filter((p) => String(p.id) !== me);
  };

  /** Action & Quit */
  const markShot = (count) => {
    const elapsedMs = Date.now() - sm.current.joinAt;
    const caught3s = elapsedMs >= 3000;
    setLastShot({ elapsedMs, caught3s, targets: count });
    appLog(
      caught3s
        ? `3s caught: ACTION at ${elapsedMs} ms, targets: ${count}`
        : `<3s: ACTION at ${elapsedMs} ms, targets: ${count}`
    );
  };

  const quitSoon = () => {
    clearTimeout(sm.current.timers.quit);
    sm.current.timers.quit = setTimeout(() => {
      appLog("QUIT.");
      clientRef.current.send("QUIT :ds");
      clientRef.current.close();
    }, QUIT_AFTER_MS);
  };

  const sendActions = (targets) => {
    appLog(`Targets: ${targets.length}. Sending ACTION 3 ...`);
    for (const p of targets) {
      addLog("[APP]", `ACTION 3 ${p.id} (${show(p)})`);
      client.send(`ACTION 3 ${p.id}`);
    }
    markShot(targets.length);
  };

  const performActionsOrWait = (why = "deadline") => {
    const targets = getTargets();
    if (!targets.length) {
      sm.current.waitingForTarget = true;
      appLog(`No targets → stay & wait (${why}).`);
      return;
    }
    sm.current.waitingForTarget = false;
    sendActions(targets);
    quitSoon();
  };

  /** Cycle */
  const startCycle = () => {
    const delay = Math.max(0, Number(settingsRef.current.delayMs) || 0);
    const s = sm.current;
    s.onPlanet = true;
    s.joinAt = Date.now();
    s.deadlineTs = s.joinAt + delay + SEND_OFFSET_MS;
    s.waitingForTarget = false;
    clearTimeout(s.timers.waitResume);

    playersRef.current.forEach((p) => {
      p.present = false;
    });
    setLastShot(null);
    refreshUi();

    appLog(`Старт цикла. Интервал = ${delay} мс. Ждём...`);
    clearTimeout(s.timers.deadline);
    s.timers.deadline = setTimeout(() => performActionsOrWait("deadline"), Math.max(0, s.deadlineTs - Date.now()));
  };

  const doJoin = () => {
    client.send("FWLISTVER 311");
    client.send("ADDONS 251920 1");
    client.send("MYADDONS 251920 1");
    client.send("PHONE 1920 1080 0 2 :chrome 138.0.0.0");
    client.send("JOIN");
    sm.current.selfJoinPending = true;
    appLog("JOIN отправлен.");
    startCycle();
  };

  /** Inbound parsing */
  const tryResumeWaitingAtDeadline = () => {
    if (!sm.current.waitingForTarget) return;
    const s = sm.current;
    const now = Date.now();
    const when = Math.max(0, s.deadlineTs - now);
    clearTimeout(s.timers.waitResume);
    if (when <= 0) {
      appLog("Цель появилась — дедлайн уже прошёл → ACTION сейчас.");
      performActionsOrWait("wait-resume");
    } else {
      appLog(`Цель появилась — ждём до дедлайна ${when} мс.`);
      s.timers.waitResume = setTimeout(() => performActionsOrWait("wait-resume"), when);
    }
  };

  const handleInbound = (line) => {
    addLog("<=", line);

    // FOUNDER / FO <id>
    const mFounder = line.match(/\bFO(?:UNDER)?\s+(\d{6,})\b/i);
    if (mFounder && mFounder[1] !== "0") {
      const id = mFounder[1];
      setFounderId(id);
      founderIdRef.current = id;
      upsert(playersRef.current, id, { isKing: true, present: true });
    }

    const mSelf = line.match(/^(?:YOU|ME|MYID|SELF|USER)\s+(\d{6,})\b/i);
    if (mSelf) {
      const id = mSelf[1];
      setMyId(id);
      myIdRef.current = id;
      upsert(playersRef.current, id, { isMe: true, present: true });
    }

    // JOIN <nick> <clan> <id> ...
    const mJoin = line.match(/^JOIN\s+([^\s]+)\s+([^\s]+)\s+(\d{6,})\b/u);
    if (mJoin) {
      const nick = mJoin[1];
      const clan = mJoin[2];
      const id = mJoin[3];

      if (sm.current.selfJoinPending && !myIdRef.current) {
        setMyId(id);
        myIdRef.current = id;
        sm.current.selfJoinPending = false;
      }

      upsert(playersRef.current, id, {
        nick,
        clan,
        present: true,
        isKing: String(id) === String(founderIdRef.current || ""),
        isMe: String(id) === String(myIdRef.current || ""),
      });

      tryResumeWaitingAtDeadline();
    }
    let m353 = line.match(/^353\b.*?:([^\s]+)\s+@([^\s]+)\s+(\d{6,})\b/u);
    if (m353) {
      const nick = m353[1],
        clan = m353[2],
        id = m353[3];
      upsert(playersRef.current, id, {
        nick,
        clan,
        present: true,
        isKing: String(id) === String(founderIdRef.current || ""),
        isMe: String(id) === String(myIdRef.current || ""),
      });
      tryResumeWaitingAtDeadline();
    } else {
      m353 = line.match(/^353\b.*?@([^\s]+)\s+:([^\s]+)\s+(\d{6,})\b/u);
      if (m353) {
        const clan = m353[1],
          nick = m353[2],
          id = m353[3];
        upsert(playersRef.current, id, {
          nick,
          clan,
          present: true,
          isKing: String(id) === String(founderIdRef.current || ""),
          isMe: String(id) === String(myIdRef.current || ""),
        });
        tryResumeWaitingAtDeadline();
      }
    }

    if (line.startsWith("860 ")) {
      const idOnly = line.match(/^860\s+(\d{6,})\b/);
      if (idOnly) upsert(playersRef.current, idOnly[1], { present: true });
      let m;
      const re = /\b(\d{6,})\b/g;
      while ((m = re.exec(line)) !== null) upsert(playersRef.current, m[1], { present: true });
      tryResumeWaitingAtDeadline();
    }

    refreshUi();
  };

  /** Bind */
  useEffect(() => {
    const offOpen = client.on("open", () => setConnected(true));
    const offClose = client.on("close", () => {
      setConnected(false);
      setAuthOk(false);
      if (settingsRef.current.autoRun && recoverRef.current) {
        clearTimeout(sm.current.timers.relogin);
        sm.current.timers.relogin = setTimeout(() => {
          appLog("Перезаход...");
          client.reset();
          client.startLogin(recoverRef.current);
        }, RELOGIN_DELAY + RELOGIN_COOLDOWN_MS);
      }
    });
    const offAuth = client.on("auth_ok", () => {
      setAuthOk(true);
      doJoin();
    });
    const offTx = client.on("tx", (m) => addLog("=>", m));
    const offLine = client.on("line", handleInbound);
    const offMsg = client.on("message", handleInbound);

    return () => {
      offOpen();
      offClose();
      offAuth();
      offTx();
      offLine();
      offMsg();
      clearTimeout(sm.current.timers.deadline);
      clearTimeout(sm.current.timers.quit);
      clearTimeout(sm.current.timers.relogin);
      clearTimeout(sm.current.timers.waitResume);
      client.close();
    };
  }, [client]);

  /** UI handlers */
  const handleLogin = (e) => {
    e?.preventDefault?.();
    if (!recoverCode.trim()) return;

    setLog([]);
    setFounderId(null);
    founderIdRef.current = null;
    setMyId(null);
    myIdRef.current = null;
    setLastShot(null);
    setUiPlayers([]);
    playersRef.current.clear();
    sm.current = {
      onPlanet: false,
      joinAt: 0,
      deadlineTs: 0,
      timers: { deadline: null, quit: null, relogin: null, waitResume: null },
      waitingForTarget: false,
      selfJoinPending: false,
    };

    recoverRef.current = recoverCode.trim();
    client.reset();
    client.startLogin(recoverRef.current);
    appLog("Логин по RECOVER_CODE.");
  };

  const handleQuit = () => {
    clientRef.current.send("QUIT :ds");
    clientRef.current.close();
    appLog("Ручной выход.");
  };

  /** UI bits */
  const ShotBadge = () => {
    if (!lastShot)
      return (
        <span style={{ padding: "2px 8px", borderRadius: 12, background: "#333", color: "#fff" }}>
          3s: — (ждём)
        </span>
      );
    const ok = lastShot.caught3s;
    return (
      <span
        title={`ACTION через ${lastShot.elapsedMs} мс, целей: ${lastShot.targets}`}
        style={{ padding: "2px 8px", borderRadius: 12, background: ok ? "#0b8c2a" : "#b2262a", color: "#fff", fontWeight: 700 }}
      >
        {ok ? `3s OK (${lastShot.elapsedMs} мс)` : `Раньше 3s (${lastShot.elapsedMs} мс)`}
      </span>
    );
  };

  const RosterItem = ({ p }) => (
    <li key={p.id} style={{ margin: "2px 0" }}>
      {show(p)} {p.isKing ? "King" : ""}
      {p.isMe ? " (я)" : ""}
    </li>
  );

  return (
    <div style={{ border: "1px solid #333", borderRadius: 10, padding: 10, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{caption}</div>

      <form onSubmit={handleLogin} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input placeholder="RECOVER_CODE" value={recoverCode} onChange={(e) => setRecoverCode(e.target.value)} disabled={authOk} />
        <button type="submit" disabled={authOk || !recoverCode.trim()}>
          Войти
        </button>
      </form>

      <div style={{ marginBottom: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={handleQuit}>Выход</button>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          Интервал (мс):
          <input type="number" step="1" min="0" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value) || 0)} style={{ width: 90 }} />
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
          Авто-повтор заходов
        </label>
        <ShotBadge />
        <span>
          WS: {connected ? "connected" : "disconnected"} | AUTH: {authOk ? "OK" : "—"}
        </span>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Игроки (клан + ник):</strong>
        <ul style={{ paddingLeft: 16 }}>
          {uiPlayers.map((p) => (
            <RosterItem key={p.id} p={p} />
          ))}
        </ul>
      </div>

      <pre style={{ maxHeight: 300, overflow: "auto", background: "#111", color: "#0f0", padding: 8 }}>
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

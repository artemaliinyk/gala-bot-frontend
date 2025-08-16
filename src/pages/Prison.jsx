import React, { useEffect, useMemo, useRef, useState } from "react";
import Client from "/src/client.jsx";
import '@picocss/pico/css/pico.min.css';

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

/** Нормализация */
const normalizeClan = (s) =>
  String(s || "")
    .trim()
    .replace(/^[\[@]+/, "")
    .replace(/[\]]+$/, "")
    .toLowerCase();

const normalizeNick = (s) => String(s || "").trim();

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

 
  const [delayEngageMs, setDelayEngageMs] = useState(2000); 
  const [delayGuardMs, setDelayGuardMs] = useState(1850);   

  const [founderId, setFounderId] = useState(null);
  const [myId, setMyId] = useState(null);

  const [uiPlayers, setUiPlayers] = useState([]);
  const [lastShot, setLastShot] = useState(null);

 
  const [allowedClansInput, setAllowedClansInput] = useState("");
  const allowedClansRef = useRef(new Set());
  useEffect(() => {
    const set = new Set(
      allowedClansInput
        .split(/[,\s]+/u)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => normalizeClan(x))
    );
    allowedClansRef.current = set;
  }, [allowedClansInput]);

  /** Настройки в рефах */
  const settingsRef = useRef({ autoRun: true, delayEngageMs: 2000, delayGuardMs: 1850 });
  const founderIdRef = useRef(null);
  const myIdRef = useRef(null);

  useEffect(() => { settingsRef.current.autoRun = autoRun; }, [autoRun]);
  useEffect(() => { settingsRef.current.delayEngageMs = delayEngageMs; }, [delayEngageMs]);
  useEffect(() => { settingsRef.current.delayGuardMs = delayGuardMs; }, [delayGuardMs]);
  useEffect(() => { founderIdRef.current = founderId; }, [founderId]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

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

  const hasUnknownClanPresent = () =>
    Array.from(playersRef.current.values()).some((p) => p.present && (!p.clan || !p.nick));

  const getTargets = () => {
    const king = String(founderIdRef.current ?? "");
    const me = String(myIdRef.current ?? "");
    const whitelist = allowedClansRef.current;

    return Array.from(playersRef.current.values())
      .filter((p) => p.present && String(p.id) !== king && String(p.id) !== me)
      .filter((p) => {
        if (!whitelist || whitelist.size === 0) return true;
        const clan = normalizeClan(p.clan);
        const ok = clan && whitelist.has(clan);
        if (!ok) appLog(`Игрок id=${p.id} nick=${p.nick ?? "—"} clan=${p.clan ?? "—"} проигнорирован — нет в списке`);
        return ok;
      });
  };

  /** Action & Quit */
  const markShot = (count) => {
    const elapsedMs = Date.now() - sm.current.joinAt;
    const caught3s = elapsedMs >= 3000;
    setLastShot({ elapsedMs, caught3s, targets: count });
    appLog(caught3s ? `3s caught: ACTION at ${elapsedMs} ms, targets: ${count}` : `<3s: ACTION at ${elapsedMs} ms, targets: ${count}`);
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
      const whitelist = allowedClansRef.current;
      if (whitelist && whitelist.size > 0 && hasUnknownClanPresent()) {
        const extra = 32;
        appLog(`Есть присутствующие без клана/ника → подождём ещё ${extra} мс (${why}).`);
        clearTimeout(sm.current.timers.waitResume);
        sm.current.timers.waitResume = setTimeout(() => performActionsOrWait("grace"), extra);
        sm.current.waitingForTarget = true;
        return;
      }
      appLog(`Целей нет → продолжаем дежурить (${why}).`);
      sm.current.waitingForTarget = true;
      return;
    }

    sm.current.waitingForTarget = false;
    sendActions(targets);
    quitSoon();
  };

  const startCycle = () => {
    const delay = Math.max(0, Number(settingsRef.current.delayEngageMs) || 0);
    const s = sm.current;
    s.onPlanet = true;
    s.joinAt = Date.now();
    s.deadlineTs = s.joinAt + delay + SEND_OFFSET_MS;
    s.waitingForTarget = false;
    clearTimeout(s.timers.waitResume);

    playersRef.current.forEach((p) => { p.present = false; });
    setLastShot(null);
    refreshUi();

    appLog(`Старт цикла (Engage). Интервал = ${delay} мс. Ждём...`);
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
    const head = line.split(" ")[0];
    const parts = line.trim().split(/\s+/);

    // founder / self
    const mFounder = line.match(/\bFO(?:UNDER)?\s+(\d{6,})\b/i);
    if (mFounder && mFounder[1] !== "0") {
      const id = mFounder[1];
      setFounderId(id); founderIdRef.current = id;
      upsert(playersRef.current, id, { isKing: true, present: true });
    }
    const mSelf = line.match(/^(?:YOU|ME|MYID|SELF|USER)\s+(\d{6,})\b/i);
    if (mSelf) {
      const id = mSelf[1];
      setMyId(id); myIdRef.current = id;
      upsert(playersRef.current, id, { isMe: true, present: true });
    }

    if (head === "353") {
      const regex = /([:@\w]+)\s+([^\s]+)\s+(\d{5,})/g;
      let match;
      while ((match = regex.exec(line)) !== null) {
        const clan = normalizeClan(match[1]);
        const nick = normalizeNick(match[2]);
        const id = String(match[3]);
        upsert(playersRef.current, id, {
          clan, nick, present: true,
          isKing: String(id) === String(founderIdRef.current || ""),
          isMe: String(id) === String(myIdRef.current || ""),
        });
      }
      tryResumeWaitingAtDeadline();
      refreshUi();
      return;
    }

    if (head === "JOIN") {
      const clanRaw = parts[1];
      const nickRaw = parts[2];
      const idRaw   = parts[3];
      if (!nickRaw || !idRaw) return;

      const clan = normalizeClan(clanRaw);
      const nick = normalizeNick(nickRaw);
      const id   = String(idRaw);

      if (sm.current.selfJoinPending && !myIdRef.current) {
        setMyId(id); myIdRef.current = id;
        sm.current.selfJoinPending = false;
      }

      const patch = {
        nick,
        present: true,
        isKing: String(id) === String(founderIdRef.current || ""),
        isMe: String(id) === String(myIdRef.current || ""),
      };
      if (clanRaw !== "-") patch.clan = clan;

      upsert(playersRef.current, id, patch);
      appLog(`JOIN parsed: id=${id} nick=${nick} clan=${clanRaw !== "-" ? clan : "-"}`);
      const isEnemy = !patch.isMe && !patch.isKing;
      if (isEnemy && sm.current.onPlanet) {
        clearTimeout(sm.current.timers.deadline);
        const guardDelay = Math.max(0, Number(settingsRef.current.delayGuardMs) || 0);
        sm.current.deadlineTs = Date.now() + guardDelay;
        sm.current.waitingForTarget = true;
        appLog(`Враг обнаружен → ждём ${guardDelay} мс (Guard) и атакуем`);
        sm.current.timers.deadline = setTimeout(
          () => performActionsOrWait("enemy-join"),
          guardDelay
        );
      }

      tryResumeWaitingAtDeadline();
      refreshUi();
      return;
    }

    // === PART:===
    if (head === "PART") {
      const id = String(parts[1] || "");
      if (id) upsert(playersRef.current, id, { present: false });
      refreshUi();
      return;
    }

    // === 860: presence
    if (head === "860") {
      const idOnly = line.match(/^860\s+(\d{6,})\b/);
      if (idOnly) upsert(playersRef.current, idOnly[1], { present: true });
      let m;
      const re = /\b(\d{6,})\b/g;
      while ((m = re.exec(line)) !== null) upsert(playersRef.current, m[1], { present: true });
      tryResumeWaitingAtDeadline();
      refreshUi();
      return;
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
    const offAuth = client.on("auth_ok", () => { setAuthOk(true); doJoin(); });
    const offTx = client.on("tx", (m) => addLog("=>", m));
    const offLine = client.on("line", handleInbound);
    const offMsg = client.on("message", handleInbound);

    return () => {
      offOpen(); offClose(); offAuth(); offTx(); offLine(); offMsg();
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
    setFounderId(null); founderIdRef.current = null;
    setMyId(null); myIdRef.current = null;
    setLastShot(null);
    setUiPlayers([]);
    playersRef.current.clear();
    sm.current = {
      onPlanet: false, joinAt: 0, deadlineTs: 0,
      timers: { deadline: null, quit: null, relogin: null, waitResume: null },
      waitingForTarget: false, selfJoinPending: false,
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
    if (!lastShot) return (
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
      {show(p)} {p.isKing ? "King" : ""}{p.isMe ? " (я)" : ""}
    </li>
  );

return (
  <article style={{ marginBottom: 16 }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <strong>{caption}</strong>
    </header>

    <form onSubmit={handleLogin} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
      <input placeholder="RECOVER_CODE" value={recoverCode} onChange={(e) => setRecoverCode(e.target.value)} disabled={authOk} />
      <button type="submit" disabled={authOk || !recoverCode.trim()}>Войти</button>
    </form>

    <div
      style={{
        marginBottom: 0,
        display: "flex",
        gap: 0,
        alignItems: "center",
        flexWrap: "wrap"
      }}
    >
      <button onClick={handleQuit}>Выход</button>

      {/*таймеры*/}
      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        Engage (мс):
        <input
          type="number" step="1" min="0"
          value={delayEngageMs}
          onChange={(e) => setDelayEngageMs(Number(e.target.value) || 0)}
          style={{ width: 105 }}
        />
      </label>

      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        Guard (мс):
        <input
          type="number" step="1" min="0"
          value={delayGuardMs}
          onChange={(e) => setDelayGuardMs(Number(e.target.value) || 0)}
          style={{ width: 105 }}
        />
      </label>

      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
        Авто-повтор заходов
      </label>

      {/* --- Clans --- */}
      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        Кланы 
        <input
          type="text"
          placeholder="US, GALA, TAURA"
          value={allowedClansInput}
          onChange={(e) => setAllowedClansInput(e.target.value)}
          style={{ width: 260 }}
        />
      </label>

      <ShotBadge />
      <span>WS: {connected ? "connected" : "disconnected"} | AUTH: {authOk ? "OK" : "—"}</span>
    </div>

    <div style={{ marginBottom: 8 }}>
      <strong>Игроки (клан + ник):</strong>
      <ul style={{ paddingLeft: 16 }}>
        {uiPlayers.map((p) => (<RosterItem key={p.id} p={p} />))}
      </ul>
    </div>

    <pre style={{ maxHeight: 260, overflow: "auto", background: "#111", color: "#0f0", padding: 8, borderRadius: 6 }}>
      {log.join("\n")}
    </pre>
  </article>
);
}

/** Render two independent bots */
export default function PrisonMulti() {
  return (
    <main style={{ fontFamily: "monospace", maxWidth: "960px", margin: "0 auto", padding: "12px" }}>
      <Bot label="Bot 1" />
      <Bot label="Bot 2" />
    </main>
  );
}

import React, {useEffect, useMemo, useRef, useState} from "react";
import Client from "/src/client.jsx";
import {normalizeClan, normalizeNick} from "../../components/helpers/string.js";

export default function Prison() {
  const client = useMemo(() => new Client(), []);
  const clientRef = useRef(client);

  const [log, setLog] = useState([]);
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [recoverCode, setRecoverCode] = useState("bfgbiy03rl");

  useEffect(() => {
        if (recoverCode.trim()) {
            handleLogin();
        }
    }, []);

  useEffect(() => {
    const offOpen = client.on("open", () => setConnected(true));

    const offClose = client.on("close", () => {
        setConnected(false);
        setAuthOk(false);
    });

    const offAuth = client.on("auth_ok", () => {
        setAuthOk(true);

        client.send("FWLISTVER 311");
        client.send("ADDONS 251920 1");
        client.send("MYADDONS 251920 1");
        client.send("PHONE 1440 932 0 2 :chrome 138.0.0.0");
        client.send("JOIN");
    });

    const offTx = client.on("tx", (m) => setLog((l) => [...l, `=> ${m}`]));
    const offLine = client.on("line", (m) => setLog((l) => [...l, `<= ${m}`]));

    const offMsg = client.on("message", (line) => {
        const head = line.split(" ")[0];

        // Collection of Users Data
        collectionUsers(head, line)
    });

    return () => {
        offOpen();
        offClose();
        offAuth();
        offTx();
        offLine();
        offMsg();
        client.close();
    };
  }, [client]);

  useEffect(() => {
    if (users?.length > 0) {
      console.log("Users Changed: ", users)
    }
  }, [users]);

  const collectionUsers = (head, line) => {
    // Users already on Planet: 353
    if (head === "353") {
        const regex = /([:@\w]+)\s+([^\s]+)\s+(\d{5,})/g;
        const batchMap = new Map();
        let match;

        while ((match = regex.exec(line)) !== null) {
            const clan = normalizeClan(match[1]);
            const nick = normalizeNick(match[2]);
            const id = String(match[3]);
            batchMap.set(id, {id, nick, clan});
        }

        const incoming = [...batchMap.values()];

        setUsers(prev => {
            const map = new Map(prev.map(u => [u.id, u]));
            for (const u of incoming) {
                const old = map.get(u.id);
                map.set(u.id, old ? {...old, ...u} : u);
            }
            return [...map.values()].sort((a, b) => a.nick.localeCompare(b.nick));
        });
    }

    // Users joined on Planet: JOIN
    if (head === "JOIN") {
        const parts = line.trim().split(/\s+/);
        const clanRaw = parts[1];
        const nickRaw = parts[2];
        const idRaw = parts[3];

        if (!nickRaw || !idRaw) return;

        const clan = normalizeClan(clanRaw);
        const nick = normalizeNick(nickRaw);
        const id = String(idRaw);

        if (clanRaw === "-") {
            return;
        }

        setUsers(prev => {
            const map = new Map(prev.map(u => [u.id, u]));
            const old = map.get(id);
            const merged = {
                ...(old ?? {}),
                id,
                nick: nick || old?.nick || "",
                clan: clan, // ?? old?.clan ?? null
            };
            map.set(id, merged);
            return [...map.values()].sort((a, b) => a.nick.localeCompare(b.nick));
        });
    }

    // Users leave from Planer
    if (head === "PART") {
        const leaveUser = line.trim().split(/\s+/);
        const id = String(leaveUser[1]);

        setUsers(prev => prev.filter(user => user.id !== id));
    }
  }

  const handleLogin = (e) => {
    e?.preventDefault?.();
    if (!recoverCode.trim()) return;
    setLog([]);
    setUsers([]);
    client.reset();
    client.startLogin(recoverCode.trim());
  };

  const handleQuit = () => {
    clientRef.current.send("QUIT :ds");
    clientRef.current.close();
  };

  return (
    <div style={{fontFamily: "monospace"}}>
        <form onSubmit={handleLogin} style={{display: "flex", gap: 8, marginBottom: 8}}>
            <input
                placeholder="RECOVER_CODE"
                value={recoverCode}
                onChange={(e) => setRecoverCode(e.target.value)}
            />
            <button type="submit">
                Войти
            </button>
        </form>

        <div style={{marginBottom: 8, display: "flex", gap: 12}}>
            <button onClick={handleQuit}>Выход</button>
        </div>

        <div style={{marginBottom: 8}}>
            <strong>Users:</strong>
            <ul>
                {users.map((u) => (
                    <li key={`${u.id}-${u.nick}`}>
                        {u.nick} ({u.id}){u.clan ? ` [${u.clan}]` : ""}
                    </li>
                ))}
            </ul>
        </div>

        <pre style={{maxHeight: 420, overflow: "auto", background: "#111", color: "#0f0", padding: 8}}>
            {log.join("\n")}
        </pre>
    </div>
  );
}
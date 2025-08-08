import React, { useEffect, useMemo, useRef, useState } from "react";
import Client from "/src/client.jsx";

const WS_URL = "wss://cs.mobstudio.ru:6672";
const IDENT  = ":ru IDENT 352 -2 4030 1 2 :GALA";

function parse353Users(line) {
    const after = line.split(":-")[1]?.trim();
    if (!after) return [];
    const blocks = after.split("@").filter(Boolean);
    const users = blocks.map((block) => {
        const parts = block.trim().split(/\s+/);
        const dashIdx = parts.indexOf("-");
        if (dashIdx !== -1 && parts[dashIdx + 1]) return parts[dashIdx + 1];
        return parts[0];
    });
    return [...new Set(users.filter(Boolean))];
}

export default function Prison() {
    const client = useMemo(() => new Client({ url: WS_URL, ident: IDENT }), []);
    const clientRef = useRef(client);

    const [log, setLog] = useState([]);
    const [users, setUsers] = useState([]);
    const [connected, setConnected] = useState(false);
    const [authOk, setAuthOk] = useState(false);
    const [recoverCode, setRecoverCode] = useState("");

    useEffect(() => {
        const offOpen = client.on("open", () => setConnected(true));
        const offClose = client.on("close", () => { setConnected(false); setAuthOk(false); });
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
            if (head === "353") {
                const parsed = parse353Users(line);
                if (parsed.length) setUsers((prev) => [...new Set([...prev, ...parsed])]);
            }
        });

        return () => { offOpen(); offClose(); offAuth(); offTx(); offLine(); offMsg(); client.close(); };
    }, [client]);

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
        <div style={{ fontFamily: "monospace" }}>
            <form onSubmit={handleLogin} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input
                    placeholder="RECOVER_CODE"
                    value={recoverCode}
                    onChange={(e) => setRecoverCode(e.target.value)}
                    disabled={authOk}
                />
                <button type="submit" disabled={authOk || !recoverCode.trim()}>
                    Войти
                </button>
            </form>

            <div style={{ marginBottom: 8, display: "flex", gap: 12 }}>
                <button onClick={handleQuit}>Выход</button>
                <span>WS: {connected ? "connected" : "disconnected"} | AUTH: {authOk ? "OK" : "—"}</span>
            </div>

            <div style={{ marginBottom: 8 }}>
                <strong>Пользователи:</strong>
                <ul>{users.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>

            <pre style={{ maxHeight: 420, overflow: "auto", background: "#111", color: "#0f0", padding: 8 }}>
        {log.join("\n")}
      </pre>
        </div>
    );
}
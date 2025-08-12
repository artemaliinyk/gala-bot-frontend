import React, {useEffect, useMemo, useRef, useState} from "react";
import Client from "/src/client.jsx";
import {normalizeClan, normalizeNick} from "../../components/helpers/string.js";
import { Form, Button, Container, Row, Col } from 'react-bootstrap';

export default function Prison() {
  const client = useMemo(() => new Client(), []);
  const clientRef = useRef(client);

  const [log, setLog] = useState([]);
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [recoverCode, setRecoverCode] = useState("bfgbiy03rl");
  const [planet, setPlanet] = useState(null);

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
        const lineSplit = line.trim().split(/\s+/);

        if (head === "900") {
            setPlanet(lineSplit[1])
        }

        // Collection of Users Data
        collectionUsers(head, line, lineSplit)
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

  const collectionUsers = (head, line, lineSplit) => {
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
      <Container fluid className="p-4">
          <Form>
              <Form.Group controlId="formName" className="mb-3">
                  <Form.Label>Recovery Code:</Form.Label>

                  <Form.Control
                      type="text"
                      placeholder="Recovery Code"
                      style={{width: "150px"}}
                      value={recoverCode}
                      onChange={(e) => setRecoverCode(e.target.value)}
                  />
              </Form.Group>

              <div className="d-flex gap-2">
                  <Button
                      variant="primary"
                      type="submit"
                      onClick={handleLogin}
                  >
                      Вход
                  </Button>

                  <Button
                      variant="primary"
                      type="submit"
                      onClick={handleQuit}
                  >
                      Выход
                  </Button>
              </div>

          </Form>

          {users?.length > 0 && (
              <>
                  <div className="mt-5">
                      <b>Персонажи на платене (Ник | Клан):</b>
                  </div>

                  {users?.map((user) => (
                      <div className="mb-2">- {user?.nick} | {user?.clan}</div>
                  ))}
              </>
          )}
      </Container>
  );
}
import React, {useEffect, useMemo, useRef, useState} from "react";
import Client from "/src/client.jsx";
import {getListFromTextArea, normalizeClan, normalizeNick} from "../../components/helpers/string.js";
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

  const [whiteNickNames, setWhiteNickNames] = useState([
    "elichka",
  ])

  const [whiteClans, setWhiteClans] = useState([
    "KO",
  ])

  const [canPrisonUsers, setCanPrisonUsers] = useState(null)

  const [account, setAccount] = useState(null);
  const accountRef = useRef(null);

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

     const offAccount = client.on("ACCOUNT", ({ id, nick }) => {
          const acc = { id: String(id), nick };
          accountRef.current = acc;
          setAccount(acc);
          setUsers(prev => prev.map(u => ({ ...u, is_me: isMe(u) })));
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
    setCanPrisonUsers(
        users.filter(user =>
            !whiteNickNames.includes(user.nick) &&
            !whiteClans.includes(user.clan) &&
            !user?.is_owner &&
            !user?.is_me
        )
    );
  }, [users, whiteNickNames, whiteClans]);

  useEffect(() => {
    if (canPrisonUsers?.length > 0) {
      console.log("canPrisonUsers: ", canPrisonUsers)
    }
  }, [canPrisonUsers]);

  useEffect(() => {
    if (!accountRef.current) return;
    setUsers(prev => prev.map(u => ({ ...u, is_me: isMe(u) })));
  }, [account]);

  const isMe = (u) => {
    const acc = accountRef.current;
    if (!acc) return false;

    return (u.id && acc.id && String(u.id) === String(acc.id)) || (u.nick && acc.nick && normalizeNick(u.nick) === normalizeNick(acc.nick));
  }

  const collectionUsers = (head, line, lineSplit) => {
    // Users already on Planet: 353
    if (head === "353") {
        const regex = /(\S+)\s+(\S+)\s+(\d{5,})/gu;
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
                const merged = { ...(old ?? {}), ...u };
                merged.is_me = isMe(merged);
                map.set(u.id, merged);
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

        // if (clanRaw === "-") {
        //     return;
        // }

        setUsers(prev => {
            const map = new Map(prev.map(u => [u.id, u]));
            const old = map.get(id);
            const merged = {
                ...(old ?? {}),
                id,
                nick: nick || old?.nick || "",
                clan,
            };
            merged.is_me = isMe(merged);
            map.set(id, merged);
            return [...map.values()].sort((a, b) => a.nick.localeCompare(b.nick));
        });
    }

    // Check Owner this Planet
    if (head === "FOUNDER") {
        const id = String(lineSplit[1]);
        if (!id) return;

        setUsers(prev =>
            prev.map(user =>
                user.id === id ? { ...user, is_owner: true } : user
            )
        );
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
  }

  const handleQuit = () => {
    clientRef.current.send("QUIT :ds");
    clientRef.current.close();
  }

  const handleWhiteNickNames = (e) => {
      setWhiteNickNames(getListFromTextArea(e))
  }

  const handleWhiteClans = (e) => {
    setWhiteClans(getListFromTextArea(e))
  }

  return (
      <Container fluid className="p-4">
          <div className="d-flex gap-5 mb-5">
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

              <div className="ml-5">
                  <span>
                      <b>Белый Список (Ники, Кланы):</b>
                  </span>
                  <div className="d-flex gap-2">
                      <div className={"mt-3"}>
                          <Form.Control
                              as="textarea"
                              rows={3}
                              style={{width: "150px"}}
                              onChange={handleWhiteNickNames}
                              value={whiteNickNames.join("\n")}
                          />
                      </div>

                      <div className={"mt-3"}>
                          <Form.Control
                              as="textarea"
                              rows={3}
                              style={{width: "150px"}}
                              onChange={handleWhiteClans}
                              value={whiteClans.join("\n")}
                          />
                      </div>
                  </div>
              </div>
          </div>

          {planet && (
              <div className="mt-4">
                  <b>Планета:</b> {planet}
              </div>
          )}

          {users?.length > 0 && (
              <div className="mt-3">
                  <span>
                      <b>Персонажи на платене ({users?.length}):</b>
                  </span>

                  {users?.map((user) => (
                      <div className="mt-3 mb-2">
                          <span>- {user?.nick}</span>

                          {user?.clan && (
                              <span> | {user?.clan}</span>
                          )}

                          {user?.is_owner && (
                              <span>
                                  <b> (Владелец)</b>
                              </span>
                          )}

                          {user?.is_me && (
                              <span>
                                  <b> (Я)</b>
                              </span>
                          )}
                      </div>
                  ))}
              </div>
          )}

          {canPrisonUsers?.length > 0 && (
              <div className="mt-4">
                  <span>
                      <b>Персонажи которых можно посадить: ({canPrisonUsers?.length}):</b>
                  </span>

                  {canPrisonUsers?.map((user) => (
                      <div className="mt-3 mb-2">
                          <span>- {user?.nick}</span>

                          {user?.clan && (
                              <span> | {user?.clan}</span>
                          )}
                      </div>
                  ))}
              </div>
          )}
      </Container>
  );
}
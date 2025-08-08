import CryptoJS from "crypto-js";

const withCRLF = (s) => (/\r\n$/.test(s) ? s : s + "\r\n");

function calcHashFromHAAAPSI(challenge) {
    const md5 = CryptoJS.MD5(challenge).toString(CryptoJS.enc.Hex);
    return md5.split("").reverse().join("0").substr(5, 10);
}

export default class Client {
    constructor({ url, ident }) {
        this.url = url;
        this.ident = ident;

        this.ws = null;
        this.challenge = null;
        this.pendingRecoverCode = null;
        this.handlers = new Map();
        this.authOk = false;
    }

    on(event, cb) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(cb);
        return () => this.handlers.get(event)?.delete(cb);
    }
    emit(event, payload) { this.handlers.get(event)?.forEach((cb) => cb(payload)); }

    startLogin(recoverCode) {
        this.pendingRecoverCode = recoverCode;
        this.connect();
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            this.emit("open");
            this.sendRaw(this.ident);
        };

        this.ws.onerror = (e) => this.emit("error", e);
        this.ws.onclose = () => this.emit("close");

        this.ws.onmessage = (evt) => {
            const lines = String(evt.data).split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                this.emit("line", line);
                this.handleLine(line);
            }
        };
    }

    close() {
        try { this.ws?.close(); } catch {}
    }

    reset() {
        this.challenge = null;
        this.pendingRecoverCode = null;
        this.authOk = false;
    }

    sendRaw(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(withCRLF(msg));
            this.emit("tx", msg);
        }
    }
    send(msg) { this.sendRaw(msg); }

    handleLine(line) {
        const parts = line.split(" ").map((s) => s.trim()).filter(Boolean);
        const cmd = parts[0];

        switch (cmd) {
            case "HAAAPSI": {
                this.challenge = parts[1] || null;
                this.emit("haaapsi", this.challenge);
                if (this.pendingRecoverCode) {
                    this.sendRaw(`RECOVER ${this.pendingRecoverCode}`);
                }
                break;
            }

            case "REGISTER": {
                const [, id, pass, nick] = parts;
                const hash = this.challenge ? calcHashFromHAAAPSI(this.challenge) : "";
                this.sendRaw(`USER ${id} ${pass} ${nick} ${hash}`);
                break;
            }

            case "999": {
                this.authOk = true;
                this.emit("auth_ok");
                break;
            }

            case "PING":
                this.sendRaw("PONG");
                break;

            default:
                this.emit("message", line);
                break;
        }
    }
}
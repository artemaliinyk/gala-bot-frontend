export const normalizeClan = (raw) => {
    if (!raw || raw === "-") return null;
    return String(raw).replace(/^:/, "");
}

export const normalizeNick = (raw) => {
    return String(raw || "").replace(/^[@+]+/, "");
}

export const getListFromTextArea = (e) => {
    return e.target.value
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
}
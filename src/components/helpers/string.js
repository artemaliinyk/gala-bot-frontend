export const normalizeClan = (raw) => {
    if (!raw || raw === "-") return null;
    return String(raw).replace(/^:/, "");
}

export const normalizeNick = (raw) => {
    return String(raw || "").replace(/^[@+]+/, ""); // убираем @ и + в начале
}
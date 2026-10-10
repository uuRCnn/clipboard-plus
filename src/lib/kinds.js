// Content classification and formatting helpers. Pure JS, no GI imports.

export const Kind = Object.freeze({
    TEXT: 'text',
    LINK: 'link',
    CODE: 'code',
    COLOR: 'color',
    FILE: 'file',
    IMAGE: 'image',
});

const COLOR_RE = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\(\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\))$/i;
const LINK_RE = /^(?:(?:https?|ftp|ssh|git|mailto):\/?\/?[^\s]+|www\.[^\s]+\.[^\s]+)$/i;
const FILE_LINE_RE = /^(?:file:\/\/\/?|\/|~\/)[^\n]*$/;
const CODE_HINTS = [
    /^\s*(?:\$|#)\s+\S/m,
    /^\s*(?:sudo|git|npm|pnpm|yarn|pip|pacman|paru|yay|apt|dnf|flatpak|docker|podman|cd|ls|cat|grep|curl|wget|ssh|systemctl|journalctl|make|cargo|go|python3?|node|gjs)\s+\S/,
    /^\s*(?:import|export|from|const|let|var|function|class|def|fn|pub|package|using|namespace|#include|#!)\b/m,
    /=>|::|->|\+\+|&&|\|\||;\s*$/m,
    /^\s*<\/?[a-z][\w-]*(?:\s[^>]*)?>/im,
    /^\s*[{[]\s*$/m,
    /\b(?:return|if|else|for|while)\b.*[;{]/,
];

/**
 * Detect the kind of a text clipboard entry.
 *
 * @param {string} text the text
 * @returns {string} one of Kind
 */
export function detectKind(text) {
    const t = text.trim();
    if (!t)
        return Kind.TEXT;
    const singleLine = !t.includes('\n');
    if (singleLine && t.length <= 64 && COLOR_RE.test(t))
        return Kind.COLOR;
    if (singleLine && LINK_RE.test(t))
        return Kind.LINK;
    const lines = t.split('\n');
    if (lines.length <= 50 && lines.every(l => FILE_LINE_RE.test(l.trim())) &&
        lines.every(l => !/\s{2,}/.test(l)))
        return Kind.FILE;
    let score = 0;
    for (const re of CODE_HINTS) {
        if (re.test(t))
            score++;
    }
    if (score >= 2 || (singleLine && score >= 1 && /^\s*(?:\$\s+)?(?:sudo|git|npm|pacman|paru|yay|apt|dnf|flatpak|docker|systemctl|curl|wget|ssh)\b/.test(t)))
        return Kind.CODE;
    return Kind.TEXT;
}

/**
 * Parse a CSS colour string into RGB. Returns null when not parsable.
 *
 * @param {string} s colour string
 * @returns {{r:number,g:number,b:number}|null}
 */
export function parseColor(s) {
    s = s.trim();
    let m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4)
            h = h.split('').map(c => c + c).join('');
        if (h.length !== 6 && h.length !== 8)
            return null;
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }
    m = s.match(/^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)/i);
    if (m)
        return {r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3])};
    m = s.match(/^hsla?\(\s*([\d.]+)\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%/i);
    if (m)
        return hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    return null;
}

function hslToRgb(h, s, l) {
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return {r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255)};
}

/**
 * @param {{r:number,g:number,b:number}} c rgb
 * @returns {string} "H°, S%, L%"
 */
export function rgbToHslString({r, g, b}) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r)
            h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h *= 60;
    }
    return `${Math.round(h)}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
}

/**
 * @param {{r:number,g:number,b:number}} c rgb
 * @returns {string} #RRGGBB
 */
export function rgbToHex({r, g, b}) {
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * Collapse whitespace so a text fits on one line.
 *
 * @param {string} text text
 * @param {number} max maximum length
 * @returns {string}
 */
export function oneLine(text, max = 200) {
    let s = text.length > max * 4 ? text.slice(0, max * 4) : text;
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * @param {number} bytes size
 * @returns {string} human readable size
 */
export function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Extract the host from a link.
 *
 * @param {string} url link
 * @returns {{host:string, rest:string}}
 */
export function splitUrl(url) {
    const m = url.trim().match(/^(?:[a-z]+:\/\/)?([^/?#\s]+)(.*)$/i);
    if (!m)
        return {host: url, rest: ''};
    return {host: m[1].replace(/^www\./, ''), rest: m[2]};
}

/**
 * StreamSC Provider: AnimeUnity
 * Site: https://www.animeunity.co
 */

"use strict";

const BASE_URL = "https://www.animeunity.co";
const PROVIDER_ID = "animeunity";

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
    "Referer": BASE_URL + "/"
};

async function providerFetch(url, options) {
    const opts = options || {};
    const headers = Object.assign({}, DEFAULT_HEADERS, opts.headers || {});
    const response = await fetch(url, Object.assign({}, opts, { headers: headers }));
    if (!response || !response.ok) {
        throw new Error("HTTP " + (response ? response.status : "?") + " — " + url);
    }
    return response;
}

async function fetchText(url, options) {
    const response = await providerFetch(url, options);
    return response.text();
}

async function fetchJSON(url, options) {
    const text = await fetchText(url, options);
    return JSON.parse(text);
}

const pageCache = {};
const PAGE_CACHE_TTL = 3 * 60 * 1000;

async function cachedText(url) {
    const now = Date.now();
    const cached = pageCache[url];
    if (cached && now - cached.at < PAGE_CACHE_TTL) {
        return cached.text;
    }
    const text = await fetchText(url);
    pageCache[url] = { at: now, text: text };
    return text;
}

function decodeEntities(value) {
    if (!value) return value;
    return String(value)
        .replace(/&quot;/g, '"')
        .replace(/&#0*34;/g, '"')
        .replace(/&#x0*22;/gi, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#0*39;/g, "'")
        .replace(/&#x0*27;/gi, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&#0*38;/g, "&")
        .replace(/&#x0*26;/gi, "&")
        .replace(/&amp;/g, "&")
        .replace(/&#(\d+);/g, function (_, code) {
            return String.fromCharCode(Number(code));
        })
        .replace(/&#x([0-9a-f]+);/gi, function (_, code) {
            return String.fromCharCode(parseInt(code, 16));
        });
}

function extractJSONAttribute(html, tagPattern, attrName) {
    const tagRegex = new RegExp("<" + tagPattern + "[^>]*?\\b" + attrName + "=\"([^\"]+)\"", "i");
    const match = html.match(tagRegex);
    if (!match || !match[1]) return null;
    try {
        return JSON.parse(decodeEntities(match[1]));
    } catch (_) {
        return null;
    }
}

function resolveTitle(anime) {
    if (!anime) return "";
    return String(anime.title_it || anime.title_eng || anime.title || "").trim();
}

function resolveType(anime) {
    const raw = String((anime && anime.type) || "").toUpperCase();
    if (raw === "MOVIE") return "AnimeMovie";
    if (raw === "OVA" || raw === "ONA" || raw === "SPECIAL") return "OVA";
    return "Anime";
}

function resolveYear(anime) {
    const raw = anime && anime.date ? String(anime.date).slice(0, 4) : "";
    const year = parseInt(raw, 10);
    return isFinite(year) && year > 1900 ? year : null;
}

function buildMediaItem(anime) {
    if (!anime || anime.id == null) return null;
    const title = resolveTitle(anime);
    if (!title) return null;
    const slug = anime.slug ? "-" + anime.slug : "";
    const url = BASE_URL + "/anime/" + anime.id + slug;
    const poster = anime.imageurl || anime.cover || anime.imageurl_cover || null;
    const backdrop = anime.cover || anime.imageurl_cover || anime.imageurl || null;
    return {
        id: String(anime.id),
        title: title,
        type: resolveType(anime),
        poster: poster,
        backdrop: backdrop,
        url: url,
        year: resolveYear(anime),
        quality: anime.dub ? "ITA" : "SUB"
    };
}

function dedupeItems(items) {
    const seen = {};
    const out = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.id || seen[item.id]) continue;
        seen[item.id] = true;
        out.push(item);
    }
    return out;
}

// ─── Homepage ────────────────────────────────────────────────────────────────

async function getMainPage(page, sectionKey) {
    const key = sectionKey || "latest";
    const p = page && Number(page) > 1 ? Number(page) : 1;

    if (key === "latest") {
        const url = p > 1 ? BASE_URL + "/?page=" + p : BASE_URL + "/";
        const html = await cachedText(url);
        const payload = extractJSONAttribute(html, "layout-items", "items-json");
        const list = (payload && Array.isArray(payload.data)) ? payload.data : (Array.isArray(payload) ? payload : []);
        const items = dedupeItems(list.map(function (entry) {
            return buildMediaItem(entry && (entry.anime || entry));
        }).filter(Boolean));
        return { items: items, hasNextPage: Boolean(payload && payload.next_page_url) };
    }

    if (key === "popular") {
        const html = await cachedText(BASE_URL + "/");
        const list = extractJSONAttribute(html, "the-carousel", "animes") || [];
        const items = dedupeItems((Array.isArray(list) ? list : []).map(buildMediaItem).filter(Boolean));
        return { items: items, hasNextPage: false };
    }

    if (key === "top") {
        const url = p > 1 ? BASE_URL + "/top-anime?page=" + p : BASE_URL + "/top-anime";
        const html = await cachedText(url);
        const payload = extractJSONAttribute(html, "top-anime", "animes");
        const list = (payload && Array.isArray(payload.data)) ? payload.data : (Array.isArray(payload) ? payload : []);
        const items = dedupeItems(list.map(buildMediaItem).filter(Boolean));
        return { items: items, hasNextPage: Boolean(payload && payload.next_page_url) };
    }

    const archUrl = BASE_URL + "/archivio";
    const html = await cachedText(archUrl);
    const list = extractJSONAttribute(html, "archivio", "records") || [];
    const items = dedupeItems((Array.isArray(list) ? list : []).map(buildMediaItem).filter(Boolean));
    return { items: items, hasNextPage: false };
}

// ─── Search ──────────────────────────────────────────────────────────────────

function searchRank(item, query) {
    const q = String(query || "").toLowerCase();
    const t = String(item.title || "").toLowerCase();
    const clean = t.replace(/\s*\(ita\)\s*$/i, "").trim();
    let score = 0;
    if (clean === q || t === q) score += 100;
    else if (clean.indexOf(q) === 0) score += 60;
    else if (t.indexOf(q) >= 0) score += 30;
    if (item.type === "Anime") score += 25;
    return score;
}

async function search(query, page) {
    const trimmed = String(query || "").trim();
    if (!trimmed) return [];
    const url = BASE_URL + "/archivio?title=" + encodeURIComponent(trimmed);
    const html = await fetchText(url);
    const list = extractJSONAttribute(html, "archivio", "records") || [];
    const items = dedupeItems((Array.isArray(list) ? list : []).map(buildMediaItem).filter(Boolean));
    items.sort(function (a, b) {
        return searchRank(b, trimmed) - searchRank(a, trimmed);
    });
    return items;
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function normalizeAnimeURL(rawURL) {
    const value = String(rawURL || "").split("?")[0].split("#")[0].replace(/\/$/, "");
    if (value.indexOf("http://") === 0 || value.indexOf("https://") === 0) return value;
    if (value.charAt(0) === "/") return BASE_URL + value;
    return BASE_URL + "/" + value;
}

function parseEpisodeNumber(raw, fallback) {
    const text = String(raw == null ? "" : raw);
    const match = text.match(/\d+/);
    const num = match ? parseInt(match[0], 10) : fallback;
    return isFinite(num) && num > 0 ? num : fallback;
}

function buildEpisodeObject(ep, anime, seasonNumber, index) {
    if (!ep || ep.id == null) return null;
    const epNum = parseEpisodeNumber(ep.number, index + 1);
    const label = ep.number != null ? String(ep.number) : String(epNum);
    const loadData = {
        episode_id: ep.id,
        anime_id: anime.id,
        scws_id: ep.scws_id || null,
        mal_id: anime.mal_id || null,
        anilist_id: anime.anilist_id || null,
        episode: epNum,
        referer: BASE_URL + "/anime/" + anime.id + (anime.slug ? "-" + anime.slug : "")
    };
    return {
        id: String(ep.id),
        number: epNum,
        season: seasonNumber,
        title: "Episodio " + label,
        plot: null,
        duration: anime.episodes_length ? Number(anime.episodes_length) : 24,
        poster: anime.cover || anime.imageurl_cover || anime.imageurl || null,
        loadData: JSON.stringify(loadData)
    };
}

async function load(url) {
    const pageURL = normalizeAnimeURL(url);
    const html = await fetchText(pageURL);
    const anime = extractJSONAttribute(html, "video-player", "anime");
    if (!anime || anime.id == null) {
        throw new Error("Anime non trovato su AnimeUnity");
    }

    let rawEpisodes = extractJSONAttribute(html, "video-player", "episodes");
    if (!Array.isArray(rawEpisodes)) rawEpisodes = [];

    const countMatch = html.match(/<video-player[^>]*?\bepisodes_count="(\d+)"/i);
    const totalCount = countMatch ? parseInt(countMatch[1], 10) : rawEpisodes.length;

    if (totalCount > rawEpisodes.length && totalCount <= 600) {
        let start = rawEpisodes.length + 1;
        while (start <= totalCount) {
            const end = Math.min(start + 119, totalCount);
            try {
                const apiURL = BASE_URL + "/info_api/" + anime.id + "/1?start_range=" + start + "&end_range=" + end;
                const extra = await fetchJSON(apiURL, { headers: { "Referer": pageURL } });
                if (extra && Array.isArray(extra.episodes) && extra.episodes.length > 0) {
                    rawEpisodes = rawEpisodes.concat(extra.episodes);
                } else {
                    break;
                }
            } catch (_) {
                break;
            }
            start = end + 1;
        }
    }

    const episodes = rawEpisodes.map(function (ep, idx) {
        return buildEpisodeObject(ep, anime, 1, idx);
    }).filter(Boolean);

    const seasons = [{
        id: 1,
        number: 1,
        name: anime.dub ? "Stagione 1 (ITA)" : "Stagione 1 (SUB ITA)",
        episodes: episodes
    }];

    const score = anime.score != null ? parseFloat(String(anime.score)) : NaN;
    const duration = anime.episodes_length != null ? parseInt(String(anime.episodes_length), 10) : NaN;
    const genres = Array.isArray(anime.genres)
        ? anime.genres.map(function (g) { return g && g.name; }).filter(Boolean)
        : [];

    const firstLoadData = episodes.length > 0 ? episodes[0].loadData : JSON.stringify({
        anime_id: anime.id,
        referer: pageURL
    });

    return {
        id: String(anime.id),
        title: resolveTitle(anime),
        type: resolveType(anime),
        poster: anime.imageurl || anime.cover || null,
        background: anime.cover || anime.imageurl_cover || anime.imageurl || null,
        plot: anime.plot || null,
        year: resolveYear(anime),
        genres: genres,
        cast: [],
        score: isFinite(score) ? score : null,
        contentRating: anime.dub ? "ITA" : "SUB ITA",
        duration: isFinite(duration) ? duration : 24,
        seasons: seasons,
        loadData: firstLoadData
    };
}

// ─── Stream resolution ──────────────────────────────────────────────────────

function matchOne(text, regex) {
    const match = String(text || "").match(regex);
    return match && match[1] ? decodeEntities(match[1]) : null;
}

async function resolveVixCloud(embedURL, referer) {
    const html = await fetchText(embedURL, { headers: { "Referer": referer || BASE_URL + "/" } });

    const masterIndex = html.indexOf("window.masterPlaylist");
    const masterBlock = masterIndex >= 0 ? html.slice(masterIndex, masterIndex + 1800) : "";
    const token = matchOne(masterBlock, /['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
    const expires = matchOne(masterBlock, /['"]expires['"]\s*:\s*['"]([^'"]+)['"]/);
    const masterURL = matchOne(masterBlock, /url\s*:\s*['"](https?:\/\/[^'"]*\/playlist\/[^'"]*)['"]/);

    let streams = [];
    const streamsIndex = html.indexOf("window.streams");
    if (streamsIndex >= 0) {
        const start = html.indexOf("[", streamsIndex);
        const end = html.indexOf("]", start);
        if (start >= 0 && end > start) {
            try {
                streams = JSON.parse(html.slice(start, end + 1));
            } catch (_) {
                streams = [];
            }
        }
    }

    const activeStream = streams.find(function (s) {
        return s && s.active && s.url;
    }) || streams.find(function (s) {
        return s && s.url;
    });

    let playlistURL = masterURL || (activeStream ? activeStream.url : "");
    if (!playlistURL) {
        const idMatch = embedURL.match(/\/embed\/([0-9]+)/);
        if (!idMatch) throw new Error("VixCloud: playlist non trovata");
        playlistURL = "https://vixcloud.cc/playlist/" + idMatch[1];
    }
    playlistURL = playlistURL.split("?")[0];

    let finalToken = token;
    let finalExpires = expires;
    if (!finalToken || !finalExpires) {
        const query = embedURL.split("?")[1] || "";
        const params = {};
        query.split("&").forEach(function (pair) {
            const parts = pair.split("=");
            if (parts[0]) params[parts[0]] = decodeURIComponent(parts[1] || "");
        });
        finalToken = finalToken || params.token;
        finalExpires = finalExpires || params.expires;
    }
    if (!finalToken || !finalExpires) {
        throw new Error("VixCloud: token non trovato");
    }

    return playlistURL + "?ub=1&token=" + encodeURIComponent(finalToken) + "&expires=" + encodeURIComponent(finalExpires);
}

async function loadLinks(data) {
    let info = {};
    try {
        info = typeof data === "object" && data ? data : JSON.parse(String(data));
    } catch (_) {
        info = { url: String(data || "") };
    }

    const referer = info.referer || (BASE_URL + "/");
    let embedURL = info.embed_url || "";

    if (!embedURL && info.episode_id != null) {
        const raw = await fetchText(BASE_URL + "/embed-url/" + info.episode_id, {
            headers: { "Referer": referer }
        });
        embedURL = String(raw || "").trim();
    }

    if (!embedURL) {
        throw new Error("Embed URL AnimeUnity non disponibile");
    }

    if (embedURL.indexOf("vixcloud.cc") >= 0) {
        const playlistURL = await resolveVixCloud(embedURL, referer);
        return [{
            name: "AnimeUnity (VixCloud)",
            url: playlistURL,
            type: "M3U8",
            referer: "https://vixcloud.cc/",
            quality: 1080,
            headers: {
                "Referer": "https://vixcloud.cc/",
                "User-Agent": DEFAULT_HEADERS["User-Agent"]
            }
        }];
    }

    return [{
        name: "AnimeUnity",
        url: embedURL,
        type: embedURL.indexOf(".mp4") >= 0 ? "MP4" : "M3U8",
        referer: referer,
        quality: 1080,
        headers: {
            "Referer": referer,
            "User-Agent": DEFAULT_HEADERS["User-Agent"]
        }
    }];
}

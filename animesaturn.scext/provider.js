/**
 * StreamSC Provider: AnimeSaturn
 * Site: https://animesaturn.at
 */

"use strict";

const BASE_URL = "https://animesaturn.at";
const PROVIDER_ID = "animesaturn";

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

function stripTags(html) {
    return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function absoluteURL(path) {
    if (!path) return "";
    if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) return path;
    if (path.charAt(0) === "/") return BASE_URL + path;
    return BASE_URL + "/" + path;
}

function normalizeAnimeURL(rawURL) {
    let url = absoluteURL(String(rawURL || "").split("?")[0].split("#")[0].replace(/\/$/, ""));
    const watchMatch = url.match(/\/watch\/([^/]+)(?:\/ep-[^/]+)?/i);
    if (watchMatch && watchMatch[1]) {
        return BASE_URL + "/anime/" + watchMatch[1];
    }
    return url;
}

function mapMediaType(rawBadge) {
    const val = String(rawBadge || "").toUpperCase();
    if (val === "MOVIE" || val === "FILM") return "AnimeMovie";
    if (val === "OVA" || val === "ONA" || val === "SPECIAL") return "OVA";
    return "Anime";
}

function deriveBanner(poster) {
    if (!poster) return null;
    if (/\.webp$/i.test(poster) && poster.indexOf("-banner.webp") < 0) {
        return poster.replace(/\.webp$/i, "-banner.webp");
    }
    return poster;
}

function parseCardsFromHTML(html) {
    const cardRegex = /<article[^>]+class="[^"]*\bas-card\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    const seen = {};
    const items = [];
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
        const block = match[1];
        const linkMatch = block.match(/<a[^>]+class="[^"]*\bas-card__poster\b[^"]*"[^>]+href="([^"]+)"/i) ||
                          block.match(/<a[^>]+href="(https?:\/\/[^"]+\/(?:anime|watch)\/[^"]+)"/i);
        if (!linkMatch || !linkMatch[1]) continue;

        const rawHref = decodeEntities(linkMatch[1]);
        const animeURL = normalizeAnimeURL(rawHref);
        const slugMatch = animeURL.match(/\/anime\/([^/?#]+)/i);
        const id = slugMatch && slugMatch[1] ? slugMatch[1] : animeURL;
        if (seen[id]) continue;

        const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*?(?:alt="([^"]*)")?/i);
        const poster = imgMatch && imgMatch[1] ? absoluteURL(decodeEntities(imgMatch[1])) : null;
        let title = imgMatch && imgMatch[2] ? decodeEntities(imgMatch[2]).trim() : "";
        if (!title) {
            const h3Match = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
            title = h3Match ? stripTags(h3Match[1]) : "";
        }
        if (!title) continue;

        const typeMatch = block.match(/as-badge--type[^>]*>([^<]+)</i);
        const isDub = /as-badge--dub/i.test(block);

        seen[id] = true;
        items.push({
            id: id,
            title: title,
            type: mapMediaType(typeMatch ? typeMatch[1].trim() : "TV"),
            poster: poster,
            backdrop: deriveBanner(poster),
            url: animeURL,
            year: null,
            quality: isDub ? "ITA" : "SUB"
        });
    }
    return items;
}

function extractSections(html) {
    const sections = [];
    const secRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
    let m;
    while ((m = secRegex.exec(html)) !== null) {
        const body = m[1];
        const cards = parseCardsFromHTML(body);
        if (cards.length > 0) {
            const h2Match = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
            const heading = h2Match ? stripTags(h2Match[1]).toLowerCase() : "";
            sections.push({ heading: heading, items: cards });
        }
    }
    return sections;
}

// ─── Homepage ────────────────────────────────────────────────────────────────

async function getMainPage(page, sectionKey) {
    const key = sectionKey || "latest";
    const p = page && Number(page) > 1 ? Number(page) : 1;

    if (key === "ongoing") {
        const url = p > 1
            ? BASE_URL + "/status/currently-airing?page=" + p
            : BASE_URL + "/status/currently-airing";
        const html = await cachedText(url);
        const items = parseCardsFromHTML(html);
        return { items: items, hasNextPage: items.length >= 20 };
    }

    const html = await cachedText(BASE_URL + "/");
    const sections = extractSections(html);

    if (key === "latest") {
        const found = sections.find(function (s) { return s.heading.indexOf("ultime") >= 0; }) || sections[0];
        return { items: found ? found.items : parseCardsFromHTML(html), hasNextPage: false };
    }
    if (key === "trending") {
        const found = sections.find(function (s) { return s.heading.indexOf("più visti") >= 0 || s.heading.indexOf("piu visti") >= 0; }) || sections[1] || sections[0];
        return { items: found ? found.items : [], hasNextPage: false };
    }
    if (key === "fresh") {
        const found = sections.find(function (s) { return s.heading.indexOf("nuove") >= 0; }) || sections[2] || sections[0];
        return { items: found ? found.items : [], hasNextPage: false };
    }

    return { items: parseCardsFromHTML(html), hasNextPage: false };
}

// ─── Search ──────────────────────────────────────────────────────────────────

function parseAjaxSearchItems(html) {
    const items = [];
    const seen = {};
    const itemRegex = /<a[^>]+class="[^"]*\bitem\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = itemRegex.exec(html)) !== null) {
        const rawHref = decodeEntities(m[1]);
        const body = m[2];
        const animeURL = normalizeAnimeURL(rawHref);
        const slugMatch = animeURL.match(/\/anime\/([^/?#]+)/i);
        const id = slugMatch && slugMatch[1] ? slugMatch[1] : animeURL;
        if (seen[id]) continue;

        const imgMatch = body.match(/<img[^>]+src="([^"]+)"[^>]*?(?:alt="([^"]*)")?/i);
        const poster = imgMatch && imgMatch[1] ? absoluteURL(decodeEntities(imgMatch[1])) : null;
        const nameMatch = body.match(/<div[^>]+class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const title = nameMatch ? stripTags(nameMatch[1]) : (imgMatch && imgMatch[2] ? decodeEntities(imgMatch[2]).trim() : "");
        if (!title) continue;

        const dotMatch = body.match(/<span[^>]+class="dot"[^>]*>([^<]+)<\/span>/i);
        seen[id] = true;
        items.push({
            id: id,
            title: title,
            type: mapMediaType(dotMatch ? dotMatch[1].trim() : "TV"),
            poster: poster,
            backdrop: deriveBanner(poster),
            url: animeURL,
            year: null,
            quality: "SUB"
        });
    }
    return items;
}

async function search(query, page) {
    const trimmed = String(query || "").trim();
    if (!trimmed) return [];
    const p = page && Number(page) > 1 ? Number(page) : 1;
    let url = BASE_URL + "/filter?keyword=" + encodeURIComponent(trimmed);
    if (p > 1) url += "&page=" + p;

    let items = [];
    try {
        const html = await fetchText(url);
        items = parseCardsFromHTML(html);
    } catch (_) {}

    if (p === 1) {
        try {
            const ajax = await fetchJSON(BASE_URL + "/ajax/anime/search?keyword=" + encodeURIComponent(trimmed), {
                headers: {
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, text/javascript, */*; q=0.01"
                }
            });
            const ajaxHTML = (ajax && ajax.result && ajax.result.html) ? String(ajax.result.html) : "";
            const ajaxItems = parseAjaxSearchItems(ajaxHTML);
            const seen = {};
            const merged = [];
            ajaxItems.concat(items).forEach(function (it) {
                if (it && it.id && !seen[it.id]) {
                    seen[it.id] = true;
                    merged.push(it);
                }
            });
            items = merged;
        } catch (_) {}
    }

    return items;
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function extractSeriesLD(html) {
    const regex = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(m[1].trim());
            if (parsed && (parsed["@type"] === "TVSeries" || parsed["@type"] === "Movie")) {
                return parsed;
            }
        } catch (_) {}
    }
    return null;
}

function parseEpisodesFromAnimePage(html, defaultPoster, malId, anilistId) {
    const episodes = [];
    const seen = {};
    const epRegex = /<a[^>]+class="[^"]*\ban-ep\b[^"]*"[^>]*>/gi;
    let match;

    while ((match = epRegex.exec(html)) !== null) {
        const tag = match[0];
        const hrefMatch = tag.match(/href="([^"]+)"/i);
        const numMatch = tag.match(/data-num="(\d+)"/i);
        if (!hrefMatch || !hrefMatch[1]) continue;

        const watchURL = absoluteURL(decodeEntities(hrefMatch[1]));
        const number = numMatch ? parseInt(numMatch[1], 10) : (episodes.length + 1);
        if (!isFinite(number) || seen[number]) continue;
        seen[number] = true;

        const titleMatch = tag.match(/title="([^"]*)"/i);
        const epTitle = titleMatch && titleMatch[1] ? decodeEntities(titleMatch[1]).trim() : ("Episodio " + number);

        episodes.push({
            id: String(number),
            number: number,
            season: 1,
            title: epTitle || ("Episodio " + number),
            plot: null,
            duration: 24,
            poster: defaultPoster || null,
            loadData: JSON.stringify({
                url: watchURL,
                episode: number,
                mal_id: malId || null,
                anilist_id: anilistId || null
            })
        });
    }

    episodes.sort(function (a, b) { return a.number - b.number; });
    return episodes;
}

async function load(url) {
    const animeURL = normalizeAnimeURL(url);
    const html = await fetchText(animeURL);
    const ld = extractSeriesLD(html) || {};

    const slugMatch = animeURL.match(/\/anime\/([^/?#]+)/i);
    const id = slugMatch && slugMatch[1] ? slugMatch[1] : animeURL;

    const malMatch = html.match(/myanimelist\.net\/anime\/(\d+)/i);
    const anilistMatch = html.match(/anilist\.co\/anime\/(\d+)/i);
    const malId = malMatch ? parseInt(malMatch[1], 10) : null;
    const anilistId = anilistMatch ? parseInt(anilistMatch[1], 10) : null;

    let title = ld.name ? String(ld.name).trim() : "";
    if (!title) {
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        title = h1Match ? stripTags(h1Match[1]) : id;
    }

    let poster = ld.image ? String(ld.image) : null;
    if (!poster) {
        const imgMatch = html.match(/https?:\/\/animesaturn\.at\/storage\/media\/[^"'\s<>]+\.webp/i);
        poster = imgMatch ? imgMatch[0] : null;
    }
    const background = deriveBanner(poster);

    const plot = ld.description ? decodeEntities(String(ld.description)).trim() : null;
    const genres = Array.isArray(ld.genre) ? ld.genre.map(String) : [];

    let year = null;
    if (ld.datePublished) {
        const y = parseInt(String(ld.datePublished).slice(0, 4), 10);
        if (isFinite(y) && y > 1900) year = y;
    }

    let score = null;
    if (ld.aggregateRating && ld.aggregateRating.ratingValue != null) {
        const s = parseFloat(String(ld.aggregateRating.ratingValue));
        if (isFinite(s)) score = s;
    }

    const episodes = parseEpisodesFromAnimePage(html, background || poster, malId, anilistId);
    const firstLoadData = episodes.length > 0 ? episodes[0].loadData : JSON.stringify({
        url: BASE_URL + "/watch/" + id + "/ep-1",
        episode: 1,
        mal_id: malId || null,
        anilist_id: anilistId || null
    });

    const isMovie = ld["@type"] === "Movie" && episodes.length <= 1;

    return {
        id: id,
        title: title,
        type: isMovie ? "AnimeMovie" : "Anime",
        poster: poster,
        background: background,
        plot: plot,
        year: year,
        genres: genres,
        cast: [],
        score: score,
        contentRating: null,
        duration: 24,
        seasons: [{
            id: 1,
            number: 1,
            name: "Stagione 1",
            episodes: episodes
        }],
        loadData: firstLoadData
    };
}

// ─── Stream resolution ──────────────────────────────────────────────────────

function parseServersFromWatchHTML(html) {
    const servers = [];
    const groupRegex = /<fieldset[^>]+data-type="([^"]+)"[^>]*>([\s\S]*?)<\/fieldset>/gi;
    let groupMatch;

    while ((groupMatch = groupRegex.exec(html)) !== null) {
        const audioType = String(groupMatch[1] || "sub").toUpperCase();
        const groupBody = groupMatch[2];
        const itemRegex = /<li[^>]+data-link-id="([^"]+)"[^>]*>/gi;
        let itemMatch;

        while ((itemMatch = itemRegex.exec(groupBody)) !== null) {
            const tag = itemMatch[0];
            const linkId = itemMatch[1];
            const svMatch = tag.match(/data-sv-name="([^"]+)"/i);
            const svName = svMatch && svMatch[1] ? svMatch[1] : "Server";
            servers.push({
                linkId: linkId,
                serverName: svName,
                audio: audioType === "DUB" ? "ITA" : "SUB"
            });
        }
    }

    if (servers.length === 0) {
        const fallbackRegex = /data-link-id="([^"]+)"[^>]*data-sv-name="([^"]+)"/gi;
        let m;
        while ((m = fallbackRegex.exec(html)) !== null) {
            servers.push({
                linkId: m[1],
                serverName: m[2],
                audio: "SUB"
            });
        }
    }
    return servers;
}

async function resolveEmbedStream(embedURL, watchURL) {
    const html = await fetchText(embedURL, {
        headers: { "Referer": watchURL || (BASE_URL + "/") }
    });
    const payloadMatch = html.match(/<script[^>]+id="player-payload"[^>]*>([\s\S]*?)<\/script>/i);
    if (payloadMatch && payloadMatch[1]) {
        try {
            const payload = JSON.parse(payloadMatch[1].trim());
            if (payload && payload.source) {
                const src = String(payload.source);
                const isM3U8 = (payload.type === "m3u8") || src.indexOf(".m3u8") >= 0;
                let referer = BASE_URL + "/";
                try {
                    const hostMatch = embedURL.match(/^(https?:\/\/[^/]+\/)/i);
                    if (hostMatch) referer = hostMatch[1];
                } catch (_) {}
                return {
                    url: src,
                    type: isM3U8 ? "M3U8" : "MP4",
                    referer: referer
                };
            }
        } catch (_) {}
    }

    const directMatch = html.match(/https?:\/\/[^"'\s<>]+(?:\.m3u8|\.mp4)[^"'\s<>]*/i);
    if (directMatch) {
        const src = decodeEntities(directMatch[0]);
        return {
            url: src,
            type: src.indexOf(".m3u8") >= 0 ? "M3U8" : "MP4",
            referer: BASE_URL + "/"
        };
    }
    return null;
}

async function loadLinks(data) {
    let info = {};
    try {
        info = typeof data === "object" && data ? data : JSON.parse(String(data));
    } catch (_) {
        info = { url: String(data || "") };
    }

    let watchURL = absoluteURL(info.url || "");
    if (!watchURL) {
        throw new Error("Watch URL AnimeSaturn non valido");
    }
    if (watchURL.indexOf("/anime/") >= 0) {
        watchURL = watchURL.replace("/anime/", "/watch/") + "/ep-" + (info.episode || 1);
    }

    const watchHTML = await fetchText(watchURL);
    const servers = parseServersFromWatchHTML(watchHTML);
    const links = [];

    for (let i = 0; i < servers.length; i++) {
        const srv = servers[i];
        try {
            const ajaxURL = BASE_URL + "/ajax/server?get=" + encodeURIComponent(srv.linkId);
            const ajaxResp = await fetchJSON(ajaxURL, {
                headers: {
                    "Referer": watchURL,
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, text/javascript, */*; q=0.01"
                }
            });
            const embedURL = ajaxResp && ajaxResp.result && ajaxResp.result.url
                ? absoluteURL(String(ajaxResp.result.url))
                : "";
            if (!embedURL) continue;

            const resolved = await resolveEmbedStream(embedURL, watchURL);
            if (!resolved || !resolved.url) continue;

            links.push({
                name: srv.serverName + " (" + srv.audio + ")",
                url: resolved.url,
                type: resolved.type,
                referer: resolved.referer,
                quality: srv.serverName === "AnimeSaturn" ? 1080 : 720,
                headers: {
                    "Referer": resolved.referer,
                    "User-Agent": DEFAULT_HEADERS["User-Agent"]
                }
            });
        } catch (_) {}
    }

    links.sort(function (a, b) {
        return (b.quality || 0) - (a.quality || 0);
    });
    return links;
}

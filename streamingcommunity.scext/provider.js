/**
 * StreamSC Provider: StreamingCommunity
 * Site: https://streamingcommunityz.day
 *
 * Il sito espone i dati tramite Inertia (attributo data-page nell'HTML SSR).
 * Questo provider non usa il DOM: estrae il JSON, risolve la pagina watch/iframe
 * e ricava il playlist HLS da VixCloud.
 */

"use strict";

const BASE_URL = "https://streamingcommunityz.day";
const PROVIDER_ID = "streamingcommunity";
const DEFAULT_CDN = "https://cdn.streamingcommunityz.day";

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
    "Referer": BASE_URL + "/",
};

// ─── HTTP helpers ────────────────────────────────────────────────────────────

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

// Cache breve per le pagine home: trending/latest/top10 condividono lo stesso HTML.
const pageCache = {};
const PAGE_CACHE_TTL = 5 * 60 * 1000;

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

// ─── HTML / Inertia helpers ──────────────────────────────────────────────────

function decodeEntities(value) {
    if (!value) return value;
    return value
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

function extractPage(html) {
    const match = html.match(/data-page\s*=\s*"([^"]*)"/i);
    if (!match) {
        throw new Error("Risposta StreamingCommunity senza data-page");
    }
    const parsed = JSON.parse(decodeEntities(match[1]));
    if (!parsed || !parsed.props) {
        throw new Error("Payload data-page non valido");
    }
    return parsed;
}

function absoluteURL(path) {
    if (!path) return "";
    const str = String(path).trim();
    if (str.indexOf("http://") === 0 || str.indexOf("https://") === 0) {
        return str.replace(/^https?:\/\/[^/]*(?:streamingcommunity|streamingunity)[^/]*/i, BASE_URL);
    }
    if (str.charAt(0) === "/") return BASE_URL + str;
    return BASE_URL + "/" + str;
}

function normalizeTitleURL(rawURL) {
    let value = String(rawURL || "").split("?")[0].split("#")[0];
    value = value.replace(/\/season-[0-9]+\/?$/, "");
    value = value.replace(/\/$/, "");
    if (!value) return BASE_URL + "/it";
    return absoluteURL(value);
}

// ─── Data mapping ────────────────────────────────────────────────────────────

function itemType(title) {
    if (title && title.type === "tv") return "TvSeries";
    if (title && title.type === "movie") return "Movie";
    return "Movie";
}

function yearOf(title) {
    const raw = (title && (title.release_date || title.release_date_it || title.last_air_date || title.last_air_date_it)) || "";
    const year = parseInt(String(raw).slice(0, 4), 10);
    return isFinite(year) && year > 1800 ? year : null;
}

function imageURL(cdn, images, preferredTypes) {
    const list = Array.isArray(images) ? images : [];
    for (let i = 0; i < preferredTypes.length; i++) {
        const type = preferredTypes[i];
        let image = list.find(function (entry) {
            return entry && entry.type === type && entry.filename && (entry.lang === "it" || !entry.lang);
        });
        if (!image) {
            image = list.find(function (entry) {
                return entry && entry.type === type && entry.filename;
            });
        }
        if (image) {
            return (cdn || DEFAULT_CDN) + "/images/" + image.filename;
        }
    }
    return null;
}

function buildMediaItem(title, cdn) {
    if (!title || title.id == null || !title.name) return null;
    const slug = title.slug ? "-" + title.slug : "";
    const url = BASE_URL + "/it/titles/" + title.id + slug;
    return {
        id: String(title.id),
        title: String(title.name),
        type: itemType(title),
        poster: imageURL(cdn, title.images, ["poster", "cover", "background"]),
        backdrop: imageURL(cdn, title.images, ["background", "cover", "poster"]),
        url: url,
        year: yearOf(title),
        quality: title.quality || null
    };
}

function dedupeItems(items) {
    const seen = {};
    const result = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.id || seen[item.id]) continue;
        seen[item.id] = true;
        result.push(item);
    }
    return result;
}

function titlesFromProps(props, sliderName) {
    const sliders = Array.isArray(props.sliders) ? props.sliders : [];
    let slider = null;
    if (sliderName) {
        slider = sliders.find(function (entry) {
            return entry && entry.name === sliderName;
        });
    }
    if (!slider) slider = sliders.find(function (entry) {
        return entry && Array.isArray(entry.titles) && entry.titles.length > 0;
    });
    if (slider && Array.isArray(slider.titles)) return slider.titles;
    if (Array.isArray(props.titles)) return props.titles;
    return [];
}

// ─── Homepage ────────────────────────────────────────────────────────────────

function sectionSpec(sectionKey) {
    const key = sectionKey || "trending";
    switch (key) {
    case "trending":
        return { url: BASE_URL + "/it", slider: "trending" };
    case "latest":
        return { url: BASE_URL + "/it", slider: "latest" };
    case "top10":
        return { url: BASE_URL + "/it", slider: "top10" };
    case "movies":
        return { url: BASE_URL + "/it/movies", slider: "trending" };
    case "movie-latest":
        return { url: BASE_URL + "/it/movies", slider: "latest" };
    case "movie-top10":
        return { url: BASE_URL + "/it/movies", slider: "top10" };
    case "tv-shows":
        return { url: BASE_URL + "/it/tv-shows", slider: "trending" };
    case "tv-latest":
        return { url: BASE_URL + "/it/tv-shows", slider: "latest" };
    case "tv-top10":
        return { url: BASE_URL + "/it/tv-shows", slider: "top10" };
    default:
        if (key.indexOf("http://") === 0 || key.indexOf("https://") === 0 || key.charAt(0) === "/") {
            return { url: absoluteURL(key), slider: null };
        }
        return { url: BASE_URL + "/it", slider: key };
    }
}

async function getMainPage(page, sectionKey) {
    const spec = sectionSpec(sectionKey);
    let url = spec.url;
    if (page && page > 1) {
        url += (url.indexOf("?") >= 0 ? "&" : "?") + "page=" + page;
    }

    const html = await cachedText(url);
    const data = extractPage(html);
    const cdn = data.props.cdn_url || DEFAULT_CDN;
    const titles = titlesFromProps(data.props, spec.slider);
    const items = dedupeItems(titles.map(function (title) {
        return buildMediaItem(title, cdn);
    }).filter(Boolean));

    return { items: items, hasNextPage: false };
}

// ─── Search ──────────────────────────────────────────────────────────────────

async function search(query, page) {
    const trimmed = String(query || "").trim();
    if (!trimmed) return [];

    let url = BASE_URL + "/it/search?q=" + encodeURIComponent(trimmed);
    if (page && Number(page) > 1) url += "&page=" + Number(page);

    const html = await fetchText(url);
    const data = extractPage(html);
    const cdn = data.props.cdn_url || DEFAULT_CDN;
    const titles = Array.isArray(data.props.titles) ? data.props.titles : [];

    return dedupeItems(titles.map(function (title) {
        return buildMediaItem(title, cdn);
    }).filter(Boolean));
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function buildEpisode(episode, title, cdn, seasonNumber) {
    if (!episode || episode.id == null) return null;
    const number = Number(episode.number);
    if (!isFinite(number)) return null;
    const loadData = {
        url: BASE_URL + "/it/watch/" + title.id + "?e=" + episode.id,
        title_id: title.id,
        episode_id: episode.id,
        season: seasonNumber,
        episode: number,
        imdb_id: title.imdb_id || null,
        tmdb_id: title.tmdb_id || null
    };
    return {
        id: String(episode.id),
        number: number,
        season: seasonNumber,
        title: episode.name || null,
        plot: episode.plot || null,
        duration: episode.duration != null ? Number(episode.duration) : null,
        poster: imageURL(cdn, episode.images, ["cover", "background", "poster"]),
        loadData: JSON.stringify(loadData)
    };
}

async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function run() {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }

    const runners = [];
    const count = Math.min(limit, items.length);
    for (let i = 0; i < count; i++) runners.push(run());
    await Promise.all(runners);
    return results;
}

async function loadSeasons(page, pageURL, title, cdn) {
    const loaded = page.props.loadedSeason;
    let metas = Array.isArray(title.seasons) ? title.seasons.slice() : [];
    metas.sort(function (a, b) { return Number(a.number) - Number(b.number); });

    if (metas.length === 0 && loaded) {
        metas = [loaded];
    }

    const seasons = await mapLimit(metas, 4, async function (meta) {
        const seasonNumber = Number(meta.number);
        let season = null;

        if (loaded && Number(loaded.number) === seasonNumber) {
            season = loaded;
        } else {
            try {
                const seasonURL = pageURL + "/season-" + seasonNumber;
                const seasonHTML = await cachedText(seasonURL);
                season = extractPage(seasonHTML).props.loadedSeason;
            } catch (error) {
                console.log("[StreamingCommunity] stagione " + seasonNumber + " non caricata: " + error);
            }
        }

        const episodes = ((season && season.episodes) || [])
            .map(function (episode) {
                return buildEpisode(episode, title, cdn, seasonNumber);
            })
            .filter(Boolean);

        return {
            id: Number(meta.id),
            number: seasonNumber,
            name: (season && season.name) || meta.name || ("Stagione " + seasonNumber),
            episodes: episodes
        };
    });

    return seasons.filter(function (season) {
        return season && isFinite(season.number);
    });
}

async function load(url) {
    const pageURL = normalizeTitleURL(url);
    const html = await fetchText(pageURL);
    const page = extractPage(html);
    const title = page.props.title;
    if (!title || title.id == null) {
        throw new Error("Titolo non trovato");
    }

    const cdn = page.props.cdn_url || DEFAULT_CDN;
    const isTV = title.type === "tv";
    const seasons = isTV ? await loadSeasons(page, pageURL, title, cdn) : null;

    const score = title.score != null ? parseFloat(title.score) : NaN;
    const runtime = title.runtime != null ? parseInt(title.runtime, 10) : NaN;

    return {
        id: String(title.id),
        title: String(title.name || ""),
        type: isTV ? "TvSeries" : "Movie",
        poster: imageURL(cdn, title.images, ["poster", "cover", "background"]),
        background: imageURL(cdn, title.images, ["background", "cover", "poster"]),
        plot: title.plot || null,
        year: yearOf(title),
        genres: (title.genres || []).map(function (genre) { return genre && genre.name; }).filter(Boolean),
        cast: (title.main_actors || []).map(function (actor) { return actor && actor.name; }).filter(Boolean),
        score: isFinite(score) ? score : null,
        contentRating: title.age != null ? String(title.age) + "+" : null,
        duration: isFinite(runtime) ? runtime : null,
        seasons: seasons,
        loadData: JSON.stringify({
            url: BASE_URL + "/it/watch/" + title.id,
            title_id: title.id,
            imdb_id: title.imdb_id || null,
            tmdb_id: title.tmdb_id || null
        })
    };
}

// ─── Stream resolution ──────────────────────────────────────────────────────

function parseLoadData(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
        const parsed = JSON.parse(String(value));
        if (parsed && typeof parsed === "object") return parsed;
        return { url: String(value) };
    } catch (_) {
        return { url: String(value) };
    }
}

function extractIframeSource(html) {
    let match = html.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
    if (match && match[1]) return decodeEntities(match[1]);
    match = html.match(/https?:\/\/vixcloud\.cc\/embed\/[^"'\s<>]+/i);
    return match ? decodeEntities(match[0]) : null;
}

function matchOne(text, regex) {
    const match = text.match(regex);
    return match && match[1] ? decodeEntities(match[1]) : null;
}

async function resolveVixCloud(embedURL, referer) {
    const html = await fetchText(embedURL, { headers: { "Referer": referer || embedURL } });

    const masterIndex = html.indexOf("window.masterPlaylist");
    const masterBlock = masterIndex >= 0 ? html.slice(masterIndex, masterIndex + 1600) : "";
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

    const activeStream = streams.find(function (stream) {
        return stream && stream.active && stream.url;
    }) || streams.find(function (stream) {
        return stream && stream.url;
    });

    let playlistURL = masterURL || (activeStream ? activeStream.url : "");
    if (!playlistURL) {
        const idMatch = embedURL.match(/\/embed\/([0-9]+)/);
        if (!idMatch) throw new Error("VixCloud: playlist non trovata");
        playlistURL = "https://vixcloud.cc/playlist/" + idMatch[1];
    }
    playlistURL = playlistURL.split("?")[0];

    const query = embedURL.split("?")[1] || "";
    const params = {};
    query.split("&").forEach(function (pair) {
        const parts = pair.split("=");
        if (parts[0]) params[parts[0]] = decodeURIComponent(parts[1] || "");
    });

    let finalToken = token || params.token;
    let finalExpires = expires || params.expires;
    if (!finalToken || !finalExpires) {
        throw new Error("VixCloud: token scaduto o assente");
    }

    // VixCloud answers HTTP 403 on the master playlist unless FHD-enabled
    // embeds also carry `h=1`, exactly like the site's own player does.
    const canPlayFHD = params.canPlayFHD && params.canPlayFHD !== "0" && params.canPlayFHD !== "false";

    let streamURL = playlistURL
        + "?ub=1&token=" + encodeURIComponent(finalToken)
        + "&expires=" + encodeURIComponent(finalExpires);
    if (canPlayFHD) {
        streamURL += "&h=1";
    }
    return streamURL;
}

async function loadLinks(data) {
    const info = parseLoadData(data);
    let watchURL = info.url || "";
    let titleId = info.title_id || null;
    let episodeId = info.episode_id || null;

    if (watchURL) {
        watchURL = absoluteURL(watchURL);
        const titleMatch = watchURL.match(/\/(?:titles|watch)\/([0-9]+)/);
        if (titleMatch && !titleId) {
            titleId = titleMatch[1];
        }
        const epQueryMatch = watchURL.match(/[?&]e=([0-9]+)/);
        if (epQueryMatch && !episodeId) {
            episodeId = epQueryMatch[1];
        }
    }

    if (!episodeId && titleId && info.season && info.episode) {
        try {
            const seasonHTML = await fetchText(BASE_URL + "/it/titles/" + titleId + "/season-" + info.season);
            const seasonPage = extractPage(seasonHTML);
            const loadedSeason = seasonPage.props && seasonPage.props.loadedSeason;
            const episodes = (loadedSeason && Array.isArray(loadedSeason.episodes)) ? loadedSeason.episodes : [];
            const matched = episodes.find(function (ep) {
                return ep && Number(ep.number) === Number(info.episode);
            });
            if (matched && matched.id != null) {
                episodeId = matched.id;
            }
        } catch (_) {}
    }

    if (watchURL && /\/titles\/[0-9]+/.test(watchURL)) {
        watchURL = BASE_URL + "/it/watch/" + titleId;
        if (episodeId) watchURL += "?e=" + episodeId;
    } else if (watchURL && episodeId && !/[?&]e=/.test(watchURL)) {
        watchURL += (watchURL.indexOf("?") >= 0 ? "&" : "?") + "e=" + episodeId;
    }

    if (!watchURL && titleId) {
        watchURL = BASE_URL + "/it/watch/" + titleId;
        if (episodeId) watchURL += "?e=" + episodeId;
    }

    if (!watchURL) {
        throw new Error("loadData non valido");
    }

    let embedURL = "";
    if (/\/iframe\//.test(watchURL)) {
        embedURL = watchURL;
    } else {
        const watchHTML = await fetchText(watchURL);
        const watchPage = extractPage(watchHTML);
        if (watchPage.props.redirectToLogin) {
            throw new Error("Contenuto disponibile solo con un account StreamingCommunity");
        }
        embedURL = watchPage.props.embedUrl || "";
        if (!embedURL && watchPage.props.title && watchPage.props.title.id != null) {
            embedURL = BASE_URL + "/it/iframe/" + watchPage.props.title.id;
            if (episodeId) embedURL += "?episode_id=" + episodeId;
        }
    }

    if (!embedURL) {
        throw new Error("Embed URL non disponibile");
    }

    let vixURL = absoluteURL(embedURL);
    if (!/vixcloud\.cc/.test(vixURL)) {
        const iframeHTML = await fetchText(vixURL, { headers: { "Referer": watchURL } });
        const source = extractIframeSource(iframeHTML);
        if (!source) throw new Error("Stream VixCloud non trovato");
        vixURL = absoluteURL(source);
    }

    const playlistURL = await resolveVixCloud(vixURL, watchURL);

    return [{
        name: "StreamingCommunity",
        url: playlistURL,
        type: "M3U8",
        referer: "https://vixcloud.cc/",
        quality: null,
        headers: {
            "Referer": "https://vixcloud.cc/",
            "User-Agent": DEFAULT_HEADERS["User-Agent"]
        }
    }];
}

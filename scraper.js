import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

const TARGET_URL = process.env.TARGET_URL && process.env.TARGET_URL.endsWith('/')
    ? process.env.TARGET_URL
    : (process.env.TARGET_URL + '/');

async function scrapeVideos(skip = 0, query = null) {
    try {
        let page = 1;
        if (skip > 0) {
            page = Math.floor(skip / 24) + 1;
        }

        let url = TARGET_URL;
        if (query) {
            const formattedQuery = query.trim().replace(/\s+/g, '-');
            const encodedQuery = encodeURIComponent(formattedQuery);
            url += `search/${encodedQuery}/relevance/`;
            if (page > 1) {
                url += `${page}/`;
            }
        } else if (page > 1) {
            url += `latest-updates/${page}/`;
        }

        console.log(`Scraping page ${page} (${url}) with got-scraping...`);

        const response = await gotScraping({
            url: url,
            headerGeneratorOptions: {
                browsers: [
                    { name: 'chrome', minVersion: 120 },
                ],
                devices: ['desktop'],
                locales: ['es-ES', 'es'],
            }
        });

        const $ = cheerio.load(response.body);
        const videos = [];

        $('.item').each((index, element) => {
            const $el = $(element);
            const $link = $el.find('a').first();
            const $img = $el.find('img').first();

            let linkHref = $link.attr('href');
            if (linkHref && !linkHref.startsWith('http')) {
                linkHref = new URL(linkHref, TARGET_URL).href;
            }

            const title = $link.attr('title') || $img.attr('alt') || 'Sin título';
            const poster = $img.attr('data-src') || $img.attr('src');

            let id = '';
            if (linkHref) {
                id = `wow:${Buffer.from(linkHref).toString('base64')}`;
            }

            if (linkHref && title && id) {
                videos.push({
                    id: id,
                    type: 'movie',
                    name: title,
                    poster: poster,
                    description: title,
                });
            }
        });

        console.log(`Found ${videos.length} videos on page ${page}.`);
        return videos;

    } catch (error) {
        if (error.response) {
            console.error(`Error scraping: Request failed with status code ${error.response.statusCode}`);
            if (error.response.statusCode === 403) {
                console.error("403 Forbidden: Cloudflare is still blocking the request despite got-scraping.");
            }
        } else {
            console.error("Error scraping:", error.message);
        }
        return [];
    }
}

async function getStream(id) {
    try {
        if (!id.startsWith('wow:')) return null;

        const encodedUrl = id.replace('wow:', '');
        const url = Buffer.from(encodedUrl, 'base64').toString('ascii');
        console.log(`Fetching stream for URL: ${url}`);

        const response = await gotScraping({
            url: url,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop'],
                locales: ['es-ES', 'es'],
            }
        });

        const $ = cheerio.load(response.body);

        let embedUrl = '';
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const data = JSON.parse($(el).html());
                if (data.embedUrl) embedUrl = data.embedUrl;
            } catch (e) { }
        });

        if (!embedUrl) {
            const match = response.body.match(/embedUrl\s*[:=]\s*["']([^"']+)["']/);
            if (match) embedUrl = match[1];
        }

        const streams = [];
        $('source').each((i, el) => {
            const src = $(el).attr('src');
            const label = $(el).attr('label') || 'MP4';
            if (src && src.includes('get_file')) {
                streams.push({
                    title: label,
                    url: src,
                    behaviorHints: { notWebReady: false }
                });
            }
        });

        if (streams.length > 0) {
            console.log(`Found ${streams.length} sources directly on page.`);
            streams.sort((a, b) => {
                if (a.title.toLowerCase().includes('720p')) return -1;
                if (b.title.toLowerCase().includes('720p')) return 1;
                return 0;
            });
            return streams;
        }

        if (embedUrl) {
            console.log(`Found embed URL: ${embedUrl}`);
            try {
                const videoIdMatch = embedUrl.match(/\/embed\/(\d+)/);
                const videoId = videoIdMatch ? videoIdMatch[1] : null;

                const headers = {
                    'Referer': url
                };

                if (videoId) {
                    headers['Cookie'] = `kt_rt_videoQuality_${videoId}=720p; kt_rt_videoQuality=720p`;
                }

                const embedResponse = await gotScraping({
                    url: embedUrl,
                    headers: headers,
                    headerGeneratorOptions: {
                        browsers: [{ name: 'chrome', minVersion: 120 }],
                        devices: ['desktop'],
                        locales: ['es-ES', 'es'],
                    }
                });

                const flashvarsMatch = embedResponse.body.match(/var\s+flashvars\s*=\s*\{([\s\S]+?)\};/);

                if (flashvarsMatch) {
                    const block = flashvarsMatch[1];
                    const getValue = (key) => {
                        const regex = new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`);
                        const m = block.match(regex);
                        return m ? m[1] : null;
                    };

                    const embedStreams = [];
                    const keys = [
                        { url: 'video_url', text: 'video_url_text', default: 'Default' },
                        { url: 'video_alt_url', text: 'video_alt_url_text', default: '480p' },
                        { url: 'video_alt_url2', text: 'video_alt_url2_text', default: '720p' },
                        { url: 'video_alt_url3', text: 'video_alt_url3_text', default: '1080p' }
                    ];

                    for (const key of keys) {
                        const videoUrl = getValue(key.url);
                        if (videoUrl && videoUrl.includes('get_file')) {
                            const label = getValue(key.text) || key.default;
                            embedStreams.push({
                                title: label,
                                url: videoUrl,
                                behaviorHints: { notWebReady: false }
                            });
                        }
                    }

                    if (embedStreams.length > 0) {
                        embedStreams.sort((a, b) => {
                            if (a.title.toLowerCase().includes('720p')) return -1;
                            if (b.title.toLowerCase().includes('720p')) return 1;
                            return 0;
                        });
                        return embedStreams;
                    }
                }
            } catch (embedError) {
                console.error("Error scraping embed page:", embedError.message);
            }
        }

        return embedUrl ? { title: 'Ver en Web', externalUrl: embedUrl } : null;

    } catch (error) {
        if (error.response) {
            console.error(`Error getting stream: Request failed with status code ${error.response.statusCode}`);
        } else {
            console.error("Error getting stream:", error.message);
        }
        return null;
    }
}

export { scrapeVideos, getStream };

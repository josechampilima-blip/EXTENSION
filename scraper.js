const axios = require('axios');
const cheerio = require('cheerio');

const TARGET_URL = "https://www.wow.xxx/es/";

async function scrapeVideos(skip = 0) {
    try {
        // Pagination logic
        // Page 1: skip 0. Page 2: skip 24 approx (site shows ~24-36 items).
        // URL pattern: https://www.wow.xxx/es/latest-updates/2/

        let page = 1;
        if (skip > 0) {
            page = Math.floor(skip / 24) + 1;
        }

        let url = TARGET_URL;
        if (page > 1) {
            url = `https://www.wow.xxx/es/latest-updates/${page}/`;
        }

        console.log(`Scraping page ${page} (${url})...`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
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
        console.error("Error scraping:", error.message);
        return [];
    }
}

async function getStream(id) {
    try {
        if (!id.startsWith('wow:')) return null;

        const encodedUrl = id.replace('wow:', '');
        const url = Buffer.from(encodedUrl, 'base64').toString('ascii');
        console.log(`Fetching stream for URL: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);

        let embedUrl = '';
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const data = JSON.parse($(el).html());
                if (data.embedUrl) embedUrl = data.embedUrl;
            } catch (e) { }
        });

        if (!embedUrl) {
            const match = response.data.match(/embedUrl\s*[:=]\s*["']([^"']+)["']/);
            if (match) embedUrl = match[1];
        }

        if (embedUrl) {
            console.log(`Found embed URL: ${embedUrl}`);
            try {
                const embedResponse = await axios.get(embedUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Referer': url
                    }
                });

                const flashvarsMatch = embedResponse.data.match(/var flashvars = \{([\s\S]+?)\};/);
                if (flashvarsMatch) {
                    const block = flashvarsMatch[1];
                    const getValue = (key) => {
                        const regex = new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`);
                        const m = block.match(regex);
                        return m ? m[1] : null;
                    };

                    // Only look for the reliable 480p link as requested
                    const alt1 = getValue('video_alt_url');
                    const alt1Label = getValue('video_alt_url_text') || '480p';

                    if (alt1 && alt1.includes('get_file')) {
                        return {
                            title: `${alt1Label}`,
                            url: alt1,
                            behaviorHints: { notWebReady: false }
                        };
                    }
                }
            } catch (embedError) {
                console.error("Error scraping embed page:", embedError.message);
            }

            // Fallback
            return {
                title: 'Ver en Web',
                externalUrl: embedUrl
            };
        }

        return null;
    } catch (error) {
        console.error("Error getting stream:", error.message);
        return null;
    }
}

module.exports = { scrapeVideos, getStream };

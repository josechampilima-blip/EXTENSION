const axios = require('axios');
const cheerio = require('cheerio');

const TARGET_URL = process.env.TARGET_URL || 'https://www.wow.xxx/es/';

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

        console.log(`Scraping page ${page} (${url})...`);
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
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

        // 1. Try to get direct <source> tags from the main page first
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
            // Sort to put 720p first
            streams.sort((a, b) => {
                if (a.title.toLowerCase().includes('720p')) return -1;
                if (b.title.toLowerCase().includes('720p')) return 1;
                return 0;
            });
            return streams;
        }

        // 2. Fallback to embed logic if no direct sources found
        if (embedUrl) {
            console.log(`Found embed URL: ${embedUrl}`);
            try {
                const videoIdMatch = embedUrl.match(/\/embed\/(\d+)/);
                const videoId = videoIdMatch ? videoIdMatch[1] : null;

                let headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': url
                };

                if (videoId) {
                    headers['Cookie'] = `kt_rt_videoQuality_${videoId}=720p; kt_rt_videoQuality=720p`;
                    console.log(`Setting quality cookie for ID ${videoId}`);
                }

                const embedResponse = await axios.get(embedUrl, { headers });
                const flashvarsMatch = embedResponse.data.match(/var\s+flashvars\s*=\s*\{([\s\S]+?)\};/);

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
                        // Sort to put 720p first if available
                        embedStreams.sort((a, b) => {
                            if (a.title.toLowerCase().includes('720p')) return -1;
                            if (b.title.toLowerCase().includes('720p')) return 1;
                            return 0;
                        });
                        console.log(`Found ${embedStreams.length} quality options.`);
                        return embedStreams;
                    }
                }
            } catch (embedError) {
                console.error("Error scraping embed page:", embedError.message);
            }
        }

        return embedUrl ? { title: 'Ver en Web', externalUrl: embedUrl } : null;

    } catch (error) {
        console.error("Error getting stream:", error.message);
        return null;
    }
}

module.exports = { scrapeVideos, getStream };

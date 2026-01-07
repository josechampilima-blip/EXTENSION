const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { scrapeVideos, getStream } = require('./scraper');

const builder = new addonBuilder({
    id: "org.mywebsite.addon",
    version: "1.0.0",
    name: "My Website Scraper",
    description: "Scrapes videos from my website",
    resources: ["catalog", "stream", "meta"],
    types: ["movie", "series"],
    catalogs: [
        {
            type: "movie",
            id: "mywebsite-movies",
            name: "My Website Movies",
            extra: [
                { name: "search", isRequired: false },
                { name: "skip", isRequired: false }
            ]
        }
    ]
});

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log("Request for catalog:", type, id, extra);
    if (type === "movie" && id === "mywebsite-movies") {
        const skip = extra && extra.skip ? parseInt(extra.skip) : 0;
        const query = extra && extra.search ? extra.search : null;
        const videos = await scrapeVideos(skip, query);
        // Ensure metas follow Stremio format
        return { metas: videos };
    }
    return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log("Request for meta:", type, id);
    // Logic to get details for a specific item
    // Ideally we should scrape details here too, but for now return minimal info
    // or rely on catalog data if passed
    // NOTE: Stremio often uses the catalog item as meta if not detailed here
    return { meta: { id, type: 'movie' } };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log("Request for streams:", type, id);
    const result = await getStream(id);
    if (result) {
        if (Array.isArray(result)) {
            return { streams: result };
        } else {
            return { streams: [result] };
        }
    }
    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`Addon active on: ${process.env.PUBLIC_URL || `http://localhost:${port}`}`);

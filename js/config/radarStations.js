// js/config/radarStations.js

export const RADAR_STATIONS = [
    // --- NORTHEAST & MID-ATLANTIC ---
    { id: "KDIX", name: "Philadelphia / Mt. Holly", state: "NJ", lat: 39.9469, lon: -74.4111, type: "wsr88d" },
    { id: "KOKX", name: "New York City / Upton", state: "NY", lat: 40.8656, lon: -72.8628, type: "wsr88d" },
    { id: "KDOX", name: "Dover AFB", state: "DE", lat: 38.8256, lon: -75.4400, type: "wsr88d" },
    { id: "KLWX", name: "Washington DC / Sterling", state: "VA", lat: 38.9761, lon: -77.4875, type: "wsr88d" },
    { id: "KCCX", name: "State College", state: "PA", lat: 40.9231, lon: -78.0039, type: "wsr88d" },
    { id: "KPBZ", name: "Pittsburgh", state: "PA", lat: 40.5317, lon: -80.2181, type: "wsr88d" },
    { id: "KBGM", name: "Binghamton", state: "NY", lat: 42.1997, lon: -75.9847, type: "wsr88d" },
    { id: "KBUF", name: "Buffalo", state: "NY", lat: 42.9489, lon: -78.7369, type: "wsr88d" },
    { id: "KENX", name: "Albany", state: "NY", lat: 42.5864, lon: -74.0639, type: "wsr88d" },
    { id: "KTYX", name: "Fort Drum / Montague", state: "NY", lat: 43.7558, lon: -75.6800, type: "wsr88d" },
    { id: "KBOX", name: "Boston / Taunton", state: "MA", lat: 41.9558, lon: -71.1375, type: "wsr88d" },
    { id: "KGYX", name: "Portland / Gray", state: "ME", lat: 43.8914, lon: -70.2564, type: "wsr88d" },
    { id: "KCBW", name: "Caribou / Houlton", state: "ME", lat: 46.0392, lon: -67.8064, type: "wsr88d" },
    { id: "KAKQ", name: "Norfolk / Wakefield", state: "VA", lat: 36.9839, lon: -77.0075, type: "wsr88d" },
    { id: "KFCX", name: "Roanoke / Blacksburg", state: "VA", lat: 37.0242, lon: -80.2742, type: "wsr88d" },
    { id: "KRLX", name: "Charleston", state: "WV", lat: 38.3111, lon: -81.7231, type: "wsr88d" },

    // --- CAROLINAS & SOUTHEAST ---
    { id: "KRAX", name: "Raleigh / Durham", state: "NC", lat: 35.6614, lon: -78.4897, type: "wsr88d" },
    { id: "KMHX", name: "Morehead City / Newport", state: "NC", lat: 34.7761, lon: -76.8761, type: "wsr88d" },
    { id: "KLTX", name: "Wilmington", state: "NC", lat: 33.9892, lon: -78.4289, type: "wsr88d" },
    { id: "KGSP", name: "Greenville / Spartanburg", state: "SC", lat: 34.8833, lon: -82.2197, type: "wsr88d" },
    { id: "KCAE", name: "Columbia", state: "SC", lat: 33.9486, lon: -81.1186, type: "wsr88d" },
    { id: "KCLX", name: "Charleston", state: "SC", lat: 32.6556, lon: -81.0422, type: "wsr88d" },
    { id: "KFFC", name: "Atlanta / Peachtree City", state: "GA", lat: 33.3636, lon: -84.5658, type: "wsr88d" },
    { id: "KVAX", name: "Moody AFB / Valdosta", state: "GA", lat: 30.8903, lon: -83.0019, type: "wsr88d" },
    { id: "KJAX", name: "Jacksonville", state: "FL", lat: 30.4847, lon: -81.7019, type: "wsr88d" },
    { id: "KTBW", name: "Tampa Bay / Ruskin", state: "FL", lat: 27.7056, lon: -82.4017, type: "wsr88d" },
    { id: "KMLB", name: "Melbourne", state: "FL", lat: 28.1133, lon: -80.6542, type: "wsr88d" },
    { id: "KAMX", name: "Miami", state: "FL", lat: 25.6111, lon: -80.4128, type: "wsr88d" },
    { id: "KBYX", name: "Key West", state: "FL", lat: 24.5975, lon: -81.7031, type: "wsr88d" },
    { id: "KTLH", name: "Tallahassee", state: "FL", lat: 30.3975, lon: -84.3289, type: "wsr88d" },
    { id: "KEVX", name: "Eglin AFB / Northwest FL", state: "FL", lat: 30.5644, lon: -85.9214, type: "wsr88d" },
    { id: "KBMX", name: "Birmingham", state: "AL", lat: 33.1722, lon: -86.7697, type: "wsr88d" },
    { id: "KMXX", name: "Maxwell AFB / Montgomery", state: "AL", lat: 32.5367, lon: -85.7897, type: "wsr88d" },
    { id: "KMOB", name: "Mobile", state: "AL", lat: 30.6794, lon: -88.2397, type: "wsr88d" },
    { id: "KHTX", name: "Huntsville", state: "AL", lat: 34.9306, lon: -86.0833, type: "wsr88d" },
    { id: "KGWX", name: "Columbus AFB", state: "MS", lat: 33.8967, lon: -88.3292, type: "wsr88d" },
    { id: "KDGX", name: "Jackson / Brandon", state: "MS", lat: 32.2800, lon: -89.9842, type: "wsr88d" },
    { id: "KLIX", name: "New Orleans / Slidell", state: "LA", lat: 30.3367, lon: -89.8256, type: "wsr88d" },
    { id: "KLCH", name: "Lake Charles", state: "LA", lat: 30.1253, lon: -93.2158, type: "wsr88d" },
    { id: "KSHV", name: "Shreveport", state: "LA", lat: 32.4508, lon: -93.8414, type: "wsr88d" },
    { id: "KPOE", name: "Fort Polk", state: "LA", lat: 31.1556, lon: -92.9761, type: "wsr88d" },

    // --- MIDWEST & OHIO VALLEY ---
    { id: "KILN", name: "Cincinnati / Wilmington", state: "OH", lat: 39.4281, lon: -83.8219, type: "wsr88d" },
    { id: "KCLE", name: "Cleveland", state: "OH", lat: 41.4131, lon: -81.8597, type: "wsr88d" },
    { id: "KIND", name: "Indianapolis", state: "IN", lat: 39.7075, lon: -86.2803, type: "wsr88d" },
    { id: "KIWX", name: "Northern Indiana", state: "IN", lat: 41.3586, lon: -85.7000, type: "wsr88d" },
    { id: "KVWX", name: "Evansville", state: "IN", lat: 38.2600, lon: -87.7247, type: "wsr88d" },
    { id: "KLOT", name: "Chicago / Romeoville", state: "IL", lat: 41.6044, lon: -88.0847, type: "wsr88d" },
    { id: "KILX", name: "Central Illinois / Lincoln", state: "IL", lat: 40.1506, lon: -89.3369, type: "wsr88d" },
    { id: "KDTX", name: "Detroit / White Lake", state: "MI", lat: 42.6997, lon: -83.4717, type: "wsr88d" },
    { id: "KGRR", name: "Grand Rapids", state: "MI", lat: 42.8939, lon: -85.5447, type: "wsr88d" },
    { id: "KAPX", name: "Alpena / Gaylord", state: "MI", lat: 44.9072, lon: -84.7197, type: "wsr88d" },
    { id: "KMQT", name: "Marquette", state: "MI", lat: 46.5311, lon: -87.5483, type: "wsr88d" },
    { id: "KMKX", name: "Milwaukee / Sullivan", state: "WI", lat: 43.0033, lon: -88.5506, type: "wsr88d" },
    { id: "KARX", name: "La Crosse", state: "WI", lat: 43.8228, lon: -91.1911, type: "wsr88d" },
    { id: "KGRB", name: "Green Bay", state: "WI", lat: 44.4983, lon: -88.1111, type: "wsr88d" },
    { id: "KMPX", name: "Minneapolis / Chanhassen", state: "MN", lat: 44.8489, lon: -93.5656, type: "wsr88d" },
    { id: "KDLH", name: "Duluth", state: "MN", lat: 46.7375, lon: -92.2097, type: "wsr88d" },
    { id: "KDMX", name: "Des Moines", state: "IA", lat: 41.7311, lon: -93.7228, type: "wsr88d" },
    { id: "KDVN", name: "Quad Cities / Davenport", state: "IA", lat: 41.6117, lon: -90.5808, type: "wsr88d" },
    { id: "KLSX", name: "St. Louis", state: "MO", lat: 38.6989, lon: -90.6828, type: "wsr88d" },
    { id: "KEAX", name: "Kansas City / Pleasant Hill", state: "MO", lat: 38.8103, lon: -94.2644, type: "wsr88d" },
    { id: "KSGF", name: "Springfield", state: "MO", lat: 37.2353, lon: -93.4003, type: "wsr88d" },

    // --- GREAT PLAINS & TORNADO ALLEY ---
    { id: "KTLX", name: "Oklahoma City / Norman", state: "OK", lat: 35.3331, lon: -97.2778, type: "wsr88d" },
    { id: "KINX", name: "Tulsa / Inola", state: "OK", lat: 36.1750, lon: -95.5644, type: "wsr88d" },
    { id: "KFDR", name: "Frederick", state: "OK", lat: 34.3622, lon: -98.9764, type: "wsr88d" },
    { id: "KVNX", name: "Vance AFB / Enid", state: "OK", lat: 36.7408, lon: -98.1275, type: "wsr88d" },
    { id: "KICT", name: "Wichita", state: "KS", lat: 37.6547, lon: -97.4431, type: "wsr88d" },
    { id: "KTWX", name: "Topeka", state: "KS", lat: 38.9969, lon: -95.6236, type: "wsr88d" },
    { id: "KDDC", name: "Dodge City", state: "KS", lat: 37.7608, lon: -99.9689, type: "wsr88d" },
    { id: "KGLD", name: "Goodland", state: "KS", lat: 39.3669, lon: -101.7003, type: "wsr88d" },
    { id: "KOAX", name: "Omaha / Valley", state: "NE", lat: 41.3203, lon: -96.3664, type: "wsr88d" },
    { id: "KUEX", name: "Hastings", state: "NE", lat: 40.3208, lon: -98.4419, type: "wsr88d" },
    { id: "KLNX", name: "North Platte", state: "NE", lat: 41.9578, lon: -100.5761, type: "wsr88d" },
    { id: "KFSD", name: "Sioux Falls", state: "SD", lat: 43.5878, lon: -96.7294, type: "wsr88d" },
    { id: "KABR", name: "Aberdeen", state: "SD", lat: 45.4558, lon: -98.4131, type: "wsr88d" },
    { id: "KUDX", name: "Rapid City", state: "SD", lat: 44.1250, lon: -102.8297, type: "wsr88d" },
    { id: "KBIS", name: "Bismarck", state: "ND", lat: 46.7708, lon: -100.7603, type: "wsr88d" },
    { id: "KMVX", name: "Grand Forks / Mayville", state: "ND", lat: 47.5281, lon: -97.3250, type: "wsr88d" },

    // --- TEXAS ---
    { id: "KFWS", name: "Dallas / Fort Worth", state: "TX", lat: 32.5731, lon: -97.3031, type: "wsr88d" },
    { id: "KHGX", name: "Houston / Galveston", state: "TX", lat: 29.4719, lon: -95.0792, type: "wsr88d" },
    { id: "KEWX", name: "Austin / San Antonio", state: "TX", lat: 29.7039, lon: -98.0286, type: "wsr88d" },
    { id: "KCRP", name: "Corpus Christi", state: "TX", lat: 27.7842, lon: -97.5111, type: "wsr88d" },
    { id: "KBRO", name: "Brownsville", state: "TX", lat: 25.9161, lon: -97.4189, type: "wsr88d" },
    { id: "KGRK", name: "Fort Hood / Central TX", state: "TX", lat: 30.7219, lon: -97.3831, type: "wsr88d" },
    { id: "KSJT", name: "San Angelo", state: "TX", lat: 31.3714, lon: -100.4925, type: "wsr88d" },
    { id: "KDFX", name: "Laughlin AFB / Del Rio", state: "TX", lat: 29.2731, lon: -100.2800, type: "wsr88d" },
    { id: "KLBB", name: "Lubbock", state: "TX", lat: 33.6542, lon: -101.8142, type: "wsr88d" },
    { id: "KAMA", name: "Amarillo", state: "TX", lat: 35.2333, lon: -101.7092, type: "wsr88d" },
    { id: "KMAF", name: "Midland / Odessa", state: "TX", lat: 31.9433, lon: -102.1894, type: "wsr88d" },
    { id: "KEPZ", name: "El Paso", state: "TX", lat: 31.8731, lon: -106.6981, type: "wsr88d" },

    // --- ROCKIES & WEST ---
    { id: "KFTG", name: "Denver", state: "CO", lat: 39.7867, lon: -104.5458, type: "wsr88d" },
    { id: "KPUX", name: "Pueblo", state: "CO", lat: 38.4594, lon: -104.1814, type: "wsr88d" },
    { id: "KGJX", name: "Grand Junction", state: "CO", lat: 39.0622, lon: -108.2139, type: "wsr88d" },
    { id: "KCYS", name: "Cheyenne", state: "WY", lat: 41.1519, lon: -104.8061, type: "wsr88d" },
    { id: "KRIW", name: "Riverton", state: "WY", lat: 43.0661, lon: -108.4772, type: "wsr88d" },
    { id: "KABX", name: "Albuquerque", state: "NM", lat: 35.1497, lon: -106.8239, type: "wsr88d" },
    { id: "KFDX", name: "Cannon AFB / Clovis", state: "NM", lat: 34.6339, lon: -103.6189, type: "wsr88d" },
    { id: "KHDX", name: "Holloman AFB", state: "NM", lat: 32.8500, lon: -105.9722, type: "wsr88d" },
    { id: "KFSX", name: "Flagstaff", state: "AZ", lat: 34.5744, lon: -111.1983, type: "wsr88d" },
    { id: "KIWA", name: "Phoenix / Mesa", state: "AZ", lat: 33.2892, lon: -111.6697, type: "wsr88d" },
    { id: "KEMX", name: "Tucson", state: "AZ", lat: 31.8939, lon: -110.6300, type: "wsr88d" },
    { id: "KMTX", name: "Salt Lake City", state: "UT", lat: 41.2628, lon: -112.4475, type: "wsr88d" },
    { id: "KICX", name: "Cedar City", state: "UT", lat: 37.5911, lon: -112.8622, type: "wsr88d" },
    { id: "KESX", name: "Las Vegas", state: "NV", lat: 35.7011, lon: -114.8914, type: "wsr88d" },
    { id: "KRGX", name: "Reno", state: "NV", lat: 39.7542, lon: -119.4622, type: "wsr88d" },
    { id: "KLRX", name: "Elko", state: "NV", lat: 40.7397, lon: -116.8028, type: "wsr88d" },
    { id: "KCBX", name: "Boise", state: "ID", lat: 43.4900, lon: -116.2361, type: "wsr88d" },
    { id: "KSFX", name: "Pocatello / Idaho Falls", state: "ID", lat: 43.1056, lon: -112.6861, type: "wsr88d" },
    { id: "KMSX", name: "Missoula", state: "MT", lat: 47.0411, lon: -113.9861, type: "wsr88d" },
    { id: "KTFX", name: "Great Falls", state: "MT", lat: 47.4597, lon: -111.3853, type: "wsr88d" },
    { id: "KBLX", name: "Billings", state: "MT", lat: 45.8539, lon: -108.6067, type: "wsr88d" },
    { id: "KGGW", name: "Glasgow", state: "MT", lat: 48.2064, lon: -106.6250, type: "wsr88d" },

    // --- PACIFIC COAST ---
    { id: "KOTX", name: "Spokane", state: "WA", lat: 47.6803, lon: -117.6258, type: "wsr88d" },
    { id: "KATX", name: "Seattle / Camano Island", state: "WA", lat: 48.1947, lon: -122.4958, type: "wsr88d" },
    { id: "KLGX", name: "Langley Hill / Coastal WA", state: "WA", lat: 47.1158, lon: -124.1069, type: "wsr88d" },
    { id: "KRTX", name: "Portland", state: "OR", lat: 45.7150, lon: -122.9647, type: "wsr88d" },
    { id: "KPDT", name: "Pendleton", state: "OR", lat: 45.6906, lon: -118.8528, type: "wsr88d" },
    { id: "KMAX", name: "Medford", state: "OR", lat: 42.0811, lon: -122.7172, type: "wsr88d" },
    { id: "KBHX", name: "Eureka", state: "CA", lat: 40.4983, lon: -124.2919, type: "wsr88d" },
    { id: "KBBX", name: "Beale AFB / Marysville", state: "CA", lat: 39.4961, lon: -121.6317, type: "wsr88d" },
    { id: "KDAX", name: "Sacramento", state: "CA", lat: 38.5011, lon: -121.6778, type: "wsr88d" },
    { id: "KMUX", name: "San Francisco / Monterey", state: "CA", lat: 37.1553, lon: -121.8983, type: "wsr88d" },
    { id: "KHNX", name: "San Joaquin Valley / Hanford", state: "CA", lat: 36.3142, lon: -119.6322, type: "wsr88d" },
    { id: "KVBX", name: "Vandenberg AFB / Lompoc", state: "CA", lat: 34.8381, lon: -120.3972, type: "wsr88d" },
    { id: "KVTX", name: "Los Angeles / Oxnard", state: "CA", lat: 34.4117, lon: -119.1794, type: "wsr88d" },
    { id: "KNKX", name: "San Diego", state: "CA", lat: 32.9189, lon: -117.0317, type: "wsr88d" },
    { id: "KEYX", name: "Edwards AFB", state: "CA", lat: 35.0978, lon: -117.5608, type: "wsr88d" }
];

/**
 * 🌟 Convert array of stations to a GeoJSON FeatureCollection
 */
export function getRadarStationsGeoJson() {
    return {
        type: "FeatureCollection",
        features: RADAR_STATIONS.map((st) => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [st.lon, st.lat]
            },
            properties: {
                id: st.id,
                name: st.name,
                state: st.state,
                type: st.type
            }
        }))
    };
}

import dotenv from 'dotenv';
dotenv.config();

interface CoinGeckoResponse {
    solana: {
        usd: number;
    };
}

export async function fetchSolanaPrice(): Promise<number> {
    const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
    const COINGECKO_BASE_URL = process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';

    if (!COINGECKO_API_KEY || !COINGECKO_BASE_URL) {
        throw new Error('Missing required environment variables for CoinGecko API');
    }

    const url = `${COINGECKO_BASE_URL}/simple/price?ids=solana&vs_currencies=usd`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'x-cg-demo-api-key': COINGECKO_API_KEY
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: CoinGeckoResponse = await response.json();

        if (!data?.solana?.usd) {
            throw new Error('Invalid response format from CoinGecko API');
        }

        return data.solana.usd;
    } catch (error) {
        console.error('Error fetching Solana price:', error);
        throw error;
    }
}

// Optional: Cache the price for a short period
let cachedPrice: number | null = null;
let lastFetchTime: number | null = null;
const CACHE_DURATION = 60000; // 1 minute in milliseconds

export async function fetchSolanaPriceWithCache(): Promise<number> {
    const now = Date.now();

    if (cachedPrice && lastFetchTime && (now - lastFetchTime) < CACHE_DURATION) {
        return cachedPrice;
    }

    const price = await fetchSolanaPrice();
    cachedPrice = price;
    lastFetchTime = now;
    return price;
}
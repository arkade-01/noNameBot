import dotenv from 'dotenv'

dotenv.config()

// types.ts
interface CoinGeckoResponse {
    solana: {
        usd: number;
    };
}

// price-fetcher.ts
export async function fetchSolanaPrice(): Promise<number> {
    const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY as string
    const COINGECKO_BASE_URL = process.env.COINGECKO_BASE_URL as string;

    const url = `${COINGECKO_BASE_URL}/simple/price?ids=solana&vs_currencies=usd`;

    const options = {
        method: 'GET',
        headers: {
            'accept': 'application/json',
            'x-cg-demo-api-key': COINGECKO_API_KEY || ''
        }
    };

    try {
        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: CoinGeckoResponse = await response.json();
        return data.solana.usd;
    } catch (error) {
        console.error('Error fetching Solana price:', error);
        throw error;
    }
}
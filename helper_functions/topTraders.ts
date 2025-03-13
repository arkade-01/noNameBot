import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

interface SimplifiedTrader {
  owner: string;
  volumeBuy: number;
  volumeSell: number;
}

interface ApiResponse {
  success: boolean;
  data: {
    items: TraderItem[];
  };
}

interface TraderItem {
  tokenAddress: string;
  owner: string;
  tags: string[];
  type: string;
  trade: number;
  tradeBuy: number;
  tradeSell: number;
  volume: number;
  volumeBuy: number;
  volumeSell: number;
}


export const getTopTraders = async (tokenAddy: string): Promise<SimplifiedTrader[]> => {
  const birdeye_key = process.env.BIRDEYE_KEY as string;

  try {
    const options = {
      method: 'GET',
      url: 'https://public-api.birdeye.so/defi/v2/tokens/top_traders',
      params: {
        address: tokenAddy,
        time_frame: '24h',
        sort_type: 'desc',
        sort_by: 'trade',
        offset: 0,
        limit: 3
      },
      headers: {
        accept: 'application/json',
        'x-chain': 'solana',
        'X-API-KEY': birdeye_key
      }
    };

    const response = await axios.request<ApiResponse>(options);

    // Extract just the data we need: wallet address, buy volume, and sell volume
    const simplifiedTraders: SimplifiedTrader[] = response.data.data.items.map((item: TraderItem) => ({
      owner: item.owner,
      volumeBuy: item.volumeBuy,
      volumeSell: item.volumeSell
    }));

    return simplifiedTraders;
  } catch (error) {
    console.error('Error fetching top traders:', error);
    throw error;
  }
};;
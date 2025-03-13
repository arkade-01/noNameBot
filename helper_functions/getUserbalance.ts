import { PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "../utils/rpcConfig";
import axios from "axios";
import dotenv from "dotenv"

dotenv.config()


async function getBalance(walletAddress: string) {
    const connection = getSolanaConnection()
    const publicKey = new PublicKey(walletAddress)


    const balanceLamports = await connection.getBalance(publicKey)
    const userBalance = balanceLamports / 1e9
    console.log(userBalance)
    return userBalance
    
}
/**
 * Gets the balance of a specific token for a wallet using BirdEye API
 * @param walletAddress The Solana wallet address
 * @param tokenAddress The token mint address
 * @returns Object containing token details including balance
 */
export const getTokenBalance = async (walletAddress: string, tokenAddress: string) => {
    const birdeye_key = process.env.BIRDEYE_KEY as string;

    if (!birdeye_key) {
        throw new Error("BIRDEYE_KEY not found in environment variables");
    }

    try {
        const options = {
            method: 'GET',
            url: 'https://public-api.birdeye.so/v1/wallet/token_balance',
            params: {
                wallet: walletAddress,
                token_address: tokenAddress
            },
            headers: {
                accept: 'application/json',
                'x-chain': 'solana',
                'X-API-KEY': birdeye_key
            }
        };

        const response = await axios.request(options);

        // Return the relevant data
        return {
            success: response.data.success,
            tokenData: response.data.data
        };
    } catch (error) {
        console.error("Error getting token balance:", error);
        throw error;
    }
};

/**
 * A simplified function that just returns the UI amount directly
 * @param walletAddress The Solana wallet address
 * @param tokenAddress The token mint address
 * @returns The token balance in UI units (human-readable amount)
 */
export const getTokenUIAmount = async (walletAddress: string, tokenAddress: string): Promise<number | null> => {
    try {
        const result = await getTokenBalance(walletAddress, tokenAddress);
        if (result.success && result.tokenData) {
            return result.tokenData.uiAmount;
        }
        return null;
    } catch (error) {
        console.error("Error getting token UI amount:", error);
        return null;
    }
};

export default getBalance
// getTokenBalance('8R8eZLAvB5A9QyByszPZ7bVJsBkdAPU1CYmpAHrdBG97', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263')
import { Connection, clusterApiUrl } from "@solana/web3.js";
import dotenv from 'dotenv'

dotenv.config()

let connection: Connection | null = null;
const api_url = process.env.RPC_URL as string



export const getSolanaConnection = (): Connection => {
    if (!connection) {
        connection = new Connection(api_url, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000})
    }
    return connection;
};
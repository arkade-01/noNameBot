import { Connection, clusterApiUrl } from "@solana/web3.js";

let connection: Connection | null = null;

export const getSolanaConnection = (): Connection => {
    if (!connection) {
        connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed')
    }
    return connection;
};
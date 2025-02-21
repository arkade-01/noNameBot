import { getMint } from "@solana/spl-token";
import { getSolanaConnection } from "../utils/rpcConfig";
import { PublicKey } from "@solana/web3.js";


const getTokenDecimals = async (tokenAddress: string): Promise<number> => {
    try {
        const connection = getSolanaConnection();
        const mintAddress = new PublicKey(tokenAddress);
        const mintInfo = await getMint(connection, mintAddress);
        return mintInfo.decimals;
    } catch (error) {
        console.error("Error fetching token decimals:", error);
        return 6; // fallback to 6 decimals if there's an error
    }
};

// tokenMetadata('FNG49cwtxSWCSd23GEi1uVoZ9qWmZxFSfR1FvRxz9XBz')
export default getTokenDecimals
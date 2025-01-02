import { getMint } from "@solana/spl-token";
import { getSolanaConnection } from "../utils/rpcConfig";
import { PublicKey } from "@solana/web3.js";


const tokenMetadata = async (tokenAddress) => {
    const mintAddress = new PublicKey(tokenAddress)
}
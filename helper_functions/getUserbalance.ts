import { PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "../utils/rpcConfig";

async function getBalance(walletAddress: string) {
    const connection = getSolanaConnection()
    const publicKey = new PublicKey(walletAddress)


    const balanceLamports = await connection.getBalance(publicKey)
    const userBalance = balanceLamports / 1e9
    console.log(userBalance)
    return userBalance
    
}

export default getBalance
// getBalance('8R8eZLAvB5A9QyByszPZ7bVJsBkdAPU1CYmpAHrdBG97')
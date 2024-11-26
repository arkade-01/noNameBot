import { Keypair } from "@solana/web3.js";

export default async function createNewSolanaWallet(telegramId: string) {
    const solanaWallet = Keypair.generate();
    const newWallet = {
        telegram_id: telegramId,
        address: solanaWallet.publicKey.toString(),
        private_key: Buffer.from(solanaWallet.secretKey).toString('hex'),
    }

    console.log(`New Solana wallet created for Telegram ID ${telegramId}:`, newWallet.address);
    return newWallet
}


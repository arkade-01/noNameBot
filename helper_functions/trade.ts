import { createJupiterApiClient, QuoteGetRequest, QuoteResponse } from "@jup-ag/api";
import { getSolanaConnection } from "../utils/rpcConfig";
import { Wallet } from "@project-serum/anchor";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";
import { getSignature } from "../utils/getSignature";
import { transactionSenderAndConfirmationWaiter } from "../utils/transactionSender";

const connection = getSolanaConnection();
const jupiterQuoteApi = createJupiterApiClient();
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapResult {
    success: boolean;
    signature?: string;
    error?: string;
    txUrl?: string;
}

export async function getQuote(tokenCA: string, isSolInput: boolean, amount: number): Promise<QuoteResponse> {
    const params: QuoteGetRequest = {
        inputMint: isSolInput ? SOL_MINT : tokenCA,
        outputMint: isSolInput ? tokenCA : SOL_MINT,
        amount: amount,
    };

    const quote = await jupiterQuoteApi.quoteGet(params);
    if (!quote) {
        throw new Error("Unable to get Quote");
    }
    return quote;
}

async function getSwapObj(wallet: Wallet, quote: QuoteResponse) {
    return await jupiterQuoteApi.swapPost({
        swapRequest: {
            quoteResponse: quote,
            userPublicKey: wallet.publicKey.toBase58(),
            dynamicComputeUnitLimit: true,
            dynamicSlippage: {
                maxBps: 300,
            },
            prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                    maxLamports: 5000000,
                    priorityLevel: "High"
                }
            }
        }
    });
}

export async function executeSwap(
    tokenCA: string,
    isSolInput: boolean,
    amount: number,
    privateKey: string
): Promise<SwapResult> {
    try {
        const wallet = new Wallet(
            Keypair.fromSecretKey(bs58.decode(privateKey))
        );

        const quote = await getQuote(tokenCA, isSolInput, amount);
        const swapObj = await getSwapObj(wallet, quote);

        const swapTransactionBuf = Buffer.from(swapObj.swapTransaction, "base64");
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

        transaction.sign([wallet.payer]);
        const signature = getSignature(transaction);

        const { value: simulatedTransactionResponse } =
            await connection.simulateTransaction(transaction, {
                replaceRecentBlockhash: true,
                commitment: "processed"
            });

        if (simulatedTransactionResponse.err) {
            return {
                success: false,
                error: `Simulation Error: ${JSON.stringify(simulatedTransactionResponse.err)}`,
                signature
            };
        }

        const serializedTransaction = Buffer.from(transaction.serialize());
        const blockhash = transaction.message.recentBlockhash;

        const transactionResponse = await transactionSenderAndConfirmationWaiter({
            connection,
            serializedTransaction,
            blockhashWithExpiryBlockHeight: {
                blockhash,
                lastValidBlockHeight: swapObj.lastValidBlockHeight
            }
        });

        if (!transactionResponse) {
            return {
                success: false,
                error: 'Transaction not confirmed',
                signature
            };
        }

        if (transactionResponse.meta?.err) {
            return {
                success: false,
                error: String(transactionResponse.meta.err),
                signature
            };
        }

        return {
            success: true,
            signature,
            txUrl: `https://solscan.io/tx/${signature}`
        };

    } catch (error: any) {
        return {
            success: false,
            error: error.message
        };
    }
}

export async function getQuoteInfo(
    tokenCA: string,
    isSolInput: boolean,
    amount: number
): Promise<QuoteResponse> {
    try {
        return await getQuote(tokenCA, isSolInput, amount);
    } catch (error: any) {
        throw new Error(`Failed to get quote: ${error.message}`);
    }
}
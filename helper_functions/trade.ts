import { createJupiterApiClient, QuoteGetRequest, QuoteResponse } from "@jup-ag/api";
import { getSolanaConnection } from "../utils/rpcConfig";
import { Wallet } from "@project-serum/anchor";
import {
    Keypair,
    PublicKey,
    VersionedTransaction,
    TransactionMessage,
    TransactionInstruction,
    AddressLookupTableAccount,
    Commitment
} from "@solana/web3.js";

const connection = getSolanaConnection();
const jupiterQuoteApi = createJupiterApiClient();
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const refADdy = 'D7qfnksBhCtVDLH7kS4JLiNHP5EwM3yfLBwWSW3z2sNc';

export interface SwapResult {
    success: boolean;
    signature?: string;
    error?: string;
    txUrl?: string;
    errorDetails?: unknown;
}

interface SwapError extends Error {
    code?: string;
}


export async function getQuote(tokenCA: string, isSolInput: boolean, amount: number): Promise<QuoteResponse> {
    const params: QuoteGetRequest = {
        inputMint: isSolInput ? SOL_MINT : tokenCA,
        outputMint: isSolInput ? tokenCA : SOL_MINT,
        amount: amount,
        slippageBps: 1500,
        asLegacyTransaction: false,
    };

    const quote = await jupiterQuoteApi.quoteGet(params);
    if (!quote) {
        throw new Error("No valid quote found for swap");
    }

    return quote;
}


export async function executeSwap(
    tokenCA: string,
    isSolInput: boolean,
    amount: number,
    privateKey: string
): Promise<SwapResult> {
    try {
        if (!tokenCA || !privateKey || amount <= 0) {
            throw new Error("Invalid input parameters");
        }

        // Create wallet
        const keyArray = new Uint8Array(
            privateKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
        );
        const wallet = new Wallet(Keypair.fromSecretKey(keyArray));

        // Get quote first
        const quote = await getQuote(tokenCA, isSolInput, amount);

        // Add logging to check account setup
        console.log("Quote details:", {
            inputMint: quote.inputMint,
            outputMint: quote.outputMint,
            userPublicKey: wallet.publicKey.toBase58()
        });

        // Get swap instructions using Jupiter V6 API
        const swapInstructionsResponse = await fetch("https://quote-api.jup.ag/v6/swap-instructions", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                quoteResponse: quote,
                userPublicKey: wallet.publicKey.toBase58(),
                wrapUnwrapSOL: true,
                prioritizationFeeLamports: 5000000,
                asLegacyTransaction: false,
            })
        });

        const swapInstructions = await swapInstructionsResponse.json();

        if (swapInstructions.error) {
            throw new Error(`Failed to get swap instructions: ${swapInstructions.error}`);
        }

        // Log the instruction counts for debugging
        console.log("Instruction counts:", {
            computeBudget: swapInstructions.computeBudgetInstructions?.length || 0,
            setup: swapInstructions.setupInstructions?.length || 0,
            cleanup: swapInstructions.cleanupInstruction ? 1 : 0
        });

        const {
            computeBudgetInstructions,
            setupInstructions,
            swapInstruction: swapInstructionPayload,
            cleanupInstruction,
            addressLookupTableAddresses,
        } = swapInstructions;

        // Deserialize instruction helper function
        const deserializeInstruction = (instruction: any): TransactionInstruction => {
            const deserializedInstruction = new TransactionInstruction({
                programId: new PublicKey(instruction.programId),
                keys: instruction.accounts.map((key: any) => ({
                    pubkey: new PublicKey(key.pubkey),
                    isSigner: key.isSigner,
                    isWritable: key.isWritable,
                })),
                data: Buffer.from(instruction.data, 'base64'),
            });

            // Log instruction details for debugging
            console.log("Deserialized instruction:", {
                programId: instruction.programId,
                accountsCount: instruction.accounts.length
            });

            return deserializedInstruction;
        };

        // Get address lookup table accounts
        const getAddressLookupTableAccounts = async (keys: string[]) => {
            const addressLookupTableAccountInfos = await connection.getMultipleAccountsInfo(
                keys.map((key) => new PublicKey(key))
            );

            return addressLookupTableAccountInfos.reduce((acc, accountInfo, index) => {
                const addressLookupTableAddress = keys[index];
                if (accountInfo) {
                    const addressLookupTableAccount = new AddressLookupTableAccount({
                        key: new PublicKey(addressLookupTableAddress),
                        state: AddressLookupTableAccount.deserialize(accountInfo.data),
                    });
                    acc.push(addressLookupTableAccount);
                }
                return acc;
            }, [] as AddressLookupTableAccount[]);
        };

        // Get lookup table accounts
        const addressLookupTableAccounts = await getAddressLookupTableAccounts(
            addressLookupTableAddresses
        );

        // Get latest blockhash
        const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

        // Create instructions array with proper order
        const instructions: TransactionInstruction[] = [];

        // Add compute budget instructions first
        if (computeBudgetInstructions?.length) {
            instructions.push(...computeBudgetInstructions.map(deserializeInstruction));
        }

        // Add setup instructions
        if (setupInstructions?.length) {
            instructions.push(...setupInstructions.map(deserializeInstruction));
        }

        // Add main swap instruction
        instructions.push(deserializeInstruction(swapInstructionPayload));

        // Add cleanup instruction if present
        if (cleanupInstruction) {
            instructions.push(deserializeInstruction(cleanupInstruction));
        }

        // Create transaction message
        const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message(addressLookupTableAccounts);

        // Create versioned transaction
        const transaction = new VersionedTransaction(messageV0);

        // Sign transaction
        transaction.sign([wallet.payer]);

        // Send transaction with preflight checks disabled
        const rawTransaction = transaction.serialize();
        const signature = await connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            preflightCommitment: 'confirmed',
            maxRetries: 5,
        });

        // Confirm transaction
        const latestBlockHash = await connection.getLatestBlockhash('confirmed' as Commitment);
        await connection.confirmTransaction({
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: signature,
        }, 'confirmed');

        return {
            success: true,
            signature,
            txUrl: `https://solscan.io/tx/${signature}`
        };

    } catch (error: unknown) {
        const err = error as SwapError;
        console.error("Swap execution error:", {
            message: err.message,
            code: err.code,
            stack: err.stack
        });

        return {
            success: false,
            error: `${err.code || 'UNKNOWN'}: ${err.message || 'Unknown error occurred'}`,
            errorDetails: err
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
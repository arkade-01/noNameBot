import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * The fixed fee amount in lamports (0.007925 SOL = 7,925,000 lamports)
 */
export const FIXED_FEE_LAMPORTS = 7925000;

/**
 * Create a fee transfer instruction.
 * @param payer The public key of the payer (wallet).
 * @param feeRecipient The public key of the fee recipient.
 * @returns A TransactionInstruction to transfer the fee.
 */
export function createFeeTransferInstruction(
    payer: PublicKey,
    feeRecipient: PublicKey
): TransactionInstruction {
    return SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: feeRecipient,
        lamports: FIXED_FEE_LAMPORTS,
    });
}
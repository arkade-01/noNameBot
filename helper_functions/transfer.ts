import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * Calculate the hybrid fee: a percentage of the amount or a minimum fixed amount.
 * 
 * @param amountInLamports The swap amount in lamports (1 SOL = 1,000,000,000 lamports).
 * @param percentageFee The fee percentage (default is 0.5%, represented as 0.005).
 * @param minimumFeeSol The minimum fee in lamports (default is 0.002 SOL = 2,000,000 lamports).
 * @returns The fee amount in lamports.
 * @throws Error if the amount is not a positive number.
 */
export function calculateHybridFee(
    amountInLamports: number,
    percentageFee: number = 0.005,     // Default to 0.5%
    minimumFeeSol: number = 5000000    // Default to 0.002 SOL in lamports
): number {
    // Type and value checks
    if (isNaN(amountInLamports) || amountInLamports <= 0) {
        throw new Error("Invalid swap amount: must be a positive number.");
    }

    if (isNaN(percentageFee) || percentageFee < 0) {
        throw new Error("Invalid percentage fee: must be a non-negative number.");
    }

    if (isNaN(minimumFeeSol) || minimumFeeSol < 0) {
        throw new Error("Invalid minimum fee: must be a non-negative number.");
    }

    // Calculate the percentage-based fee
    const percentageBasedFee = Math.floor(amountInLamports * percentageFee);

    // Return the greater of the percentage-based fee or the minimum fee
    return Math.max(percentageBasedFee, minimumFeeSol);
}


/**
 * Create a fee transfer instruction.
 * @param payer The public key of the payer (wallet).
 * @param feeAmount The fee amount in lamports.
 * @param feeRecipient The public key of the fee recipient (defaults to FEE_WALLET).
 * @returns A TransactionInstruction to transfer the fee.
 */
export function createFeeTransferInstruction(
    payer: PublicKey,
    feeAmount: number,
    feeRecipient: PublicKey
): TransactionInstruction {
    return SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: feeRecipient,
        lamports: feeAmount,
    });
}
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";

export const isValidSolanaPrivateKey = (key: string): boolean => {
    try {
        bs58.decode(key);
        return true;
    } catch {
        return false;
    }
};
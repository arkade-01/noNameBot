

// Add this helper function:
function hexToUint8Array(hexString: string): Uint8Array {
    // If the string is base64, first convert it to hex
    try {
        const base64Decoded = Buffer.from(hexString, 'base64');
        return new Uint8Array(base64Decoded);
    } catch {
        // If base64 decode fails, proceed with hex processing
        const cleanHex = hexString.replace('0x', '');
        const paddedHex = cleanHex.length % 2 === 0 ? cleanHex : '0' + cleanHex;

        const bytes = new Uint8Array(paddedHex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(paddedHex.substr(i * 2, 2), 16);
        }

        return bytes;
    }
}

export default hexToUint8Array;
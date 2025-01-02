const web3 = require('@solana/web3.js');
const splToken = require('@solana/spl-token');
const { Metadata, deprecated } = require('@metaplex-foundation/mpl-token-metadata');

async function main() {
    const connection = new web3.Connection(web3.clusterApiUrl('mainnet-beta'));

    // This is the USDC token mint address
    const mintAddress = new web3.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    try {
        const mintInfo = await splToken.getMint(connection, mintAddress);
        console.log("Decimals: " + mintInfo.decimals);
        console.log("Supply: " + mintInfo.supply);

    } catch (err) {
        console.error("Error: ", err);
    }
}

main();
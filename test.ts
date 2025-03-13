import { BirdEyeClient, WalletTracker, TokenInfo } from "./helper_functions/trackWallet";
import dotenv from "dotenv"

dotenv.config()

// Example test script to display detailed transaction information
async function testDetailedTransactionDisplay() {
    const apiKey =  process.env.BIRDEYE_KEY as string; // Your API key
    const walletAddress = '4XY7pDHCwqzFeFb7R2ViWqvP6EH8b2omoNhmmp5rMdrH'; // The wallet to track

    console.log(`Fetching transactions for wallet ${walletAddress}...`);

    try {
        // 1. First approach: Use the BirdEyeClient directly to get raw transactions
        const client = new BirdEyeClient(apiKey);
        const result = await client.getWalletTransactions(walletAddress);

        console.log(`Successfully retrieved ${result.data.solana.length} transactions`);

        // Display details for the most recent 5 transactions
        console.log("\n===== RECENT TRANSACTIONS =====");
        const recentTxs = result.data.solana.slice(0, 5);

        for (let i = 0; i < recentTxs.length; i++) {
            const tx = recentTxs[i];
            console.log(`\nTransaction #${i + 1}: ${tx.txHash}`);
            console.log(`  Time: ${tx.blockTime}`);
            console.log(`  Action: ${tx.mainAction}`);
            console.log(`  From: ${tx.from}`);
            console.log(`  To: ${tx.to}`);

            if (tx.balanceChange && tx.balanceChange.length > 0) {
                console.log("  Token Changes:");
                tx.balanceChange.forEach(change => {
                    if (!change.amount) return;

                    const formattedAmount = (change.amount / Math.pow(10, change.decimals || 0)).toLocaleString();
                    const direction = change.amount > 0 ? "IN" : "OUT";
                    console.log(`    ${direction}: ${formattedAmount} ${change.symbol || 'Unknown'} (${change.address})`);
                });
            } else {
                console.log("  No token changes in this transaction");
            }
        }

        // 2. Second approach: Use the WalletTracker to detect tokens bought
        console.log("\n\n===== TRACKING TOKEN PURCHASES =====");

        const tracker = new WalletTracker(walletAddress, apiKey);

        // Set up event handlers before starting
        tracker.on('token:purchased', (token: TokenInfo) => {
            const formattedAmount = (token.amount / Math.pow(10, token.decimals)).toLocaleString();
            console.log(`🔔 Detected purchase: ${formattedAmount} ${token.symbol} (${token.address})`);
            console.log(`   Time: ${token.purchaseTime}`);
            console.log(`   Transaction: ${token.txHash.substring(0, 16)}...`);
        });

        tracker.on('purchases:detected', (info) => {
            console.log(`Found ${info.count} token purchases in total`);
        });

        tracker.on('error', (error) => {
            console.error(`Error: ${error.message}`);
        });

        // Start tracking (this will do one immediate check)
        tracker.startTracking();

        // Wait for 5 seconds to allow events to fire, then stop tracking
        await new Promise(resolve => setTimeout(resolve, 5000));
        tracker.stopTracking();

    } catch (error) {
        console.error('Error in test script:', error);
    }
}

// Run the test
testDetailedTransactionDisplay().catch(err => {
    console.error("Test failed:", err);
});
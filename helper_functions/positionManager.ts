import User, { ITrade, IUser, IPosition } from '../models/schema';
import { QuoteResponse } from "@jup-ag/api";
import scanToken from './tokenScanner';
import { fetchSolanaPrice } from './fetchSolprice';
import { getTokenUIAmount } from './getUserbalance'; // Function to fetch token balance

// Helper function to calculate price from Jupiter quote
async function calculatePriceFromScan(tokenAddress: string): Promise<number> {
    const getPrice = await scanToken(tokenAddress);
    return Number(getPrice?.tokenInfo.price || 0);
}

export async function updatePositionsPnL(telegram_id: string, forceUpdate: boolean = false): Promise<IPosition[]> {
    try {
        // First get the positions
        let positions = await getUserPositions(telegram_id);
        const solPrice = await fetchSolanaPrice();

        // Update all positions with new prices
        for (const position of positions) {
            const tokenData = await scanToken(position.tokenAddress);

            // Get actual token balance instead of relying on recorded trades
            const walletAddress = await getUserWalletAddress(telegram_id);
            const actualTokenBalance = await getTokenUIAmount(walletAddress, position.tokenAddress);

            if (tokenData) {
                position.currentPrice = Number(tokenData.tokenInfo.price || 0);
                position.currentMarketCap = Math.round(tokenData.tokenInfo.mktCap || 0);
                position.lastPriceUpdate = new Date();

                // Update token amount based on actual balance if available
                if (actualTokenBalance !== null && actualTokenBalance > 0) {
                    position.totalTokens = actualTokenBalance;
                }

                // Recalculate PnL
                const solValueAtCurrentPrice = position.totalTokens * position.currentPrice;
                position.solPnL = solValueAtCurrentPrice - position.totalSolSpent;
                position.usdPnL = position.solPnL * solPrice;

                // Calculate USD values
                if (position.totalUsdSpent === undefined) {
                    position.totalUsdSpent = position.totalSolSpent * solPrice;
                }

                position.currentUsdValue = solValueAtCurrentPrice * solPrice;
            }
        }

        // Save updated positions
        const user = await User.findOne({ telegram_id });
        if (user) {
            user.positions = positions;
            await user.save();
        }

        return positions;
    } catch (error) {
        console.error('Error updating positions PnL:', error);
        throw error;
    }
}

// Helper function to get user's wallet address
async function getUserWalletAddress(telegram_id: string): Promise<string> {
    const user = await User.findOne({ telegram_id });
    if (!user || !user.walletAddress) {
        throw new Error('User wallet address not found');
    }
    return user.walletAddress;
}

export async function addTradeToUser(
    telegram_id: string,
    tokenData: {
        address: string;
        tokenName: string;
        tokenSymbol: string;
        tokenInfo: {
            mktCap: number;
            price: number;
        }
    },
    quote: QuoteResponse,
    solAmount: number
): Promise<ITrade> {
    try {
        const user = await User.findOne({ telegram_id });
        if (!user) {
            throw new Error('User not found');
        }

        const price = await calculatePriceFromScan(tokenData.address);
        const solPrice = await fetchSolanaPrice();

        // Get actual token balance after trade
        const walletAddress = await getUserWalletAddress(telegram_id);
        const fetchedTokenAmount = await getTokenUIAmount(walletAddress, tokenData.address);

        // Make sure tokenAmount is a number (not null)
        const tokenAmount = fetchedTokenAmount !== null ? fetchedTokenAmount : 0;

        const trade: ITrade = {
            tokenAddress: tokenData.address,
            tokenName: tokenData.tokenName,
            tokenSymbol: tokenData.tokenSymbol,
            buyPrice: tokenData.tokenInfo.price,
            tokenAmount: tokenAmount, // Use actual balance from wallet, with null safety
            solSpent: solAmount,
            usdSpent: solAmount * solPrice, // Add USD value of SOL spent
            currentPrice: price,
            solPnL: 0,
            usdPnL: 0,
            entryMarketCap: Math.round(tokenData.tokenInfo?.mktCap || 0),
            timestamp: new Date()
        };

        await user.addTrade(trade);
        return trade;
    } catch (error) {
        console.error('Error adding trade:', error);
        throw error;
    }
}

export async function getUserPositions(telegram_id: string): Promise<IPosition[]> {
    try {
        const user = await User.findOne({ telegram_id });
        if (!user) {
            throw new Error('User not found');
        }

        // First try to use the getPositions method if available
        if (typeof user.getPositions === 'function') {
            const positions = await user.getPositions();

            // Update with latest balances
            const walletAddress = await getUserWalletAddress(telegram_id);
            const solPrice = await fetchSolanaPrice();

            for (const position of positions) {
                try {
                    const actualBalance = await getTokenUIAmount(walletAddress, position.tokenAddress);
                    if (actualBalance !== null && actualBalance > 0) {
                        position.totalTokens = actualBalance;
                    }

                    // Ensure USD fields are initialized
                    if (position.totalUsdSpent === undefined) {
                        position.totalUsdSpent = position.totalSolSpent * solPrice;
                    }

                    position.currentUsdValue = position.totalTokens * position.currentPrice * solPrice;
                } catch (error) {
                    console.error(`Error fetching balance for token ${position.tokenSymbol}:`, error);
                }
            }

            return positions;
        }

        // Fall back to manual calculation if getPositions is not available
        return user.positions || [];
    } catch (error) {
        console.error('Error getting user positions:', error);
        throw error;
    }
}

export async function refreshUserPositions(telegram_id: string): Promise<IPosition[]> {
    return updatePositionsPnL(telegram_id, true);
}

export async function getPortfolioSummary(telegram_id: string) {
    try {
        const positions = await updatePositionsPnL(telegram_id);
        const solPrice = await fetchSolanaPrice();

        return positions.reduce((summary, position) => ({
            totalSolSpent: summary.totalSolSpent + position.totalSolSpent,
            totalUsdSpent: summary.totalUsdSpent + (position.totalUsdSpent || position.totalSolSpent * solPrice),
            totalSolPnL: summary.totalSolPnL + position.solPnL,
            totalUsdPnL: summary.totalUsdPnL + position.usdPnL,
            currentUsdValue: summary.currentUsdValue + (position.currentUsdValue || 0),
            solPriceUsd: solPrice,
            numberOfPositions: summary.numberOfPositions + 1
        }), {
            totalSolSpent: 0,
            totalUsdSpent: 0,
            totalSolPnL: 0,
            totalUsdPnL: 0,
            currentUsdValue: 0,
            solPriceUsd: solPrice,
            numberOfPositions: 0
        });
    } catch (error) {
        console.error('Error getting portfolio summary:', error);
        throw error;
    }
}
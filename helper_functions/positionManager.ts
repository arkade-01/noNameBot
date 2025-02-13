import User, { ITrade, IUser, IPosition } from '../models/schema';  // Import all interfaces from schema
import { QuoteResponse } from "@jup-ag/api";
import scanToken from './tokenScanner';
import { fetchSolanaPrice } from './fetchSolprice';

// export interface IPosition {
//     tokenAddress: string;
//     tokenName: string;
//     tokenSymbol: string;
//     totalTokens: number;
//     totalSolSpent: number;
//     trades: ITrade[];
//     averageBuyPrice: number;
//     currentPrice: number;
//     solPnL: number;
//     usdPnL: number;
//     entryMarketCap: number; // Add this field
//     currentMarketCap: number;
// }

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
            if (tokenData) {
                position.currentPrice = Number(tokenData.tokenInfo.price || 0);
                position.currentMarketCap = Math.round(tokenData.tokenInfo.mktCap || 0);
                position.lastPriceUpdate = new Date();

                // Recalculate PnL
                const solValueAtCurrentPrice = position.totalTokens * position.currentPrice;
                position.solPnL = solValueAtCurrentPrice - position.totalSolSpent;
                position.usdPnL = position.solPnL * solPrice;
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
        const tokenAmount = Number(quote.outAmount); // Convert to proper decimal places

        const trade: ITrade = {
            tokenAddress: tokenData.address,
            tokenName: tokenData.tokenName,
            tokenSymbol: tokenData.tokenSymbol,
            buyPrice: tokenData.tokenInfo.price,
            tokenAmount: tokenAmount,
            solSpent: solAmount,
            currentPrice: price,
            solPnL: 0,
            usdPnL: 0,
            entryMarketCap: Math.round(tokenData.tokenInfo?.mktCap || 0), // Add entry market cap
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

        // Always calculate positions from trades
        const positions = new Map<string, IPosition>();

        user.trades.forEach((trade: ITrade) => {
            const key = trade.tokenAddress;
            const current = positions.get(key) || {
                tokenAddress: trade.tokenAddress,
                tokenName: trade.tokenName,
                tokenSymbol: trade.tokenSymbol,
                totalTokens: 0,
                totalSolSpent: 0,
                trades: [] as ITrade[],
                averageBuyPrice: 0,
                currentPrice: trade.currentPrice,
                solPnL: 0,
                usdPnL: 0,
                entryMarketCap: trade.entryMarketCap,
                currentMarketCap: 0,
                lastPriceUpdate: new Date()
            };

            current.totalTokens += trade.tokenAmount;
            current.totalSolSpent += trade.solSpent;
            current.trades.push(trade);
            
            // Recalculate average buy price if we have tokens
            if (current.totalTokens > 0) {
                current.averageBuyPrice = current.totalSolSpent / current.totalTokens;
            }
            
            // Update current price and market cap
            current.currentPrice = trade.currentPrice;
            if (trade.entryMarketCap > 0) {
                current.currentMarketCap = trade.entryMarketCap;
            }

            positions.set(key, current);
        });

        const calculatedPositions = Array.from(positions.values());
        
        // Update user's positions in database
        user.positions = calculatedPositions;
        await user.save();

        return calculatedPositions;
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

        return positions.reduce((summary, position) => ({
            totalSolSpent: summary.totalSolSpent + position.totalSolSpent,
            totalSolPnL: summary.totalSolPnL + position.solPnL,
            totalUsdPnL: summary.totalUsdPnL + position.usdPnL,
            numberOfPositions: summary.numberOfPositions + 1
        }), {
            totalSolSpent: 0,
            totalSolPnL: 0,
            totalUsdPnL: 0,
            numberOfPositions: 0
        });
    } catch (error) {
        console.error('Error getting portfolio summary:', error);
        throw error;
    }
}
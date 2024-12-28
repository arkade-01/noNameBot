import User, { ITrade, IUser } from '../models/schema';
import { QuoteResponse } from "@jup-ag/api";
import scanToken from './tokenScanner';
import { fetchSolanaPrice } from './fetchSolprice';

export interface IPosition {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    totalTokens: number;
    totalSolSpent: number;
    trades: ITrade[];
    averageBuyPrice: number;
    currentPrice: number;
    solPnL: number;
    usdPnL: number;
    entryMarketCap: number; // Add this field
    currentMarketCap: number;
}

// Helper function to calculate price from Jupiter quote
async function calculatePriceFromScan(tokenAddress: string): Promise<number> {
    const getPrice = await scanToken(tokenAddress);
    return Number(getPrice?.tokenInfo.price || 0);
}


export async function updatePositionsPnL(telegram_id: string): Promise<IPosition[]> {
    try {
        const positions = await getUserPositions(telegram_id);

        for (const position of positions) {
            // Get current token data including market cap
            const tokenData = await scanToken(position.tokenAddress);
            const currentPrice = Number(tokenData?.tokenInfo.price || 0);

            position.currentPrice = currentPrice;
            position.currentMarketCap = Math.round(tokenData?.tokenInfo.mktCap || 0);

            // Calculate PnL
            const solValueAtCurrentPrice = position.totalTokens * Number(currentPrice);
            position.solPnL = solValueAtCurrentPrice - position.totalSolSpent;

            // TODO: Replace with actual SOL price from your price feed
            const solPrice = await fetchSolanaPrice(); // Example SOL price in USD
            position.usdPnL = position.solPnL * solPrice;
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

        const positions = new Map<string, IPosition>();

        user.trades.forEach((trade: ITrade) => {
            const key = trade.tokenAddress;
            const current = positions.get(key) || {
                tokenAddress: trade.tokenAddress,
                tokenName: trade.tokenName,
                tokenSymbol: trade.tokenSymbol,
                totalTokens: 0,
                totalSolSpent: 0,
                trades: [],
                averageBuyPrice: 0,
                currentPrice: trade.currentPrice,
                solPnL: 0,
                usdPnL: 0,
                entryMarketCap: trade.entryMarketCap, 
                currentMarketCap: 0 
            };

            current.totalTokens += trade.tokenAmount;
            current.totalSolSpent += trade.solSpent;
            current.trades.push(trade);
            current.averageBuyPrice = current.totalSolSpent / current.totalTokens;
            current.currentPrice = trade.currentPrice;

            positions.set(key, current);
        });

        return Array.from(positions.values());
    } catch (error) {
        console.error('Error getting user positions:', error);
        throw error;
    }
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
import User, { ITrade, IUser } from '../models/schema';
import { getQuote } from '../helper_functions/trade';
import { QuoteResponse } from "@jup-ag/api";

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
}

// Helper function to calculate price from Jupiter quote
function calculatePriceFromQuote(quote: QuoteResponse): number {
    // Convert amounts from string to numbers and handle decimals
    const inAmount = Number(quote.inAmount) / 1e9;  // SOL decimals
    const outAmount = Number(quote.outAmount) / 1e9; // Assuming token decimals = 9
    return inAmount / outAmount;
}

export async function updatePositionsPnL(telegram_id: string): Promise<IPosition[]> {
    try {
        const positions = await getUserPositions(telegram_id);

        for (const position of positions) {
            // Get current price quote for 1 SOL worth of tokens
            const currentQuote = await getQuote(position.tokenAddress, true, 1e9);
            const currentPrice = calculatePriceFromQuote(currentQuote);

            position.currentPrice = currentPrice;

            // Calculate PnL
            const solValueAtCurrentPrice = position.totalTokens * currentPrice;
            position.solPnL = solValueAtCurrentPrice - position.totalSolSpent;

            // TODO: Replace with actual SOL price from your price feed
            const solPrice = 60; // Example SOL price in USD
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
    },
    quote: QuoteResponse,
    solAmount: number
): Promise<ITrade> {
    try {
        const user = await User.findOne({ telegram_id });
        if (!user) {
            throw new Error('User not found');
        }

        const price = calculatePriceFromQuote(quote);
        const tokenAmount = Number(quote.outAmount) / 1e9; // Convert to proper decimal places

        const trade: ITrade = {
            tokenAddress: tokenData.address,
            tokenName: tokenData.tokenName,
            tokenSymbol: tokenData.tokenSymbol,
            buyPrice: price,
            tokenAmount: tokenAmount,
            solSpent: solAmount,
            currentPrice: price,
            solPnL: 0,
            usdPnL: 0,
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
                usdPnL: 0
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
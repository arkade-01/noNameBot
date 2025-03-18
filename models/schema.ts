import mongoose, { Schema, Document } from "mongoose";

// Interface for individual trades
export interface ITrade {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    buyPrice: number;
    tokenAmount: number;
    solSpent: number;
    usdSpent?: number; // New field for USD value of trade
    currentPrice: number;
    solPnL: number;
    usdPnL: number;
    entryMarketCap: number;
    timestamp: Date;
    realizedGainSol?: number; // Track realized gains for sells
    realizedGainUsd?: number; // Track realized gains in USD
}

// Interface for positions
export interface IPosition {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    totalTokens: number;
    totalSolSpent: number;
    totalUsdSpent?: number; // New field for total USD spent
    trades: ITrade[];
    averageBuyPrice: number;
    currentPrice: number;
    solPnL: number;
    usdPnL: number;
    currentMarketCap: number;
    entryMarketCap: number;
    lastPriceUpdate?: Date;
    currentUsdValue?: number; // New field for current USD value
    realizedGainsSol?: number; // Track total realized gains in SOL
    realizedGainsUsd?: number; // Track total realized gains in USD
    totalSoldTokens?: number; // Track how many tokens were sold
    totalSolReceived?: number; // Track how much SOL was received from sells
}

// Define Trade Schema
const tradeSchema = new Schema({
    tokenAddress: { type: String, required: true },
    tokenName: { type: String, required: true },
    tokenSymbol: { type: String, required: true },
    buyPrice: { type: Number, required: true },
    tokenAmount: { type: Number, required: true },
    solSpent: { type: Number, required: true },
    usdSpent: { type: Number, required: false }, // New field for USD spending
    currentPrice: { type: Number, required: true },
    solPnL: { type: Number, default: 0 },
    usdPnL: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
    entryMarketCap: { type: Number, required: true, default: 0 },
    realizedGainSol: { type: Number, required: false },
    realizedGainUsd: { type: Number, required: false }
});

// Define Position Schema
const positionSchema = new Schema({
    tokenAddress: { type: String, required: true },
    tokenName: { type: String, required: true },
    tokenSymbol: { type: String, required: true },
    totalTokens: { type: Number, required: true, default: 0 },
    totalSolSpent: { type: Number, required: true, default: 0 },
    totalUsdSpent: { type: Number, required: false }, // New field for USD spending total
    trades: [tradeSchema],
    averageBuyPrice: { type: Number, required: true, default: 0 },
    currentPrice: { type: Number, required: true, default: 0 },
    solPnL: { type: Number, default: 0 },
    usdPnL: { type: Number, default: 0 },
    currentMarketCap: { type: Number, required: true, default: 0 },
    entryMarketCap: { type: Number, required: true, default: 0 },
    lastPriceUpdate: { type: Date, default: Date.now, required: false },
    currentUsdValue: { type: Number, required: false }, // New field for current USD value
    realizedGainsSol: { type: Number, default: 0 },
    realizedGainsUsd: { type: Number, default: 0 },
    totalSoldTokens: { type: Number, default: 0 },
    totalSolReceived: { type: Number, default: 0 }
});

// Referral Interface and Schema
export interface IReferral {
    code: string;
    createdAt: Date;
    referredUser: string;
}

const referralSchema = new Schema({
    code: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    referredUser: { type: String, required: true }
});

// Updated User Interface
export interface IUser extends Document {
    telegram_id: string;
    privateKey: string;
    walletAddress: string;
    userBalance: number;
    lastUpdatedbalance: Date | null;
    trades: ITrade[];
    positions: IPosition[];
    referralCode: string;
    referralCount: number;
    referredBy: string | null;
    referrals: IReferral[];
    referralRewards: number; // Reward amount earned from referrals
    addTrade: (trade: ITrade) => Promise<void>;
    getPositions: () => Promise<IPosition[]>;
}

// Define User Schema
const userSchema = new Schema({
    telegram_id: { type: String, required: true, unique: true },
    privateKey: { type: String, required: true },
    walletAddress: { type: String, required: true },
    userBalance: { type: Number, default: 0 },
    lastUpdatedbalance: { type: Date, default: null },
    trades: [tradeSchema],
    positions: [positionSchema],
    // Referral System Fields
    referralCode: { type: String, unique: true, sparse: true },
    referralCount: { type: Number, default: 0 },
    referredBy: { type: String, default: null },
    referrals: [referralSchema],
    referralRewards: { type: Number, default: 0 }
}, {
    timestamps: true
});
// Fix for addTrade method in userSchema
userSchema.methods.addTrade = async function (trade: ITrade): Promise<void> {
    this.trades.push(trade);

    let position = this.positions?.find((p: IPosition) => p.tokenAddress === trade.tokenAddress);

    // Initialize realized gains tracking fields if not present
    if (position && position.realizedGainsSol === undefined) {
        position.realizedGainsSol = 0;
        position.realizedGainsUsd = 0;
        position.totalSoldTokens = 0;
        position.totalSolReceived = 0;
    }

    if (position) {
        // Check if this is a buy or sell
        const isSell = trade.tokenAmount < 0;

        if (isSell) {
            // SELL OPERATION
            // Calculate average cost of tokens being sold
            const avgCostPerToken = position.averageBuyPrice || 0;

            // Calculate how much was initially spent on these tokens
            const costBasisSol = Math.abs(trade.tokenAmount) * avgCostPerToken;

            // Calculate realized gain for this sell
            // realizedGain = soldFor - costBasis
            const realizedGainSol = Math.abs(trade.solSpent) - costBasisSol;

            // Add realized gain to the trade record for tracking
            trade.realizedGainSol = realizedGainSol;

            // Update USD realized gains if available
            if (trade.usdSpent) {
                const costBasisUsd = costBasisSol * (trade.usdSpent / Math.abs(trade.solSpent));
                trade.realizedGainUsd = Math.abs(trade.usdSpent) - costBasisUsd;

                // Update position USD realized gains
                position.realizedGainsUsd = (position.realizedGainsUsd || 0) + (trade.realizedGainUsd || 0);
            }

            // Update position realized gains
            position.realizedGainsSol = (position.realizedGainsSol || 0) + realizedGainSol;
            position.totalSoldTokens = (position.totalSoldTokens || 0) + Math.abs(trade.tokenAmount);
            position.totalSolReceived = (position.totalSolReceived || 0) + Math.abs(trade.solSpent);

            // For a sell, we reduce totalTokens but don't change totalSolSpent
            // since that represents the cost basis of the original purchase
            position.totalTokens += trade.tokenAmount; // This will subtract tokens since amount is negative
        } else {
            // BUY OPERATION
            // Update basic position fields
            position.totalTokens += trade.tokenAmount;
            position.totalSolSpent += trade.solSpent;

            // Update USD spent if available
            if (trade.usdSpent) {
                position.totalUsdSpent = (position.totalUsdSpent || 0) + trade.usdSpent;
            }
        }

        position.currentPrice = trade.currentPrice;
        position.currentMarketCap = trade.entryMarketCap;
        position.trades.push(trade);
        position.lastPriceUpdate = new Date();

        // Fix: Recalculate average buy price only for remaining tokens
        if (position.totalTokens > 0) {
            // If we have sell history, we need cost basis for remaining tokens
            if (position.totalSoldTokens && position.totalSoldTokens > 0) {
                // For accurate average purchase price, we need to account for specific tokens sold
                // Either using FIFO, LIFO, or average cost method
                // Using average cost here:
                position.averageBuyPrice = position.totalSolSpent / position.totalTokens;
            } else {
                // Simple case when no sells have occurred
                position.averageBuyPrice = position.totalSolSpent / position.totalTokens;
            }
        } else {
            position.averageBuyPrice = 0;
        }

        // Calculate current values
        const solValueAtCurrentPrice = position.totalTokens * position.currentPrice;

        // Total PnL = Current Value + Realized Gains - Total Spent
        position.solPnL = solValueAtCurrentPrice + (position.realizedGainsSol || 0) - position.totalSolSpent;

        // Calculate USD values if possible
        if (trade.usdSpent) {
            const solToUsdRate = trade.usdSpent / trade.solSpent;
            position.currentUsdValue = solValueAtCurrentPrice * solToUsdRate;
            position.usdPnL = position.currentUsdValue + (position.realizedGainsUsd || 0) - (position.totalUsdSpent || 0);
        }
    } else if (trade.tokenAmount > 0) {
        // Create new position with lastPriceUpdate and USD fields
        const newPosition: IPosition = {
            tokenAddress: trade.tokenAddress,
            tokenName: trade.tokenName,
            tokenSymbol: trade.tokenSymbol,
            totalTokens: trade.tokenAmount,
            totalSolSpent: trade.solSpent,
            totalUsdSpent: trade.usdSpent, // Add USD spent if available
            trades: [trade],
            averageBuyPrice: trade.tokenAmount > 0 ? trade.solSpent / trade.tokenAmount : 0, // Fix: Safe division
            currentPrice: trade.currentPrice,
            solPnL: 0,
            usdPnL: 0,
            currentMarketCap: trade.entryMarketCap,
            entryMarketCap: trade.entryMarketCap,
            lastPriceUpdate: new Date(),
            currentUsdValue: trade.usdSpent, // Initialize current USD value if available
            realizedGainsSol: 0,
            realizedGainsUsd: 0,
            totalSoldTokens: 0,
            totalSolReceived: 0
        };
        this.positions.push(newPosition);
    }

    await this.save();
};

// Fix for getPositions method
userSchema.methods.getPositions = async function (): Promise<IPosition[]> {
    const positions = new Map<string, IPosition>();

    this.trades.forEach((trade: ITrade) => {
        const key = trade.tokenAddress;
        const current = positions.get(key) || {
            tokenAddress: trade.tokenAddress,
            tokenName: trade.tokenName,
            tokenSymbol: trade.tokenSymbol,
            totalTokens: 0,
            totalSolSpent: 0,
            totalUsdSpent: 0, // Initialize USD spent
            trades: [],
            averageBuyPrice: 0,
            currentPrice: trade.currentPrice,
            solPnL: 0,
            usdPnL: 0,
            entryMarketCap: trade.entryMarketCap,
            currentMarketCap: 0,
            lastPriceUpdate: new Date(), // Include lastPriceUpdate
            currentUsdValue: 0, // Initialize current USD value
            realizedGainsSol: 0,
            realizedGainsUsd: 0,
            totalSoldTokens: 0,
            totalSolReceived: 0
        };

        // Check if this is a buy or sell
        const isSell = trade.tokenAmount < 0;

        if (isSell) {
            // For sells, we need to track realized gains
            // This is a simplified version; a full implementation would calculate 
            // the cost basis based on the position's average buy price at time of sell
            const tokensSold = Math.abs(trade.tokenAmount);
            const solReceived = Math.abs(trade.solSpent);

            current.totalSoldTokens! += tokensSold;
            current.totalSolReceived! += solReceived;

            // If the trade has realizedGain data, use it
            if (trade.realizedGainSol !== undefined) {
                current.realizedGainsSol! += trade.realizedGainSol;
            }

            if (trade.realizedGainUsd !== undefined && trade.usdSpent) {
                current.realizedGainsUsd! += trade.realizedGainUsd;
            }
        } else {
            // For buys, we increase the investment amounts
            current.totalSolSpent += trade.solSpent;

            if (trade.usdSpent) {
                current.totalUsdSpent! += trade.usdSpent;
            }
        }

        // Update token count regardless of buy or sell
        current.totalTokens += trade.tokenAmount;
        current.trades.push(trade);

        // Update latest price
        current.currentPrice = trade.currentPrice;

        positions.set(key, current);
    });

    // Calculate averages and PnL for all positions
    for (const [key, position] of positions.entries()) {
        // Fix: Safe calculation of average buy price
        if (position.totalTokens > 0) {
            position.averageBuyPrice = position.totalSolSpent / position.totalTokens;
        } else {
            position.averageBuyPrice = 0;
        }

        // Calculate PnL with realized gains
        const currentValue = position.totalTokens * position.currentPrice;
        position.solPnL = currentValue + (position.realizedGainsSol || 0) - position.totalSolSpent;

        // Calculate USD values if we have the data
        if (position.totalUsdSpent && position.totalUsdSpent > 0) {
            const usdPerSol = position.totalUsdSpent / position.totalSolSpent;
            position.currentUsdValue = currentValue * usdPerSol;
            position.usdPnL = position.currentUsdValue + (position.realizedGainsUsd || 0) - position.totalUsdSpent;
        }
    }

    return Array.from(positions.values());
};

const User = mongoose.model<IUser>("User", userSchema);

export default User;